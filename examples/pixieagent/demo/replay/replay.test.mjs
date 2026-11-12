import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const file = name => readFileSync(new URL(`public/${name}`, import.meta.url), 'utf8');
function setup() {
  class Element {
    children = []; attributes = {}; dataset = {}; handlers = {}; hidden = false;
    append(...children) { this.children.push(...children); }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(k, v) { this.handlers[k] = v; }
    querySelector(selector) { return this.children.find(e => e.selector === selector); }
  }
  const ids = Object.fromEntries(['choices','sample-title','input','result','state','play','category','severity','reason','caution','json','step-0','step-1','step-2'].map(id => [id, new Element()]));
  for (const [id, selector] of [['result','details'],['step-0','.check'],['step-1','.check'],['step-2','.check']]) { const child = new Element(); child.selector = selector; ids[id].append(child); }
  const timers = [];
  const context = vm.createContext({ window: {}, document: { getElementById: id => ids[id], createElement: () => new Element(), querySelectorAll: () => ids.choices.children }, matchMedia: () => ({matches:false}), setTimeout: cb => timers.push(cb) });
  vm.runInContext(file('data.js'), context); vm.runInContext(file('app.js'), context);
  const tick = async () => { timers.shift()(); await Promise.resolve(); };
  return {ids, timers, tick, data:context.window.PIXIEAGENT_DEMO};
}
test('all six saved results replay exactly and finish after three steps', async () => {
  const {ids,tick,data}=setup(); assert.equal(data.length,6);
  for (let i=0;i<6;i++) {
    ids.choices.children[i].handlers.click(); assert.equal(ids.input.textContent,data[i].input); assert.equal(ids.result.hidden,true);
    const done=ids.play.handlers.click(); assert.equal(ids.play.disabled,true);
    for(let j=0;j<3;j++) await tick(); await done;
    assert.equal(ids.result.hidden,false); assert.deepEqual(JSON.parse(ids.json.textContent),JSON.parse(JSON.stringify(data[i].result)));
    assert.equal(ids.state.textContent,'再生完了'); assert.equal(ids.play.disabled,false);
  }
});
test('switching cases cancels stale playback, including when a new replay starts', async () => {
  const {ids,tick}=setup(); const old=ids.play.handlers.click();
  ids.choices.children[4].handlers.click(); const current=ids.play.handlers.click();
  await tick(); await old; assert.equal(ids.result.hidden,true);
  for(let j=0;j<3;j++) await tick(); await current;
  assert.equal(ids.severity.textContent,'low'); assert.match(ids.caution.textContent,/暫定/);
});
test('public assets contain no external requests, embedded secrets or private paths', () => {
  const scripts=file('app.js')+file('data.js');
  assert.doesNotMatch(scripts,/fetch\s*\(|XMLHttpRequest|WebSocket|innerHTML|OPENAI_API_KEY|\/Users\/|approvalDigest/);
  assert.match(file('index.html'),/保存済みの模擬実行/);
});
