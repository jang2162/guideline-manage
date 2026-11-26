// 서버가 띄우는 내보내기 폼. CSP 때문에 인라인 스크립트 대신 이 파일을 쓴다.
// 체크 상태를 결과로 바꾸는 규칙(selection.js)은 서버와 같이 쓴다. 결과는 서버가 다시 계산한다.
import { itemKey, canUpdate, canOverwrite, actionOf, summarize, blockKey, stepOf, missingRequires, releasable, pullRequired, stackRows, ancestorsToChoose, chosenDescendants, releasableAncestors, personalChoices, personalSelection, personalBasis, initialChoices, requiresOf, tierOf, applyTier, TIERS, personalTurn } from './selection.js';
import { ancestorKeys, isWithin } from './blocks.js';

const $ = sel => document.querySelector(sel);
// 문구는 서버가 페이지의 i18n JSON 블록에 실어 준다(서버 언어).
const MESSAGES = JSON.parse(document.getElementById('i18n')?.textContent || '{}');
const t = (key, params = {}) => (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 블록 이름: 도메인 스택(`<도구>__<도메인>`)은 도구 이름과 도메인 꼬리표로 나누고, 표시 이름(label)이 있으면 제목으로 쓴다.
// 서버 layout.js 의 blockLabel 과 같은 모양. title 은 마우스를 올렸을 때 보일 전체 이름(하위 스택은 경로).
const blockHtml = (name, label, title = name) => {
  const i = name.indexOf('__');
  const tool = i === -1 ? name : name.slice(0, i);
  return `<span class="nm" title="${esc(title)}">${esc(label || tool)}</span>${label ? `<span class="real">${esc(tool)}</span>` : ''}`
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
const TIER_LABEL = { off: t('web.client.tier.off'), default: t('web.client.tier.default'), fixed: t('web.client.tier.fixed') };
const TIER_HINT = { off: t('web.client.tierHint.off'), default: t('web.client.tierHint.default'), fixed: t('web.client.tierHint.fixed') };
// auto: 의존성으로 켠 블록, touched: 사람이 직접 켜거나 끈 블록, notes: 마지막 동작에서 함께 켠·끈 안내.
// marked: 켠 묶음 스택(항목이 없어 choices 에 남지 않는다), ancestor: 하위 스택 때문에 켠 조상(그 하위 스택을 풀면 함께 푼다).
const state = {
  data: null, choices: {}, initial: {}, open: new Set(), finished: false, auto: new Set(), touched: new Set(), notes: [], step: 'rules', cat: null,
  marked: new Set(), ancestor: new Set(),
  // 프로젝트 모드의 고정 블록(guideline.json 의 required). 골라진 블록에서만 의미가 있다.
  required: new Set(), initialRequired: new Set(),
  // 개인 모드: 블록 키 → 'add' | 'remove'(없으면 그대로), 처음 상태, 기본값으로 저장할지.
  pc: {}, pInitial: {}, saveDefault: false,
};
const STEPS = ['rules', 'mcp', 'agents', 'skills', 'confirm'];

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
  for (const sel of ['#checklist', '#bar', '#choose', '#dirty', '#personal']) $(sel).hidden = true;
  showError('');
  $('#finished').hidden = false;
  $('#finished-text').textContent = message;
}

const project = () => state.data.project;
const isPersonal = () => state.data?.mode === 'personal';
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
  return requiresOf(state.data.catalog);
}

/** 블록을 이루는 고를 수 있는 항목(반영 불가·사라짐 제외). */
const unitItems = unit => state.data.items.filter(i => i.kind !== 'orphan' && i.state !== 'blocked' && !isRemoved(i) && blockKey(i.id) === unit);
/** 골라진 블록: 항목이 하나라도 체크된 블록과 켠 묶음 스택. */
const chosenUnits = () => new Set([
  ...state.data.items.filter(i => i.kind !== 'orphan' && !isRemoved(i) && isChecked(itemKey(i))).map(i => blockKey(i.id)).filter(Boolean),
  ...state.marked,
]);
const stackOf = unit => unit.slice('rules/'.length);
/** 묶음 스택: 지침·세팅 항목이 하나도 없이 하위 스택만 담은 스택. 켜도 반영할 것이 없고 표시만 남는다. */
const isBundle = unit => unit.startsWith('rules/') && !state.data.items.some(i => (i.kind === 'rule' || i.kind === 'setup') && i.stack === stackOf(unit));

/** 블록의 사람이 읽는 이름(표시 이름, 없으면 이름). */
function unitName(unit) {
  const c = state.data.catalog;
  const [dir, rest] = [unit.slice(0, unit.indexOf('/')), unit.slice(unit.indexOf('/') + 1)];
  const name = dir === 'agents' ? rest.replace(/\.md$/, '') : rest;
  const list = { rules: c.stacks, skills: c.skills, agents: c.subagents, mcp: c.mcp }[dir] ?? [];
  return list.find(x => x.name === name)?.label || name;
}

/** 스택의 모든 항목(지침·세팅)을 함께 켜고 끈다. 지침 단계에는 파일별 선택이 없다. */
function setStack(unit, on) {
  for (const i of unitItems(unit)) state.choices[itemKey(i)].checked = on;
  if (isBundle(unit)) {
    if (on) state.marked.add(unit);
    else state.marked.delete(unit);
  }
}

/** 블록의 항목을 모두 켠다. 이미 골라진 블록은 건드리지 않는다. 켰으면 true. */
function turnOn(unit) {
  if (chosenUnits().has(unit)) return false;
  if (isBundle(unit)) {
    state.marked.add(unit);
    return true;
  }
  const items = unitItems(unit);
  for (const i of items) state.choices[itemKey(i)].checked = true;
  return items.length > 0;
}

/** units 가 필요로 하는 블록을 켜고 안내를 남긴다. 실제로 켜진 블록에서만 넓힌다(selection.js pullRequired). */
function pullRequires(units) {
  for (const { by, needs } of pullRequired(units, requiresMap(), { isChosen: u => chosenUnits().has(u), turnOn })) {
    state.auto.add(needs);
    state.notes.push(t('web.client.autoChecked', { by: unitName(by), needs: unitName(needs) }));
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
      state.notes.push(t('web.client.autoReleased', { by: unitName(unit), needs: unitName(u) }));
    }
  }
}

/** 골라진 하위 스택의 조상을 켠다(조상은 늘 함께 받는다). 새로 켠 조상이 필요로 하는 블록도 켠다. */
function ensureAncestors() {
  const on = [];
  for (const u of chosenUnits()) {
    for (const a of ancestorKeys(u)) {
      if (turnOn(a)) {
        state.ancestor.add(a);
        on.push(a);
      }
    }
  }
  if (on.length) pullRequires(on);
}

/** units 를 풀었을 때 그 때문에 켰던 블록을 함께 끈다. before 는 풀기 전 골라진 블록. */
function releaseDeps(units, before) {
  const gone = new Set(units);
  for (const unit of units) {
    const chosen = new Set([...before].filter(u => u === unit || !gone.has(u)));
    for (const u of releasable(unit, { chosen, auto: state.auto, touched: state.touched, requires: requiresMap() })) {
      if (!chosenUnits().has(u)) continue;
      setStack(u, false);
      state.auto.delete(u);
      state.notes.push(t('web.client.autoReleased', { by: unitName(unit), needs: unitName(u) }));
    }
  }
}

/** 하위 스택을 풀면 그 때문에 켰던 조상을 함께 푼다. 판정(남는 블록이 필요로 하는 조상은 남김)은 selection.js releasableAncestors. */
function releaseAncestors(unit) {
  const chosen = chosenUnits();
  const gone = releasableAncestors(unit, { chosen, ancestor: state.ancestor, touched: state.touched, requires: requiresMap() });
  for (const a of gone) {
    setStack(a, false);
    state.ancestor.delete(a);
    state.notes.push(t('web.client.autoReleased', { by: unitName(unit), needs: unitName(a) }));
  }
  if (gone.length) releaseDeps(gone, chosen);
}

/**
 * 사람이 스택 행의 칸을 켜거나 끈다. 켜면 조상과 필요한 블록을 켜고,
 * 끄면 골라진 자손을 함께 풀고(「하위 스택 n개도 함께 풀림」), 그 때문에 켰던 블록과 조상을 푼다.
 */
function userStack(name, on) {
  const unit = `rules/${name}`;
  const before = chosenUnits();
  setStack(unit, on);
  state.touched.add(unit);
  state.auto.delete(unit);
  state.ancestor.delete(unit);
  if (on && !before.has(unit)) {
    const up = ancestorsToChoose(unit, before).filter(a => turnOn(a));
    for (const a of up) state.ancestor.add(a);
    pullRequires([unit, ...up]);
  }
  if (!on && before.has(unit)) {
    const kids = chosenDescendants(unit, before);
    for (const k of kids) {
      setStack(k, false);
      state.auto.delete(k);
      state.ancestor.delete(k);
    }
    if (kids.length) state.notes.push(t('web.client.childrenReleased', { n: kids.length }));
    releaseDeps([unit, ...kids], before);
    releaseAncestors(unit);
  }
}

/**
 * 사람이 블록의 칸을 고른다. 골라짐이 바뀌면 체크 칸을 바꾼 것과 같다(스택은 userStack, 그 밖은 항목마다 userCheck):
 * 조상·하위 스택·필요한 블록이 함께 움직인다. 그 뒤 이 블록의 required 를 칸대로 둔다.
 */
function userTier(unit, tier) {
  const want = applyTier(unit, tier, { chosen: chosenUnits(), required: state.required });
  if (want.check !== chosenUnits().has(unit)) {
    if (unit.startsWith('rules/')) userStack(stackOf(unit), want.check);
    else for (const i of unitItems(unit)) userCheck(i, want.check);
  }
  if (want.direct) {
    state.touched.add(unit);
    state.auto.delete(unit);
  }
  if (want.required) state.required.add(unit);
  else state.required.delete(unit);
  // 함께 풀린 블록(하위 스택 등)의 고정은 지운다. 나중에 의존성으로 다시 켜질 때 고정으로 되살아나지 않게.
  const chosen = chosenUnits();
  for (const u of [...state.required]) if (!chosen.has(u)) state.required.delete(u);
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
  const recRemove = state.data.recommendRemove ?? {};
  const out = [];
  if (Object.hasOwn(rec, unit)) {
    out.push(`<span class="badge rec">${esc(t('web.client.recommended'))}</span>`);
    if (rec[unit]) out.push(`<span class="why">${esc(t('web.client.why', { why: rec[unit] }))}</span>`);
  } else if (Object.hasOwn(recRemove, unit)) {
    out.push(`<span class="badge rec">${esc(t('web.client.recommendedRemove'))}</span>`);
    if (recRemove[unit]) out.push(`<span class="why">${esc(t('web.client.why', { why: recRemove[unit] }))}</span>`);
  }
  const chosen = chosenUnits();
  if (state.auto.has(unit) && chosen.has(unit)) out.push(`<span class="badge dep">${esc(t('web.client.dependency'))}</span>`);
  // 조상: 골라진 하위 스택 때문에 함께 받는 스택. 끄면 그 하위 스택도 풀린다.
  if (chosen.has(unit) && [...chosen].some(u => u !== unit && isWithin(u, unit))) out.push(`<span class="badge dep">${esc(t('web.client.ancestor'))}</span>`);
  return out.join('');
}

/** 골라진 블록이 필요로 하는데 빠진 블록 경고. */
function missingNotes(unit) {
  return missingRequires(chosenUnits(), requiresMap()).filter(m => m.unit === unit)
    .map(m => t('web.client.missingRequire', { needs: unitName(m.needs), by: unitName(unit) }));
}

/**
 * 블록의 칸(사용 안 함 · 기본 · 고정). 기본·고정은 골라진 블록, 고정은 그중 required 인 것이다(selection.js tierOf).
 * 옛 CLI 의 폼(payload 에 required 가 없음)은 고정을 다루지 않으므로 고정 칸을 끈다.
 */
function tierControl(unit, { disabled = false } = {}) {
  if (!unit) return '';
  const tier = tierOf(unit, { chosen: chosenUnits(), required: state.required });
  const opt = v => {
    const off = disabled || (v === 'fixed' && !state.data.fixedKnown);
    const hint = v === 'fixed' && !state.data.fixedKnown ? t('web.client.tierFixedUnavailable') : TIER_HINT[v];
    return `<label class="tier-opt tier-${v}${tier === v ? ' on' : ''}${off ? ' off' : ''}" title="${esc(hint)}">`
      + `<input type="radio" name="tier:${esc(unit)}" data-tier="${esc(unit)}" value="${v}" ${tier === v ? 'checked' : ''} ${off ? 'disabled' : ''}>${esc(TIER_LABEL[v])}</label>`;
  };
  return `<span class="tier" role="radiogroup" aria-label="${esc(unitName(unit))}">${TIERS.map(opt).join('')}</span>`;
}
const requiredNow = () => {
  const chosen = chosenUnits();
  return [...state.required].filter(u => chosen.has(u)).sort();
};

// select: false 면 선택 칸 없이 보인다(지침 단계의 파일은 스택 행의 칸 하나로 함께 고른다). 'tier' 면 체크박스 대신 칸(after 에 둔다).
// 갱신·덮어쓰기 칸은 남는다.
function rowHtml(item, label, meta, { badges = [], cats = [], nameHtml = null, tags = '', warns = [], select = true, after = '' } = {}) {
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
  if (after) extra.push(after);
  return `<div class="row${action === 'remove' ? ' remove' : ''}${blocked ? ' blocked' : ''}">`
    + (select === true ? `<label class="main"><input type="checkbox" data-key="${esc(key)}" ${choice.checked ? 'checked' : ''} ${blocked ? 'disabled' : ''}>` : select === 'tier' ? '<span class="main">' : '<span class="main file">')
    + `<span class="name">${nameHtml ?? esc(label)}</span>${cats.length ? `<span class="cats">[${esc(cats.join(', '))}]</span>` : ''}${tags}${select === true ? '</label>' : '</span>'}`
    + `<span class="meta">${esc(meta)}</span>`
    + `<span class="state ${esc(stateCls)}">${esc(stateText)}</span>`
    + `<span class="extra">${extra.join('')}</span>`
    + (item.reason ? `<div class="reason">${esc(item.reason)}</div>` : '')
    + warns.map(w => `<div class="reason warn">${esc(w)}</div>`).join('')
    + '</div>';
}

function renderSummary() {
  if (isPersonal()) {
    const sel = pResult();
    $('#summary').textContent = t('web.client.personal.summary', { add: sel.add.length, remove: sel.remove.length });
    $('#submit').textContent = t('web.client.personal.submit');
    return;
  }
  const c = summarize(state.data.items, state.choices);
  $('#summary').textContent = t('web.client.summary', { add: c.add, update: c.update, remove: c.remove });
  $('#submit').textContent = c.remove > 0 ? t('web.client.submitWithRemove', { n: c.remove }) : t('web.client.submit');
  $('#submit').classList.toggle('danger', c.remove > 0);
}

/** 분류 거르기에서 보이는가. 체크 상태와는 상관없다. */
const visible = item => !state.cat || itemCategories(item).includes(state.cat);
/** 단계의 항목(원본에서 사라진 것 포함). */
const stepItems = step => state.data.items.filter(i => stepOf(i) === step);
/** 단계에 고를 것이 있는가. 확인 단계는 늘 있다. */
const hasStep = step => step === 'confirm' || (isPersonal() ? personalUnits(step).length > 0 : stepItems(step).length > 0);

function renderSteps() {
  // 개인 모드는 단계마다 개인 변경(더함·뺌) 수를, 프로젝트 모드는 고정·기본 수를 센다.
  const sel = isPersonal() ? pResult() : null;
  const chosen = sel ? new Set([...sel.add, ...sel.remove]) : chosenUnits();
  const fixed = new Set(sel ? [] : requiredNow());
  const inStep = (set, step) => [...set].filter(u => stepOf({ kind: '', id: u }) === step).length;
  for (const b of document.querySelectorAll('[data-step]')) {
    const step = b.dataset.step;
    const text = sel ? t('web.client.personal.stepReceived', { n: inStep(pReceived(sel), step) })
      : t('web.client.stepTiers', { fixed: inStep(fixed, step), default: inStep(chosen, step) - inStep(fixed, step) });
    const confirmText = sel && chosen.size ? t('web.client.personal.stepCount', { n: chosen.size }) : '';
    b.querySelector('small').textContent = step === 'confirm' ? confirmText : hasStep(step) ? text : t('web.client.stepNone');
    b.classList.toggle('on', step === state.step);
    b.classList.toggle('none', !hasStep(step));
    b.setAttribute('aria-current', step === state.step ? 'step' : 'false');
  }
  const at = STEPS.indexOf(state.step);
  $('#prev').hidden = !STEPS.slice(0, at).some(hasStep);
  $('#next').hidden = state.step === 'confirm';
  $('#submit').hidden = state.step !== 'confirm';
  $('#chips').closest('.toolbar').hidden = state.step === 'confirm';
}

function renderList() {
  if (isPersonal()) {
    $('#list').innerHTML = state.notes.map(n => `<div class="note dep-note">${esc(n)}</div>`).join('') + personalListHtml(state.step);
    renderSteps();
    renderSummary();
    return;
  }
  const { items, catalog, overrides } = state.data;
  const out = [];
  let hidden = 0;
  const step = state.step;
  if (step === 'rules') {
    const tree = stackRows(catalog.stacks);
    const filesOf = s => {
      const rules = items.filter(i => i.kind === 'rule' && i.stack === s.name && !isRemoved(i));
      const setup = items.find(i => i.kind === 'setup' && i.stack === s.name && !isRemoved(i));
      return { rules, setup, all: [...rules, ...(setup ? [setup] : [])] };
    };
    // 분류로 거를 때: 보일 항목이 있는 스택과 그 조상만 보인다(조상 없이 하위 스택만 떠 있지 않게).
    const shownStacks = new Set();
    for (const { stack: s } of tree) {
      const { all } = filesOf(s);
      const self = all.length ? all.some(visible) : !state.cat || s.categories.includes(state.cat);
      if (self) for (const k of [`rules/${s.name}`, ...ancestorKeys(`rules/${s.name}`)]) shownStacks.add(k);
    }
    for (const { stack: s, depth } of tree) {
      const { rules, setup, all } = filesOf(s);
      const shown = all.filter(visible);
      hidden += all.length - shown.length;
      const unit = `rules/${s.name}`;
      if (!shownStacks.has(unit)) continue;
      const live = stackItems(s.name);
      const on = live.filter(i => isChecked(itemKey(i))).length;
      const bundle = isBundle(unit);
      const id = `stack:${s.name}`;
      const fileWhen = path => s.files.find(f => f.path === path)?.when;
      const rows = [
        ...stackNotes(s, rules).map(n => `<div class="note">${esc(n)}</div>`),
        ...missingNotes(unit).map(n => `<div class="note warn">${esc(n)}</div>`),
        ...rules.filter(visible).map(r => {
          const own = itemCategories(r).filter(c => !s.categories.includes(c));
          const n = overrides.filter(o => o.valid && o.target === r.id).length;
          const meta = [r.load, fileWhen(r.id) && t('web.client.when', { when: fileWhen(r.id) })].filter(Boolean).join(' · ');
          return rowHtml(r, r.id.slice(`${unit}/`.length), meta, { badges: n ? [t('web.client.overrideCount', { n })] : [], cats: own, select: false });
        }),
        ...(setup && visible(setup) ? [rowHtml(setup, 'SETUP.md', t('web.client.setupDoc'), { select: false })] : []),
      ];
      const short = s.parent ? s.name.slice(s.parent.length + 1) : s.name;
      out.push(`<details class="group stack-group${depth ? ' child' : ''}" data-group="${esc(id)}" data-depth="${Math.min(depth, 5)}" ${state.open.has(id) ? 'open' : ''}><summary>`
        + `<b>${blockHtml(short, s.label, s.name)}</b>${s.categories.length ? `<span class="cats">[${esc(s.categories.join(', '))}]</span>` : ''}${unitTags(unit)}`
        + `${(project().rootStacks ?? []).includes(s.name) ? `<span class="cats">${esc(t('web.client.inRoot'))}</span>` : ''}`
        + `<span class="meta count">${on}/${live.length}</span>${tierControl(unit, { disabled: !(live.length || bundle) })}`
        + `${s.when ? `<span class="when">${esc(t('web.client.when', { when: s.when }))}</span>` : ''}</summary>${rows.join('')}</details>`);
    }
  }
  const simple = (id, title, list, label, meta) => {
    const shown = list.filter(visible);
    hidden += list.length - shown.length;
    if (shown.length === 0) return;
    const on = shown.filter(i => isChecked(itemKey(i))).length;
    out.push(`<details class="group" data-group="${id}" ${state.open.has(id) ? 'open' : ''}><summary><b>${esc(title)}</b>`
      + `<span class="meta count">${on}/${shown.length}</span></summary>`
      + shown.map(i => rowHtml(i, label(i), meta(i), {
        cats: itemCategories(i), nameHtml: itemLabel(i) ? blockHtml(label(i), itemLabel(i)) : null,
        tags: i.kind === 'orphan' ? '' : unitTags(blockKey(i.id)), warns: i.kind === 'orphan' ? [] : missingNotes(blockKey(i.id)),
        // 원본에서 사라진 것은 칸 대신 체크 해제(제거)로 고른다.
        ...(i.kind === 'orphan' || i.state === 'orphan' || isRemoved(i) ? {} : { select: 'tier', after: tierControl(blockKey(i.id), { disabled: i.state === 'blocked' }) }),
      })).join('') + '</details>');
  };
  const of = kind => items.filter(i => i.kind === kind && !isRemoved(i));
  if (step === 'mcp') simple('mcp', 'MCP', of('mcp'), i => i.id.slice('mcp/'.length), i => (i.build ? t('web.client.fromReadme') : ''));
  if (step === 'agents') simple('subagents', t('web.client.subagents'), of('subagent'), i => i.id.slice('agents/'.length).replace(/\.md$/, ''), () => '');
  if (step === 'skills') simple('skills', t('web.client.skills'), of('skill'), i => i.id.slice('skills/'.length), () => '');
  if (step !== 'confirm') {
    simple(`gone:${step}`, t('web.client.orphan'), items.filter(i => (i.state === 'orphan' || isRemoved(i)) && stepOf(i) === step), i => i.id, () => t('web.client.uncheckDeletes'));
  } else {
    out.push(confirmHtml());
  }
  const notes = state.notes.map(n => `<div class="note dep-note">${esc(n)}</div>`).join('');
  const legend = step === 'confirm' ? '' : `<p class="meta tier-legend">${esc(t('web.client.tierLegend'))}</p>`;
  const hiddenLine = state.cat && hidden ? `<p class="meta hidden-count">${esc(t('web.client.hiddenByCategory', { cat: state.cat, n: hidden }))}</p>` : '';
  $('#list').innerHTML = legend + notes + out.join('') + hiddenLine;
  renderSteps();
  renderSummary();
}

/** 확인 단계: 칸(고정·기본)마다 단계별로 골라진 블록과 빠진 의존성, 사용 안 함 안내. */
function confirmHtml() {
  const chosen = [...chosenUnits()];
  const fixed = new Set(requiredNow());
  const tierPart = (key, cls, units) => {
    if (!units.length) return '';
    const lines = STEPS.filter(s => s !== 'confirm').map(step => {
      const here = units.filter(u => stepOf({ kind: '', id: u }) === step);
      if (!here.length) return '';
      return `<li><b>${esc(t(`web.client.step.${step}`))}</b>: ${here.map(u => `${esc(unitName(u))}${unitTags(u)}`).join(', ')}`
        + here.flatMap(missingNotes).map(w => `<div class="reason warn">${esc(w)}</div>`).join('') + '</li>';
    }).join('');
    return `<section class="confirm-step confirm-${cls}"><h3>${esc(t(key, { n: units.length }))}</h3><ul>${lines}</ul></section>`;
  };
  const parts = tierPart('web.client.confirm.fixed', 'fixed', chosen.filter(u => fixed.has(u)))
    + tierPart('web.client.confirm.default', 'default', chosen.filter(u => !fixed.has(u)));
  return (parts || `<p class="meta">${esc(t('web.client.confirmEmpty'))}</p>`)
    + `<section class="confirm-step confirm-off"><h3>${esc(t('web.client.tier.off'))}</h3><p class="meta">${esc(t('web.client.confirm.off'))}</p></section>`
    + changeList('update') + changeList('remove');
}

/** 확인 단계: 제거·갱신할 항목. 단계마다 흩어진 변화를 제출 전에 한곳에서 보게 한다. */
function changeList(action) {
  const items = state.data.items.filter(i => actionOf(i, state.choices[itemKey(i)]) === action);
  if (!items.length) return '';
  return `<section class="confirm-step confirm-${action}"><h3>${esc(t(`web.client.confirm.${action}`, { n: items.length }))}</h3><ul>`
    + items.map(i => `<li><code>${esc(i.id)}</code></li>`).join('') + '</ul></section>';
}

// 개인 모드: 고정이 아닌 블록마다 켬·끔. 켬·끔은 프로젝트 선택과의 차이(더함·뺌·그대로, selection.js personalTurn)로 기록한다. 판정(조상 더함·자손 뺌·필수 거절)은 selection.js personalSelection 이 하고,
// 서버가 제출 때 같은 함수로 다시 계산한다. 갱신·덮어쓰기·더러운 작업 트리 칸은 없다(커밋되는 파일을 바꾸지 않는다).

/** 개인 모드에서 단계의 블록: 키, 나무 깊이, 원본 목록의 항목. */
function personalUnits(step) {
  const c = state.data.catalog;
  if (step === 'rules') return stackRows(c.stacks).map(({ stack, depth }) => ({ unit: `rules/${stack.name}`, depth, entry: stack }));
  const list = { mcp: c.mcp, agents: c.subagents, skills: c.skills }[step] ?? [];
  return list.map(x => ({ unit: step === 'agents' ? `agents/${x.name}.md` : `${step}/${x.name}`, depth: 0, entry: x }));
}
const pBasis = () => personalBasis(state.data.personal);
const pResult = () => personalSelection({ personal: state.data.personal, choices: state.pc });
/** 개인 선택을 입힌 뒤 받는 블록. */
function pReceived(sel) {
  const out = new Set([...pBasis().inProject].filter(k => !sel.remove.includes(k)));
  for (const k of sel.add) out.add(k);
  return out;
}
/** 원본 목록과 프로젝트 선택의 스택 키. 자손을 찾을 때 쓴다. */
const pStackKeys = () => [...new Set([...state.data.catalog.stacks.map(x => `rules/${x.name}`), ...pBasis().inProject])].filter(k => k.startsWith('rules/'));

// 켬·끔 한 번의 판정(조상·하위 스택 연동)은 selection.js personalTurn. 여기서는 결과를 상태에 두고 안내를 문구로 바꾼다.
const PERSONAL_NOTE = {
  ancestorAdded: n => t('web.client.personal.ancestorAdded', { by: unitName(n.by), needs: unitName(n.needs) }),
  ancestorKept: n => t('web.client.personal.ancestorKept', { by: unitName(n.by), needs: unitName(n.needs) }),
  childrenRemoved: n => t('web.client.personal.childrenRemoved', { n: n.n }),
  childrenReset: n => t('web.client.personal.childrenReset', { n: n.n }),
};
function userTurn(unit, on) {
  const r = personalTurn({ personal: state.data.personal, choices: state.pc, unit, on, stackKeys: pStackKeys() });
  state.pc = r.choices;
  for (const n of r.notes) state.notes.push(PERSONAL_NOTE[n.key](n));
}

/**
 * 기준(프로젝트 선택, 역할 폼이면 프로젝트 + 내 공통 선택)에 있는 블록의 표시. 프로젝트가 받는 것은 「기본」,
 * 역할 폼에서 공통 선택이 더한 것은 「내 공통 선택」. payload 에 프로젝트만의 선택(personal.project)이 없으면(옛 CLI) 모두 「기본」.
 */
function basisTag(unit) {
  const p = state.data.personal;
  const fromCommon = typeof p.role === 'string' && p.role && Array.isArray(p.project) && !personalBasis({ chosen: p.project }).inProject.has(unit);
  return fromCommon ? t('web.client.personal.commonTag') : t('web.client.personal.defaultTag');
}

/** 고정(필수와 그것을 품은 조상)은 잠긴 줄, 나머지는 켬·끔 토글. 하위 스택은 같은 묶음 안의 조상 수만큼 들여 쓴다. */
function personalRow({ unit, entry }, depth, received, sel) {
  const { inProject, guarded } = pBasis();
  const here = inProject.has(unit);
  // 스위치와 표시는 날 선택값이 아니라 실제 결과로 그린다(뺀 스택 아래의 더함은 결과에서 빠지므로).
  const effect = sel.add.includes(unit) ? 'add' : sel.remove.includes(unit) ? 'remove' : null;
  const short = unit.startsWith('rules/') && entry.parent ? entry.name.slice(entry.parent.length + 1) : entry.name;
  const rec = state.data.recommend ?? {};
  const warns = received.has(unit) ? missingRequires(received, requiresMap()).filter(m => m.unit === unit)
    .map(m => t('web.client.missingRequire', { needs: unitName(m.needs), by: unitName(unit) })) : [];
  const cats = entry.categories ?? [];
  const tags = [];
  let control;
  if (guarded.has(unit)) {
    const fixed = (state.data.personal.required ?? []).includes(unit);
    control = `<span class="badge lock">${esc(t(fixed ? 'web.client.personal.locked' : 'web.client.personal.lockedAncestor'))}</span>`;
  } else {
    const on = received.has(unit);
    if (here) tags.push(`<span class="state p-in">${esc(basisTag(unit))}</span>`);
    if (effect === 'add') tags.push(`<span class="act act-add">${esc(t('web.client.personal.turnedOn'))}</span>`);
    if (effect === 'remove') tags.push(`<span class="act act-remove">${esc(t('web.client.personal.turnedOff'))}</span>`);
    control = `<label class="switch${on ? ' on' : ''}"><input type="checkbox" role="switch" data-toggle="${esc(unit)}" ${on ? 'checked' : ''} aria-label="${esc(unitName(unit))}">`
      + `<span class="knob" aria-hidden="true"></span><span class="switch-text">${esc(t(on ? 'web.client.personal.on' : 'web.client.personal.off'))}</span></label>`;
  }
  return `<div class="row prow${effect === 'remove' ? ' turned-off' : ''}${depth ? ' child' : ''}" data-depth="${Math.min(depth, 5)}" data-unit="${esc(unit)}">`
    + `<span class="main"><span class="name">${blockHtml(short, entry.label, entry.name)}</span>`
    + `${cats.length ? `<span class="cats">[${esc(cats.join(', '))}]</span>` : ''}`
    + `${Object.hasOwn(rec, unit) ? `<span class="badge rec">${esc(t('web.client.recommended'))}</span>` : ''}</span>`
    + `<span class="extra">${tags.join('')}</span>${control}`
    + (entry.when ? `<div class="reason">${esc(t('web.client.when', { when: entry.when }))}</div>` : '')
    + warns.map(w => `<div class="reason warn">${esc(w)}</div>`).join('')
    + '</div>';
}

/** 개인 모드 목록: 「고정」 묶음 → 「켜고 끄기」 묶음. 분류로 거를 때 지침 단계는 보일 스택의 조상도 보인다. */
function personalListHtml(step) {
  const sel = pResult();
  if (step === 'confirm') return personalConfirmHtml(sel);
  const received = pReceived(sel);
  const { guarded } = pBasis();
  const units = personalUnits(step);
  const own = x => !state.cat || (x.entry.categories ?? []).includes(state.cat);
  const shown = new Set(units.filter(own).flatMap(x => [x.unit, ...ancestorKeys(x.unit)]));
  const visibleUnits = units.filter(x => shown.has(x.unit));
  const group = (key, hint, cls, list) => {
    if (!list.length) return '';
    const inGroup = new Set(list.map(x => x.unit));
    return `<h3 class="pgroup">${esc(t(key))} <small>${esc(t(hint))}</small></h3>`
      + `<div class="group personal-list ${cls}">${list.map(x => personalRow(x, ancestorKeys(x.unit).filter(a => inGroup.has(a)).length, received, sel)).join('')}</div>`;
  };
  const hidden = units.length - visibleUnits.length;
  return group('web.client.personal.fixedGroup', 'web.client.personal.fixedGroupHint', 'fixed-list', visibleUnits.filter(x => guarded.has(x.unit)))
    + group('web.client.personal.toggleGroup', 'web.client.personal.toggleGroupHint', 'toggle-list', visibleUnits.filter(x => !guarded.has(x.unit)))
    + (state.cat && hidden ? `<p class="meta hidden-count">${esc(t('web.client.hiddenByCategory', { cat: state.cat, n: hidden }))}</p>` : '');
}

/** 개인 모드 확인 단계: 받는 것(고정 · 기본 · 내가 켬), 내가 켠 것·끈 것과 「이 선택을 내 기본값으로」. */
function personalConfirmHtml(sel) {
  const { inProject, guarded } = pBasis();
  const received = [...pReceived(sel)];
  const list = (key, cls, units) => (units.length
    ? `<section class="confirm-step confirm-${cls}"><h3>${esc(t(key, { n: units.length }))}</h3><ul>`
      + units.map(u => `<li>${esc(unitName(u))} <code>${esc(u)}</code></li>`).join('') + '</ul></section>'
    : '');
  const detail = t('web.client.personal.confirm.receivedDetail', {
    fixed: received.filter(u => guarded.has(u)).length,
    default: received.filter(u => inProject.has(u) && !guarded.has(u)).length,
    on: sel.add.length,
  });
  const head = `<section class="confirm-step confirm-received"><h3>${esc(t('web.client.personal.confirm.received', { n: received.length }))}</h3><p class="meta">${esc(detail)}</p></section>`;
  const changes = list('web.client.personal.confirm.on', 'add', sel.add) + list('web.client.personal.confirm.off', 'remove', sel.remove);
  return head + (changes || `<p class="meta">${esc(t('web.client.personal.confirmEmpty'))}</p>`)
    + `<section class="confirm-step save-default"><label><input type="checkbox" data-save-default ${state.saveDefault ? 'checked' : ''}> ${esc(t('web.client.personal.saveDefault'))}</label>`
    + `<p class="meta">${esc(t('web.client.personal.saveDefaultHint'))}</p></section>`;
}

function renderChips() {
  const cats = isPersonal() ? personalUnits(state.step).flatMap(x => x.entry.categories ?? []) : stepItems(state.step).flatMap(i => itemCategories(i));
  const chips = [...new Set(cats)].sort((a, b) => a.localeCompare(b, 'ko'));
  if (state.cat && !chips.includes(state.cat)) chips.unshift(state.cat);
  $('#chips').innerHTML = chips.length
    ? [`<button type="button" class="chip${state.cat ? '' : ' on'}" data-cat="">${esc(t('web.client.allCategories'))}</button>`,
      ...chips.map(c => `<button type="button" class="chip${c === state.cat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)].join('')
    : `<span class="meta">${esc(t('web.client.noCategories'))}</span>`;
}

/** 단계를 옮긴다. 고를 것이 없는 단계는 건너뛴다. */
function goStep(step) {
  state.step = step;
  renderChips();
  renderList();
  window.scrollTo?.(0, 0);
}
const nextStep = dir => {
  const at = STEPS.indexOf(state.step);
  const list = dir > 0 ? STEPS.slice(at + 1) : STEPS.slice(0, at).reverse();
  return list.find(hasStep);
};

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

/** 목록을 다시 그리면 바꾼 입력이 새 요소로 바뀌어 포커스를 잃는다. 같은 입력에 포커스를 되돌려 화살표·Space 조작이 이어지게 한다. */
function refocus(selector) {
  $('#list').querySelector(selector)?.focus();
}

$('#list').addEventListener('change', e => {
  const t = e.target;
  if ('saveDefault' in t.dataset) {
    state.saveDefault = t.checked;
    return;
  }
  state.notes = [];
  if (t.dataset.toggle) {
    userTurn(t.dataset.toggle, t.checked);
    renderList();
    refocus(`input[data-toggle="${CSS.escape(t.dataset.toggle)}"]`);
    return;
  }
  if (t.dataset.tier) {
    userTier(t.dataset.tier, t.value);
    ensureAncestors();
    renderList();
    refocus(`input[data-tier="${CSS.escape(t.dataset.tier)}"][value="${CSS.escape(t.value)}"]`);
    return;
  }
  if (t.dataset.key) userCheck(state.data.items.find(i => itemKey(i) === t.dataset.key), t.checked);
  else if (t.dataset.update) state.choices[t.dataset.update].update = t.checked;
  else if (t.dataset.overwrite) state.choices[t.dataset.overwrite].overwrite = t.checked;
  else return;
  ensureAncestors();
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
// 분류 칩은 거르기만 한다. 체크 상태는 바꾸지 않는다. 고른 분류는 단계를 옮겨도 남는다.
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  state.cat = b.dataset.cat || null;
  renderChips();
  renderList();
});
$('#steps').addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (b && hasStep(b.dataset.step)) goStep(b.dataset.step);
});
$('#next').addEventListener('click', () => {
  const s = nextStep(1);
  if (s) goStep(s);
});
$('#prev').addEventListener('click', () => {
  const s = nextStep(-1);
  if (s) goStep(s);
});
$('#reset').addEventListener('click', () => {
  state.choices = structuredClone(state.initial);
  state.auto = new Set(state.initialAuto);
  state.marked = new Set(state.initialMarked);
  state.ancestor = new Set(state.initialAncestor);
  state.touched = new Set();
  state.required = new Set(state.initialRequired);
  state.pc = structuredClone(state.pInitial);
  state.saveDefault = false;
  state.notes = [];
  renderList();
});
$('#submit').addEventListener('click', async () => {
  showError('');
  const body = isPersonal()
    ? { personalChoices: state.pc, saveDefault: state.saveDefault }
    : { choices: state.choices, force: $('#force').checked, required: requiredNow() };
  if (!isPersonal() && needsForm()) {
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
  if (state.data && isPersonal()) {
    // 미리 체크: 이 프로젝트의 내 개인 선택이나 내 기본값(preset). 의미 없는 것(프로젝트에 이미 있는 더함 등)은 버린다.
    state.pc = personalChoices(state.data.personal);
    state.pInitial = structuredClone(state.pc);
    $('#choose').hidden = true;
    $('#dirty').hidden = true;
    $('#personal').hidden = false;
    $('#personal-intro').textContent = t('web.client.personal.intro');
    const preset = state.data.personal.preset;
    $('#preset').hidden = preset !== 'local' && preset !== 'defaults';
    if (!$('#preset').hidden) $('#preset').textContent = t(`web.client.personal.preset.${preset}`);
  } else if (state.data) {
    state.required = new Set(state.data.required ?? []);
    state.initialRequired = new Set(state.required);
  }
  if (state.data && !isPersonal()) {
    // 처음 체크(스택 통째로, 에이전트 추천과 그 의존성·조상, 빼라는 추천)는 selection.js initialChoices — pick --yes 와 같은 계산이다.
    const init = initialChoices({
      items: state.data.items, catalog: state.data.catalog,
      recommend: Object.keys(state.data.recommend ?? {}), remove: Object.keys(state.data.recommendRemove ?? {}),
    });
    state.choices = init.choices;
    state.marked = init.marked;
    state.auto = init.auto;
    state.ancestor = init.ancestor;
    for (const p of init.pulled) state.notes.push(t('web.client.autoChecked', { by: unitName(p.by), needs: unitName(p.needs) }));
    if (init.childrenReleased) state.notes.push(t('web.client.childrenReleased', { n: init.childrenReleased }));
    for (const r of init.released) state.notes.push(t('web.client.autoReleased', { by: unitName(r.by), needs: unitName(r.needs) }));
    state.initial = structuredClone(state.choices);
    state.initialAuto = new Set(state.auto);
    state.initialMarked = new Set(state.marked);
    state.initialAncestor = new Set(state.ancestor);
    $('#choose').hidden = !needsForm();
    $('#dirty').hidden = project().isNew === true || (project().gitRepo && !project().dirty);
    state.open = new Set(['gone:rules', 'gone:mcp', 'gone:agents', 'gone:skills', 'skills', 'subagents', 'mcp']);
    openCheckedStacks();
  }
  if (state.data) {
    state.step = STEPS.find(hasStep);
    renderChips();
    renderList();
    call('ping').catch(() => {});
    setInterval(() => {
      if (!state.finished) call('ping').catch(() => {});
    }, PING_MS);
  }
}
