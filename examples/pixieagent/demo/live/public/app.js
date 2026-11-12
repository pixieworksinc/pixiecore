'use strict';
const el = id => document.getElementById(id);
const labels = [
  ['認証の回避', 'Security boundary'], ['不安定な単体テスト', 'Test reliability'],
  ['コアと CLI の依存', 'Architecture'], ['README の誤字', 'Documentation'],
  ['情報が足りない報告', 'Needs clarification'], ['不正な命令を含む報告', 'Untrusted instructions'],
];
let code = '', data = null, busy = false, authenticating = false, selected = 0;
const steps = [0, 1, 2].map(i => el(`step-${i}`));
async function api(path, body) {
  const response = await fetch('api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {Authorization: 'Bearer ' + code, ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '接続できません。');
  return result;
}
function canRun() {
  return data && !busy && !data.state.halted && Date.now() < Date.parse(data.state.expiresAt)
    && data.state.cases[data.cases[selected].id].status === 'ready';
}
function render() {
  const entry = data?.cases[selected];
  const record = entry ? data.state.cases[entry.id] : null;
  const complete = record?.status === 'completed';
  el('sample-title').textContent = labels[selected][0];
  el('input').textContent = entry?.goal ?? 'アクセスコードで接続すると、このサンプルの原文が表示されます。';
  document.querySelectorAll('.choice').forEach((button, i) => {
    button.setAttribute('aria-pressed', String(i === selected)); button.disabled = busy;
  });
  el('play').disabled = !canRun();
  el('state').textContent = busy ? '実行中' : ({ready:'準備完了', running:'実行中', completed:'実行済み', failed:'停止'})[record?.status] ?? '未接続';
  steps.forEach(step => { step.className = complete ? 'done' : ''; step.querySelector('.check').textContent = complete ? '✓' : ''; });
  el('result').hidden = !complete;
  if (complete) {
    el('category').textContent = record.result.category;
    el('severity').textContent = record.result.severity; el('severity').dataset.level = record.result.severity;
    el('reason').textContent = record.result.reason;
    el('json').textContent = JSON.stringify(record.result, null, 2);
    el('caution').textContent = '実モデルが返した結果です。表示は保存済みの実行結果で、追加の API は呼んでいません。理由の意味的な正しさは別途確認が必要です。';
  }
  el('budget').hidden = !data;
  if (data) {
    el('budget').textContent = `共有上限 $1 · 計上済み $${(data.state.used / 1e9).toFixed(6)} · 予約中 $${(data.state.pending / 1e9).toFixed(6)} · API通信 ${data.state.requests}/30`;
    if (data.state.halted || Date.now() >= Date.parse(data.state.expiresAt)) el('state').textContent = '試験停止';
  }
}
labels.forEach(([title, subtitle], i) => {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'choice';
  const num = document.createElement('span'); num.className = 'num'; num.textContent = String(i + 1).padStart(2, '0');
  const label = document.createElement('span'); const heading = document.createElement('strong'); heading.textContent = title;
  const caption = document.createElement('small'); caption.textContent = subtitle;
  label.append(heading, caption); button.append(num, label);
  button.addEventListener('click', () => { if (busy) return; selected = i; el('result').querySelector('details').open = false; render(); });
  el('choices').append(button);
});
el('login').addEventListener('submit', async event => {
  event.preventDefault(); if (authenticating) return;
  authenticating = true; el('unlock').disabled = true; code = el('code').value.trim();
  el('message').textContent = '認証を確認しています…';
  try {
    data = await api('status'); el('code').value = ''; el('login').hidden = true;
    el('message').textContent = '接続済み。実行ボタンを押すまで有料 API は呼びません。'; render();
  } catch (error) { code = ''; data = null; el('message').textContent = error.message; render(); }
  finally { authenticating = false; el('unlock').disabled = false; }
});
el('play').addEventListener('click', async () => {
  if (!canRun()) return;
  busy = true; render(); el('message').textContent = '実 API を呼び出しています。完了後に処理結果を表示します（最大90秒）。';
  try {
    const response = await api('run', {caseId: data.cases[selected].id}); data.state = response.state;
    el('message').textContent = '実行が完了しました。';
  } catch (error) {
    el('message').textContent = error.message;
    try { data = await api('status'); } catch { data.state.halted = true; }
  } finally { busy = false; render(); }
});
render();
