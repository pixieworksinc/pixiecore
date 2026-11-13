'use strict';
const cases = window.PIXIEAGENT_DEMO;
const byId = id => document.getElementById(id);
let selected = 0;
let generation = 0;
const steps = [0, 1, 2].map(i => byId(`step-${i}`));
function select(index) {
  generation++;
  selected = index;
  document.querySelectorAll('.choice').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  byId('sample-title').textContent = cases[index].title;
  byId('input').textContent = cases[index].input;
  byId('result').hidden = true;
  byId('result').querySelector('details').open = false;
  byId('state').textContent = '準備完了';
  byId('play').disabled = false;
  steps.forEach(step => { step.className = ''; step.querySelector('.check').textContent = ''; });
}
cases.forEach((entry, index) => {
  const button = document.createElement('button');
  button.className = 'choice';
  button.type = 'button';
  const num = document.createElement('span'); num.className = 'num'; num.textContent = String(index + 1).padStart(2, '0');
  const label = document.createElement('span');
  const title = document.createElement('strong'); title.textContent = entry.title;
  const subtitle = document.createElement('small'); subtitle.textContent = entry.subtitle;
  label.append(title, subtitle); button.append(num, label);
  button.addEventListener('click', () => select(index));
  byId('choices').append(button);
});
byId('play').addEventListener('click', async () => {
  select(selected);
  const token = generation;
  const entry = cases[selected];
  byId('play').disabled = true;
  byId('state').textContent = '記録を再生中';
  const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600;
  for (const step of steps) {
    step.className = 'active';
    await new Promise(resolve => setTimeout(resolve, delay));
    if (token !== generation) return;
    step.className = 'done'; step.querySelector('.check').textContent = '✓';
  }
  byId('category').textContent = entry.result.category;
  byId('severity').textContent = entry.result.severity;
  byId('severity').dataset.level = entry.result.severity;
  byId('reason').textContent = entry.result.reason;
  byId('caution').textContent = entry.note;
  byId('json').textContent = JSON.stringify(entry.result, null, 2);
  byId('result').hidden = false;
  byId('state').textContent = '再生完了';
  byId('play').disabled = false;
});
select(0);
