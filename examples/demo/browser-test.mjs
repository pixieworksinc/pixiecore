/** Anonymous, offline browser acceptance for the Drupal demo pages. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

/** @typedef {{id: string, title: string, input: string, result: {category: string, severity: string, reason: string}, note: string}} ReplayCase */
/** @typedef {{call(method: string, params?: Record<string, unknown>): Promise<any>, close(): void}} CdpClient */

const base = new URL(process.env.DEMO_TEST_URL ?? 'http://127.0.0.1:8088');
assert.equal(base.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only loopback test sites are allowed');
assert.equal(base.pathname, '/');
const screenshots = process.env.DEMO_SCREENSHOTS_DIRECTORY;
const profile = await mkdtemp(join(tmpdir(), 'pixiecore-demo-browser-'));
/** @type {{window: {PIXIEAGENT_DEMO?: ReplayCase[]}}} */
const fixture = { window: {} };
runInNewContext(await readFile(new URL('../pixieagent/demo/replay/public/data.js', import.meta.url), 'utf8'), fixture);
/** @type {ReplayCase[]} */
const expectedCases = JSON.parse(JSON.stringify(fixture.window.PIXIEAGENT_DEMO));
assert.equal(expectedCases.length, 6);
/** @param {number} ms */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** @param {() => Promise<boolean>} check @param {string} message @param {number} timeout */
async function waitFor(check, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(message);
}

/** @param {string} url @param {(event: {method: string, params: any}) => void} [onEvent] @returns {Promise<CdpClient>} */
async function connect(url, onEvent) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  /** @type {Map<number, {resolve(value: any): void, reject(error: Error): void, timer: ReturnType<typeof setTimeout>}>} */
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      onEvent?.(message);
      return;
    }
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
    else operation.resolve(message.result);
  });
  return {
    /** @param {string} method @param {Record<string, unknown>} [params] */
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

const chrome = spawn(process.env.DEMO_BROWSER_BIN ?? 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--disable-domain-reliability', '--metrics-recording-only',
  '--disable-features=MediaRouter,OptimizationHints',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
/** @type {Error | undefined} */
let launchError;
let chromeLog = '';
chrome.on('error', error => { launchError = error; });
chrome.stderr.on('data', data => { chromeLog = (chromeLog + data).slice(-10000); });
/** @type {CdpClient | undefined} */
let browser;
/** @type {CdpClient | undefined} */
let page;
/** @type {Record<string, unknown>[]} */
const violations = [];
/** @type {{url: string, status: number}[]} */
const failedResponses = [];
/** @type {string[]} */
const scriptErrors = [];
/** @type {{cases: {id: string, matched: boolean}[], screenshots: string[], providerRequests: number, assets?: {path: string, status: number}[], [key: string]: unknown}} */
const report = { cases: [], screenshots: [], providerRequests: 0 };

try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  /** @type {string[] | undefined} */
  let devtools;
  await waitFor(async () => {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited: ${chromeLog}`);
    try { devtools = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    return devtools?.length === 2;
  }, 'Chrome did not expose its local DevTools port');
  assert.ok(devtools);
  const endpoint = `http://127.0.0.1:${devtools[0]}`;
  browser = await connect(`ws://127.0.0.1:${devtools[0]}${devtools[1]}`);
  /** @type {{type: string, webSocketDebuggerUrl: string}[]} */
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const target = targets.find(item => item.type === 'page');
  assert.ok(target, 'Missing browser page');
  page = await connect(target.webSocketDebuggerUrl, event => {
    if (event.method === 'Fetch.requestPaused') {
      const request = event.params.request;
      const allowed = new URL(request.url).origin === base.origin && ['GET', 'HEAD'].includes(request.method);
      if (!allowed) violations.push({ method: request.method, url: request.url });
      page?.call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: event.params.requestId,
        ...(allowed ? {} : { errorReason: 'BlockedByClient' }),
      }).catch(error => violations.push({ interceptionError: error.message }));
    }
    if (event.method === 'Network.responseReceived') {
      const response = event.params.response;
      if (response.status >= 400 && new URL(response.url).pathname !== '/favicon.ico') {
        failedResponses.push({ url: response.url, status: response.status });
      }
    }
    if (event.method === 'Runtime.exceptionThrown') {
      scriptErrors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
    }
  });
  const client = page;
  for (const domain of ['Page', 'Runtime', 'Network']) await client.call(`${domain}.enable`);
  await client.call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await client.call('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ] });

  /** @param {string} expression @returns {Promise<any>} */
  async function evaluate(expression) {
    const result = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  /** @param {string} path @param {string} selector */
  async function navigate(path, selector) {
    await client.call('Page.navigate', { url: new URL(path, base).href });
    await waitFor(async () => evaluate(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!document.querySelector(${JSON.stringify(selector)})`), `Page did not load: ${path}`);
    await evaluate('document.fonts.ready.then(() => true)');
  }
  /** @param {number} width @param {number} height */
  async function viewport(width, height) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  /** @param {string} name */
  async function screenshot(name) {
    if (!screenshots) return;
    const shot = await client.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(screenshots, name), Buffer.from(shot.data, 'base64'));
    report.screenshots.push(name);
  }
  /** @param {string} label */
  async function checkAppearance(label) {
    const appearance = await evaluate(`(() => ({
      lightPreference: matchMedia('(prefers-color-scheme: light)').matches,
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      claro: [...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href.includes('/core/themes/claro/')),
      mainLandmarks: document.querySelectorAll('main').length,
      headings: document.querySelectorAll('h1').length,
    }))()`);
    assert.equal(appearance.lightPreference, true, `${label}: light preference was not emulated`);
    assert.equal(appearance.background, 'rgb(25, 27, 36)', `${label}: body is not dark`);
    assert.equal(appearance.scheme, 'dark', `${label}: missing dark color scheme`);
    assert.equal(appearance.claro, true, `${label}: not rendered through Claro`);
    assert.equal(appearance.mainLandmarks, 1, `${label}: duplicate main landmarks`);
    assert.equal(appearance.headings, 1, `${label}: duplicate page headings`);
    assert.ok(appearance.scrollWidth <= appearance.width + 1, `${label}: horizontal overflow`);
    report[label] = appearance;
  }

  await viewport(1280, 960);
  await navigate('/', 'main');
  await checkAppearance('landing');
  await screenshot('landing.png');
  await viewport(375, 812);
  await checkAppearance('landingMobile');
  await screenshot('landing-mobile.png');

  await viewport(1280, 960);
  await navigate('/pixieagent/', '#choices .choice');
  assert.equal(await evaluate('document.querySelectorAll("#choices .choice").length'), 6);
  assert.deepEqual(await evaluate('window.PIXIEAGENT_DEMO'), expectedCases, 'Delivered cases differ from the canonical fixtures');
  await checkAppearance('agent');
  await screenshot('replay.png');
  /** @type {string[]} */
  const assets = await evaluate(`(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(element => element.src || element.href))()`);
  assert.ok(assets.length > 3, 'Missing Drupal page assets');
  assert.ok(assets.every(url => new URL(url).pathname.startsWith('/pixieagent/assets/')), 'An Agent script or stylesheet bypasses the public proxy prefix');
  for (const name of ['style.css', 'data.js', 'app.js']) {
    assert.ok(assets.some(url => new URL(url).pathname === `/pixieagent/assets/modules/custom/pixiecore_specification/assets/replay/${name}`), `Missing prefixed asset: ${name}`);
  }
  report.assets = [];
  for (const asset of assets) {
    assert.equal(new URL(asset).origin, base.origin);
    const response = await fetch(asset);
    assert.equal(response.status, 200, `Asset failed: ${asset}`);
    report.assets.push({ path: new URL(asset).pathname, status: response.status });
  }
  for (const [index, expected] of expectedCases.entries()) {
    await evaluate(`document.querySelectorAll('#choices .choice')[${index}].click()`);
    assert.deepEqual(await evaluate(`(() => ({title:document.querySelector('#sample-title').textContent,input:document.querySelector('#input').textContent,selected:[...document.querySelectorAll('#choices .choice')].map(e=>e.getAttribute('aria-pressed')),hidden:document.querySelector('#result').hidden}))()`), {
      title: expected.title, input: expected.input,
      selected: expectedCases.map((_, position) => String(position === index)), hidden: true,
    });
    await evaluate('document.querySelector("#play").click()');
    await waitFor(async () => evaluate('!document.querySelector("#result").hidden'), `Replay did not finish: ${expected.id}`);
    const result = await evaluate(`(() => ({json:JSON.parse(document.querySelector('#json').textContent),category:document.querySelector('#category').textContent,severity:document.querySelector('#severity').textContent,reason:document.querySelector('#reason').textContent,note:document.querySelector('#caution').textContent,steps:document.querySelectorAll('.steps .done').length,state:document.querySelector('#state').textContent,disabled:document.querySelector('#play').disabled}))()`);
    assert.deepEqual(result, { json: expected.result, ...expected.result, note: expected.note, steps: 3, state: '再生完了', disabled: false });
    report.cases.push({ id: expected.id, matched: true });
  }
  await screenshot('replay-result.png');
  await viewport(375, 812);
  await evaluate('document.querySelector("#result details").open = true');
  await checkAppearance('agentMobile');
  await screenshot('replay-mobile.png');

  await client.call('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ] });
  await evaluate('document.querySelectorAll("#choices .choice")[0].click(); document.querySelector("#play").click()');
  await waitFor(async () => evaluate('document.querySelector("#step-0").classList.contains("active") && document.querySelector("#play").disabled'), 'Replay did not start before cancellation');
  await evaluate('document.querySelectorAll("#choices .choice")[1].click()');
  await sleep(2000);
  const cancellationCase = expectedCases[1];
  assert.ok(cancellationCase);
  assert.deepEqual(await evaluate(`(() => ({title:document.querySelector('#sample-title').textContent,state:document.querySelector('#state').textContent,hidden:document.querySelector('#result').hidden,disabled:document.querySelector('#play').disabled,pending:document.querySelectorAll('.steps .active,.steps .done').length}))()`), {
    title: cancellationCase.title, state: '準備完了', hidden: true, disabled: false, pending: 0,
  });
  report.midReplayCancellation = true;

  await viewport(1280, 960);
  await navigate('/user/login', '#user-login-form');
  await checkAppearance('login');
  await screenshot('claro-login.png');
  await viewport(375, 812);
  await checkAppearance('loginMobile');
  await screenshot('claro-login-mobile.png');
  assert.deepEqual(violations, [], 'Unexpected external request or mutating HTTP method');
  assert.deepEqual(failedResponses, [], 'A browser resource failed');
  assert.deepEqual(scriptErrors, [], 'Browser JavaScript failed');
  report.status = 'passed';
  if (screenshots) await writeFile(join(screenshots, 'browser-acceptance.json'), JSON.stringify(report, null, 2));
  console.log('Anonymous Drupal landing and Agent: 6 replay cases, cancellation, scoped assets, dark appearance, and desktop/mobile checks passed. No provider requests.');
} catch (error) {
  if (screenshots) await writeFile(join(screenshots, 'browser-failure.json'), JSON.stringify({ error: error instanceof Error ? error.message : String(error), report, violations, failedResponses, scriptErrors, chromeLog }, null, 2));
  throw error;
} finally {
  page?.close();
  if (browser) {
    await browser.call('Browser.close').catch(() => {});
    browser.close();
  }
  if (chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await waitFor(async () => chrome.exitCode !== null || chrome.signalCode !== null, 'Chrome did not stop', 5000).catch(() => chrome.kill('SIGKILL'));
  }
  await rm(profile, { recursive: true, force: true });
}
