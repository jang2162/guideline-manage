// 서버가 띄우는 내보내기 폼. CSP 때문에 인라인 스크립트 대신 이 파일을 쓴다.
// 체크 상태를 결과로 바꾸는 규칙(selection.js)은 서버와 같이 쓴다. 결과는 서버가 다시 계산한다.
import { itemKey, defaultChoice, canUpdate, canOverwrite, actionOf, summarize, blockKey, requiredClosure, missingRequires, releasable } from './selection.js';

const $ = sel => document.querySelector(sel);
// 문구는 서버가 페이지의 i18n JSON 블록에 실어 준다(서버 언어).
const MESSAGES = JSON.parse(document.getElementById('i18n')?.textContent || '{}');
const t = (key, params = {}) => (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 블록 이름: 도메인 스택(`<도구>__<도메인>`)은 도구 이름과 도메인 꼬리표로 나누고, 표시 이름(label)이 있으면 제목으로 쓴다.
// 서버 layout.js 의 blockLabel 과 같은 모양.
const blockHtml = (name, label) => {
  const i = name.indexOf('__');
  const tool = i === -1 ? name : name.slice(0, i);
  return `<span class="nm" title="${esc(name)}">${esc(label || tool)}</span>${label ? `<span class="real">${esc(tool)}</span>` : ''}`
    + `${i === -1 ? '' : `<span class="domain">${esc(name.slice(i + 2))}</span>`}`;
};
const app = $('#form-app');
const base = `/forms/${encodeURIComponent(app.dataset.id)}`;
const PING_MS = 30_000;
const STATE_LABEL = {
  same: t('web.client.same'), different: t('web.client.different'), moved: t('web.client.moved'), present: t('web.client.present'),
  unknown: t('web.client.unknown'), missing: t('web.client.missing'), blocked: t('web.client.blocked'), orphan: t('web.client.orphan'),
};
const LOCK_LABEL = {
  current: t('web.client.current'), upstream: t('web.client.upstream'), local: t('web.client.local'), both: t('web.client.both'),
  gone: t('web.client.gone'), removed: t('web.client.orphan'),
};
const ACTION_LABEL = { add: t('web.client.add'), update: t('web.client.update'), remove: t('web.client.remove') };
// auto: 의존성으로 켠 블록, touched: 사람이 직접 켜거나 끈 블록, notes: 마지막 동작에서 함께 켠·끈 안내.
const state = { data: null, choices: {}, initial: {}, open: new Set(), finished: false, auto: new Set(), touched: new Set(), notes: [] };

async function call(name, body = {}) {
  const res = await fetch(`${base}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? t('web.client.status', { status: res.status }));
  return data;
}

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = !message;
}

function finish(message) {
  state.finished = true;
  for (const sel of ['#checklist', '#bar', '#choose', '#dirty']) $(sel).hidden = true;
  showError('');
  $('#finished').hidden = false;
  $('#finished-text').textContent = message;
}

const project = () => state.data.project;
const needsForm = () => project().isNew === true;
const isRemoved = i => i.lockState === 'removed';
const isChecked = key => state.choices[key]?.checked ?? false;
const stackItems = name => state.data.items.filter(i => (i.kind === 'rule' || i.kind === 'setup') && i.stack === name && i.state !== 'blocked' && !isRemoved(i));

function itemCategories(item) {
  const cat = state.data.catalog;
  const stack = cat.stacks.find(s => s.name === item.stack);
  if (item.kind === 'rule') return stack?.files.find(f => f.path === item.id)?.categories ?? [];
  if (item.kind === 'setup') return stack?.categories ?? [];
  const list = { skill: cat.skills, subagent: cat.subagents, mcp: cat.mcp }[item.kind];
  if (!list) return [];
  const name = item.id.split('/')[1].replace(/\.md$/, '');
  return list.find(x => x.name === name)?.categories ?? [];
}

/** 스킬·서브에이전트·MCP 항목의 표시 이름(label). 없으면 null. */
function itemLabel(item) {
  const cat = state.data.catalog;
  const list = { skill: cat.skills, subagent: cat.subagents, mcp: cat.mcp }[item.kind];
  if (!list) return null;
  const name = item.id.split('/')[1].replace(/\.md$/, '');
  return list.find(x => x.name === name)?.label ?? null;
}

/** 블록 키 → 그 블록이 필요로 하는 블록 키(폼에는 별칭을 입힌 이름으로 온다). */
function requiresMap() {
  const c = state.data.catalog;
  return Object.fromEntries([
    ...c.stacks.map(x => [`rules/${x.name}`, x.requires ?? []]), ...c.skills.map(x => [`skills/${x.name}`, x.requires ?? []]),
    ...c.subagents.map(x => [`agents/${x.name}.md`, x.requires ?? []]), ...c.mcp.map(x => [`mcp/${x.name}`, x.requires ?? []]),
  ]);
}

/** 블록을 이루는 고를 수 있는 항목(반영 불가·사라짐 제외). */
const unitItems = unit => state.data.items.filter(i => i.kind !== 'orphan' && i.state !== 'blocked' && !isRemoved(i) && blockKey(i.id) === unit);
/** 골라진 블록: 항목이 하나라도 체크된 블록. */
const chosenUnits = () => new Set(state.data.items.filter(i => i.kind !== 'orphan' && !isRemoved(i) && isChecked(itemKey(i))).map(i => blockKey(i.id)).filter(Boolean));

/** 블록의 사람이 읽는 이름(표시 이름, 없으면 이름). */
function unitName(unit) {
  const c = state.data.catalog;
  const [dir, rest] = [unit.slice(0, unit.indexOf('/')), unit.slice(unit.indexOf('/') + 1)];
  const name = dir === 'agents' ? rest.replace(/\.md$/, '') : rest;
  const list = { rules: c.stacks, skills: c.skills, agents: c.subagents, mcp: c.mcp }[dir] ?? [];
  return list.find(x => x.name === name)?.label || name;
}

/** 블록의 항목을 모두 켠다. 이미 골라진 블록(사람이 일부만 고름)은 건드리지 않는다. 켰으면 true. */
function turnOn(unit) {
  if (chosenUnits().has(unit)) return false;
  const items = unitItems(unit);
  for (const i of items) state.choices[itemKey(i)].checked = true;
  return items.length > 0;
}

/** units 가 필요로 하는 블록을 켜고 안내를 남긴다. */
function pullRequires(units) {
  const req = requiresMap();
  for (const need of requiredClosure(units, req)) {
    if (!turnOn(need)) continue;
    state.auto.add(need);
    const by = units.find(u => requiredClosure([u], req).includes(need)) ?? units[0];
    state.notes.push(t('web.client.autoChecked', { by: unitName(by), needs: unitName(need) }));
  }
}

/** 사람이 항목 하나를 켜거나 끈다. 블록이 새로 골라지면 필요한 블록을 켜고, 블록이 풀리면 그 때문에 켰던 블록을 함께 끈다. */
function userCheck(item, on) {
  const unit = blockKey(item.id);
  const before = chosenUnits();
  check(item, on);
  if (!unit) return;
  state.touched.add(unit);
  state.auto.delete(unit);
  if (on && !before.has(unit)) pullRequires([unit]);
  if (!on && before.has(unit) && !chosenUnits().has(unit)) {
    for (const u of releasable(unit, { chosen: before, auto: state.auto, touched: state.touched, requires: requiresMap() })) {
      for (const i of unitItems(u)) state.choices[itemKey(i)].checked = false;
      state.auto.delete(u);
    }
  }
}

// 지침 파일을 켜면 그 스택의 세팅 문서가 없을 때 함께 켠다. 따로 끌 수 있다.
function check(item, on) {
  state.choices[itemKey(item)].checked = on;
  if (on && item.kind === 'rule') {
    const setup = state.data.items.find(i => i.kind === 'setup' && i.stack === item.stack);
    if (setup?.state === 'missing') state.choices[itemKey(setup)].checked = true;
  }
}

function stackNotes(stack, rules) {
  const notes = [];
  for (const o of stack.overrides) {
    if (isChecked(`rule:${o.from.path}`) && !isChecked(`rule:${o.to.path}`)) {
      const to = o.to.path.slice('rules/'.length);
      notes.push(t('web.client.overridesUnchosen', { stack: stack.name, to }));
    }
  }
  const mine = state.data.overrides.filter(o => o.stack === stack.name);
  for (const o of mine.filter(o => !o.valid)) notes.push(t('web.client.overrideWarning', { file: o.file, heading: o.heading, reason: o.reason }));
  if (mine.length > 0 && rules.every(r => !isChecked(itemKey(r)))) notes.push(t('web.client.overridesStay'));
  return notes;
}

/** 블록 옆 표시: 에이전트 추천(이유), 의존성으로 켬, 필요한 블록이 빠짐. */
function unitTags(unit) {
  if (!unit) return '';
  const rec = state.data.recommend ?? {};
  const out = [];
  if (Object.hasOwn(rec, unit)) {
    out.push(`<span class="badge rec">${esc(t('web.client.recommended'))}</span>`);
    if (rec[unit]) out.push(`<span class="why">${esc(t('web.client.why', { why: rec[unit] }))}</span>`);
  }
  if (state.auto.has(unit) && chosenUnits().has(unit)) out.push(`<span class="badge dep">${esc(t('web.client.dependency'))}</span>`);
  return out.join('');
}

/** 골라진 블록이 필요로 하는데 빠진 블록 경고. */
function missingNotes(unit) {
  return missingRequires(chosenUnits(), requiresMap()).filter(m => m.unit === unit)
    .map(m => t('web.client.missingRequire', { needs: unitName(m.needs), by: unitName(unit) }));
}

function rowHtml(item, label, meta, { badges = [], cats = [], nameHtml = null, tags = '', warns = [] } = {}) {
  const key = itemKey(item);
  const choice = state.choices[key];
  const action = actionOf(item, choice);
  const blocked = item.state === 'blocked';
  const stateText = item.lockState ? LOCK_LABEL[item.lockState]
    : item.kind === 'mcp' && item.build && item.state === 'present' ? t('web.client.presentCheckOnApply') : STATE_LABEL[item.state];
  const stateCls = item.lockState ? `l-${item.lockState}` : `s-${item.state}`;
  const extra = [];
  if (choice.checked && canUpdate(item)) {
    extra.push(`<label class="upd"><input type="checkbox" data-update="${esc(key)}" ${choice.update ? 'checked' : ''}> ${esc(t('web.client.update'))}</label>`);
  }
  if (choice.checked && canOverwrite(item)) {
    extra.push(`<label class="upd"><input type="checkbox" data-overwrite="${esc(key)}" ${choice.overwrite ? 'checked' : ''}> ${esc(t('web.client.overwrite'))}</label>`);
  }
  if (['different', 'moved'].includes(item.state)) extra.push(`<button type="button" class="link" data-diff="${esc(key)}">${esc(t('web.client.showDiff'))}</button>`);
  for (const b of badges) extra.push(`<span class="badge">${esc(b)}</span>`);
  if (ACTION_LABEL[action]) extra.push(`<span class="act act-${action}">${esc(ACTION_LABEL[action])}</span>`);
  return `<div class="row${action === 'remove' ? ' remove' : ''}${blocked ? ' blocked' : ''}">`
    + `<label class="main"><input type="checkbox" data-key="${esc(key)}" ${choice.checked ? 'checked' : ''} ${blocked ? 'disabled' : ''}>`
    + `<span class="name">${nameHtml ?? esc(label)}</span>${cats.length ? `<span class="cats">[${esc(cats.join(', '))}]</span>` : ''}${tags}</label>`
    + `<span class="meta">${esc(meta)}</span>`
    + `<span class="state ${esc(stateCls)}">${esc(stateText)}</span>`
    + `<span class="extra">${extra.join('')}</span>`
    + (item.reason ? `<div class="reason">${esc(item.reason)}</div>` : '')
    + warns.map(w => `<div class="reason warn">${esc(w)}</div>`).join('')
    + '</div>';
}

function renderSummary() {
  const c = summarize(state.data.items, state.choices);
  $('#summary').textContent = t('web.client.summary', { add: c.add, update: c.update, remove: c.remove });
  $('#submit').textContent = c.remove > 0 ? t('web.client.submitWithRemove', { n: c.remove }) : t('web.client.submit');
  $('#submit').classList.toggle('danger', c.remove > 0);
}

function renderList() {
  const { items, catalog, overrides } = state.data;
  const out = [];
  for (const s of catalog.stacks) {
    const rules = items.filter(i => i.kind === 'rule' && i.stack === s.name && !isRemoved(i));
    const setup = items.find(i => i.kind === 'setup' && i.stack === s.name && !isRemoved(i));
    const live = stackItems(s.name);
    const on = live.filter(i => isChecked(itemKey(i))).length;
    const id = `stack:${s.name}`;
    const rows = [
      ...stackNotes(s, rules).map(n => `<div class="note">${esc(n)}</div>`),
      ...missingNotes(`rules/${s.name}`).map(n => `<div class="note warn">${esc(n)}</div>`),
      ...rules.map(r => {
        const own = itemCategories(r).filter(c => !s.categories.includes(c));
        const n = overrides.filter(o => o.valid && o.target === r.id).length;
        return rowHtml(r, r.id.split('/')[2], r.load ?? '', { badges: n ? [t('web.client.overrideCount', { n })] : [], cats: own });
      }),
      ...(setup ? [rowHtml(setup, 'SETUP.md', t('web.client.setupDoc'))] : []),
    ];
    out.push(`<details class="group" data-group="${esc(id)}" ${state.open.has(id) ? 'open' : ''}><summary>`
      + `<input type="checkbox" class="stack-box" data-stack="${esc(s.name)}" ${live.length && on === live.length ? 'checked' : ''} ${on > 0 && on < live.length ? 'data-mixed' : ''} ${live.length ? '' : 'disabled'}>`
      + `<b>${blockHtml(s.name, s.label)}</b>${s.categories.length ? `<span class="cats">[${esc(s.categories.join(', '))}]</span>` : ''}${unitTags(`rules/${s.name}`)}`
      + `${(project().rootStacks ?? []).includes(s.name) ? `<span class="cats">${esc(t('web.client.inRoot'))}</span>` : ''}`
      + `<span class="meta count">${on}/${live.length}</span></summary>${rows.join('')}</details>`);
  }
  const simple = (id, title, list, label, meta) => {
    if (list.length === 0) return;
    const on = list.filter(i => isChecked(itemKey(i))).length;
    out.push(`<details class="group" data-group="${id}" ${state.open.has(id) ? 'open' : ''}><summary><b>${esc(title)}</b>`
      + `<span class="meta count">${on}/${list.length}</span></summary>`
      + list.map(i => rowHtml(i, label(i), meta(i), {
        cats: itemCategories(i), nameHtml: itemLabel(i) ? blockHtml(label(i), itemLabel(i)) : null,
        tags: i.kind === 'orphan' ? '' : unitTags(blockKey(i.id)), warns: i.kind === 'orphan' ? [] : missingNotes(blockKey(i.id)),
      })).join('') + '</details>');
  };
  const of = kind => items.filter(i => i.kind === kind && !isRemoved(i));
  simple('gone', t('web.client.orphan'), items.filter(i => i.state === 'orphan' || isRemoved(i)), i => i.id, () => t('web.client.uncheckDeletes'));
  simple('skills', t('web.client.skills'), of('skill'), i => i.id.slice('skills/'.length), () => '');
  simple('subagents', t('web.client.subagents'), of('subagent'), i => i.id.slice('agents/'.length).replace(/\.md$/, ''), () => '');
  simple('mcp', 'MCP', of('mcp'), i => i.id.slice('mcp/'.length), i => (i.build ? t('web.client.fromReadme') : ''));
  const notes = state.notes.map(n => `<div class="note dep-note">${esc(n)}</div>`).join('');
  $('#list').innerHTML = notes + out.join('');
  for (const box of document.querySelectorAll('[data-mixed]')) box.indeterminate = true;
  renderSummary();
}

function renderChips() {
  const chips = [...new Set(state.data.items.flatMap(i => itemCategories(i)))].sort((a, b) => a.localeCompare(b, 'ko'));
  $('#chips').innerHTML = chips.length
    ? chips.map(c => `<button type="button" class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')
    : `<span class="meta">${esc(t('web.client.noCategories'))}</span>`;
}

function openCheckedStacks() {
  for (const s of state.data.catalog.stacks) {
    if (stackItems(s.name).some(i => isChecked(itemKey(i)))) state.open.add(`stack:${s.name}`);
  }
}

async function showDiff(key) {
  const body = $('#diff-body');
  $('#diff-title').textContent = key.replace(/^[a-z]+:/, '');
  body.innerHTML = `<p class="meta">${esc(t('web.client.loading'))}</p>`;
  $('#diff').showModal();
  try {
    const res = await fetch(`${base}/diff?key=${encodeURIComponent(key)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? t('web.client.status', { status: res.status }));
    if (d.keys) {
      body.innerHTML = d.keys.length
        ? `<ul>${d.keys.map(k => `<li><code>${esc(k)}</code></li>`).join('')}</ul><p class="meta">${esc(t('web.client.valuesHidden'))}</p>`
        : `<p>${esc(t('web.client.noDiff'))}</p>`;
      return;
    }
    const line = l => {
      const cls = /^(\+\+\+|---|@@)/.test(l) ? 'dh' : l[0] === '+' ? 'da' : l[0] === '-' ? 'dd' : '';
      return `<span class="${cls}">${esc(l) || ' '}</span>`;
    };
    body.innerHTML = d.files?.length
      ? d.files.map(f => `<h3>${esc(f.path)}</h3><pre class="diff-lines">${f.diff.split('\n').map(line).join('')}</pre>`).join('')
      : `<p>${esc(t('web.client.noDiff'))}</p>`;
  } catch (e) {
    body.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

$('#list').addEventListener('change', e => {
  const t = e.target;
  state.notes = [];
  if (t.dataset.key) userCheck(state.data.items.find(i => itemKey(i) === t.dataset.key), t.checked);
  else if (t.dataset.update) state.choices[t.dataset.update].update = t.checked;
  else if (t.dataset.overwrite) state.choices[t.dataset.overwrite].overwrite = t.checked;
  else if (t.dataset.stack) for (const i of stackItems(t.dataset.stack)) userCheck(i, t.checked);
  else return;
  renderList();
});
$('#list').addEventListener('click', e => {
  const b = e.target.closest('[data-diff]');
  if (b) showDiff(b.dataset.diff);
});
$('#list').addEventListener('toggle', e => {
  const id = e.target.dataset?.group;
  if (!id) return;
  if (e.target.open) state.open.add(id);
  else state.open.delete(id);
}, true);
// 분류 버튼은 켜기만 한다. 실수로 제거가 걸리지 않게 끄는 동작은 두지 않는다.
$('#chips').addEventListener('click', e => {
  const c = e.target.closest('[data-cat]')?.dataset.cat;
  if (!c) return;
  for (const i of state.data.items) {
    if (i.state !== 'blocked' && i.kind !== 'orphan' && !isRemoved(i) && itemCategories(i).includes(c)) check(i, true);
  }
  openCheckedStacks();
  renderList();
});
$('#reset').addEventListener('click', () => {
  state.choices = structuredClone(state.initial);
  state.auto = new Set(state.initialAuto);
  state.touched = new Set();
  state.notes = [];
  renderList();
});
$('#submit').addEventListener('click', async () => {
  showError('');
  const body = { choices: state.choices, force: $('#force').checked };
  if (needsForm()) {
    body.chosen = { agents: [...document.querySelectorAll('input[name=agent]:checked')].map(x => x.value) };
  }
  $('#submit').disabled = true;
  try {
    await call('submit', body);
    finish(t('web.client.submitted'));
  } catch (e) {
    showError(e.message);
    $('#submit').disabled = false;
  }
});
for (const b of document.querySelectorAll('[data-cancel]')) {
  b.addEventListener('click', async () => {
    try {
      await call('cancel');
      finish(t('web.client.cancelled'));
    } catch (e) {
      finish(t('web.client.cancelFailed', { reason: e.message }));
    }
  });
}

if (app.dataset.status !== 'pending') {
  finish(t('web.client.closed'));
} else {
  try {
    const res = await fetch(`${base}/data`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? t('web.client.status', { status: res.status }));
    state.data = data;
  } catch (e) {
    showError(e.message);
  }
  if (state.data) {
    for (const i of state.data.items) state.choices[itemKey(i)] = defaultChoice(i);
    // 에이전트 추천 블록을 켜고, 그 블록이 필요로 하는 블록을 의존성으로 켠다.
    const rec = Object.keys(state.data.recommend ?? {});
    for (const unit of rec) turnOn(unit);
    pullRequires(rec);
    state.initial = structuredClone(state.choices);
    state.initialAuto = new Set(state.auto);
    $('#choose').hidden = !needsForm();
    $('#dirty').hidden = project().isNew === true || (project().gitRepo && !project().dirty);
    state.open = new Set(['gone', 'skills', 'subagents', 'mcp']);
    openCheckedStacks();
    renderChips();
    renderList();
    call('ping').catch(() => {});
    setInterval(() => {
      if (!state.finished) call('ping').catch(() => {});
    }, PING_MS);
  }
}
