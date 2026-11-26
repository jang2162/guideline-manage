import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { itemKey, defaultChoice, canUpdate, actionOf, selectionItems, summarize, buildResult, buildSelection, stackRows, ancestorsToChoose, chosenDescendants, releasableAncestors, personalChoices, personalSelection, personalBasis } from '../src/selection.js';

test('selection.js 는 브라우저에서도 돌도록 ./blocks.js 말고는 import 하지 않고, blocks.js 는 아무것도 import 하지 않는다', () => {
  const text = fs.readFileSync(new URL('../src/selection.js', import.meta.url), 'utf8');
  assert.deepEqual([...text.matchAll(/^\s*import .*?from\s+'([^']+)'/gm)].map(m => m[1]), ['./blocks.js']);
  assert.doesNotMatch(text, /require\(|node:/);
  const blocks = fs.readFileSync(new URL('../src/blocks.js', import.meta.url), 'utf8');
  assert.doesNotMatch(blocks, /^\s*import /m);
  assert.doesNotMatch(blocks, /require\(|node:/);
});

test('itemKey 는 kind 와 id 를 잇는다', () => {
  assert.equal(itemKey({ kind: 'rule', id: 'rules/base/00-a.md' }), 'rule:rules/base/00-a.md');
});

test('defaultChoice 는 프로젝트에 있는 것과 원본에서 사라진 것을 켠다', () => {
  for (const s of ['same', 'different', 'moved', 'present', 'orphan']) assert.equal(defaultChoice({ state: s }).checked, true, s);
  for (const s of ['missing', 'unknown', 'blocked']) assert.equal(defaultChoice({ state: s }).checked, false, s);
  assert.equal(defaultChoice({ state: 'different' }).update, false);
});

test('canUpdate 는 different·moved·present 에만 참이다', () => {
  assert.deepEqual(
    ['same', 'different', 'moved', 'present', 'unknown', 'missing', 'blocked', 'orphan'].filter(s => canUpdate({ state: s })),
    ['different', 'moved', 'present'],
  );
});

test('actionOf 는 스펙의 action 표를 따른다', () => {
  const on = { checked: true, update: false };
  const upd = { checked: true, update: true };
  const off = { checked: false, update: false };
  const cases = [
    ['missing', on, 'add'], ['unknown', on, 'add'], ['same', on, 'keep'], ['same', upd, 'keep'],
    ['different', on, 'keep'], ['different', upd, 'update'], ['moved', upd, 'update'], ['present', upd, 'update'], ['present', on, 'keep'],
    ['same', off, 'remove'], ['different', off, 'remove'], ['moved', off, 'remove'], ['present', off, 'remove'],
    ['orphan', off, 'remove'], ['orphan', on, null], ['missing', off, null], ['unknown', off, null], ['blocked', on, null],
  ];
  for (const [s, c, want] of cases) assert.equal(actionOf({ state: s }, c), want, `${s} ${JSON.stringify(c)}`);
});

test('selectionItems 는 choices 에 없는 항목에 처음 상태를 쓰고 내지 않을 항목은 뺀다', () => {
  const items = [
    { kind: 'rule', id: 'rules/base/00-a.md', state: 'same' },
    { kind: 'rule', id: 'rules/base/01-b.md', state: 'missing' },
    { kind: 'skill', id: 'skills/x', state: 'different', where: ['.claude/skills/x'] },
    { kind: 'mcp', id: 'mcp/y', state: 'missing', build: false },
  ];
  assert.deepEqual(selectionItems(items, {
    'rule:rules/base/01-b.md': { checked: true },
    'skill:skills/x': { checked: true, update: true },
  }), [
    { kind: 'rule', id: 'rules/base/00-a.md', state: 'same', action: 'keep' },
    { kind: 'rule', id: 'rules/base/01-b.md', state: 'missing', action: 'add' },
    { kind: 'skill', id: 'skills/x', state: 'different', where: ['.claude/skills/x'], action: 'update' },
  ]);
  assert.deepEqual(summarize(items, {}), { add: 0, update: 0, remove: 0 });
  assert.deepEqual(summarize(items, { 'rule:rules/base/00-a.md': { checked: false } }), { add: 0, update: 0, remove: 1 });
});

test('buildResult 는 version 1 과 프로젝트·항목·바꿈을 담는다', () => {
  const project = { path: '/p', created: false, form: 'ruler', instructionFiles: [], agents: null };
  const overrides = [{ file: '.ruler/a/override.md', stack: 'a', heading: 'h', target: 'rules/a/00-x.md', title: null, valid: true }];
  const r = buildResult({
    docsRoot: '/d',
    project,
    inspection: { items: [{ kind: 'rule', id: 'rules/a/00-x.md', state: 'missing' }], overrides },
    choices: { 'rule:rules/a/00-x.md': { checked: true } },
  });
  assert.deepEqual(r, {
    version: 1,
    docsRoot: '/d',
    project,
    items: [{ kind: 'rule', id: 'rules/a/00-x.md', state: 'missing', action: 'add' }],
    overrides,
    blocked: [],
  });
});

test('buildResult 는 반영할 수 없는 blocked 항목을 이유와 함께 따로 담는다', () => {
  const items = [{ kind: 'rule', id: 'rules/a/00-x.md', stack: 'a', load: null, state: 'blocked', reason: 'frontmatter 에 load 없음' }];
  const r = buildResult({ docsRoot: '/d', project: {}, inspection: { items, overrides: [] }, choices: {} });
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.blocked, [{ kind: 'rule', id: 'rules/a/00-x.md', stack: 'a', reason: 'frontmatter 에 load 없음' }]);
});

test('stackRows 는 부모 바로 아래에 자식을 깊이와 함께 두고, 형제는 받은 순서를 지킨다', () => {
  const stacks = [
    { name: 'base', parent: null }, { name: 'base-x', parent: null }, { name: 'base/browser', parent: 'base' },
    { name: 'base/browser/deep', parent: 'base/browser' }, { name: 'base/a', parent: 'base' }, { name: 'lone/kid', parent: 'lone' },
  ];
  assert.deepEqual(stackRows(stacks).map(r => [r.stack.name, r.depth]), [
    ['base', 0], ['base/browser', 1], ['base/browser/deep', 2], ['base/a', 1], ['base-x', 0], ['lone/kid', 0],
  ]);
  assert.deepEqual(stackRows([{ name: 'old' }]).map(r => [r.stack.name, r.depth]), [['old', 0]], 'parent 가 없는 옛 catalog 도 최상위로');
});

test('ancestorsToChoose 는 골라지지 않은 조상을 가까운 것부터, chosenDescendants 는 골라진 자손만 낸다', () => {
  assert.deepEqual(ancestorsToChoose('rules/a/b/c', new Set(['rules/a'])), ['rules/a/b']);
  assert.deepEqual(ancestorsToChoose('rules/a/b/c', new Set()), ['rules/a/b', 'rules/a']);
  assert.deepEqual(ancestorsToChoose('rules/a', new Set()), []);
  assert.deepEqual(ancestorsToChoose('skills/s', new Set()), []);
  const chosen = new Set(['rules/a', 'rules/a/b', 'rules/a/b/c', 'rules/a-x', 'rules/ab', 'skills/s']);
  assert.deepEqual(chosenDescendants('rules/a', chosen), ['rules/a/b', 'rules/a/b/c'], '자기 자신·이름이 a 로 시작하는 형제(a-x, ab)는 빼고');
});

const R = (unit, chosen, { ancestor = [], touched = [], requires = {} } = {}) => releasableAncestors(unit, {
  chosen: new Set(chosen), ancestor: new Set(ancestor), touched: new Set(touched), requires,
});

test('releasableAncestors: 하위 스택을 풀면 그 때문에 켠 조상을 가까운 것부터 함께 푼다', () => {
  assert.deepEqual(R('rules/base/browser', ['rules/base'], { ancestor: ['rules/base'] }), ['rules/base']);
  assert.deepEqual(R('rules/a/b/c', ['rules/a', 'rules/a/b'], { ancestor: ['rules/a', 'rules/a/b'] }), ['rules/a/b', 'rules/a']);
});

test('releasableAncestors: 남는 골라진 블록이 (간접으로도) 필요로 하는 조상은 풀지 않는다', () => {
  // 재현: base/browser 를 켬 → base 가 조상으로 켜짐 → 스킬 S(requires rules/base)를 켬 → base/browser 를 끔.
  assert.deepEqual(R('rules/base/browser', ['rules/base', 'skills/s'], {
    ancestor: ['rules/base'], touched: ['skills/s'], requires: { 'skills/s': ['rules/base'] },
  }), []);
  assert.deepEqual(R('rules/base/browser', ['rules/base', 'skills/s', 'mcp/m'], {
    ancestor: ['rules/base'], requires: { 'skills/s': ['mcp/m'], 'mcp/m': ['rules/base'] },
  }), [], '간접으로 필요해도');
  // 가까운 조상은 풀리고, 남는 블록이 필요로 하는 먼 조상은 남는다.
  assert.deepEqual(R('rules/a/b/c', ['rules/a', 'rules/a/b', 'skills/s'], {
    ancestor: ['rules/a', 'rules/a/b'], requires: { 'skills/s': ['rules/a'] },
  }), ['rules/a/b']);
  // 함께 풀리는 조상끼리의 의존은 남길 이유가 되지 않는다.
  assert.deepEqual(R('rules/a/b/c', ['rules/a', 'rules/a/b'], {
    ancestor: ['rules/a', 'rules/a/b'], requires: { 'rules/a/b': ['rules/a'] },
  }), ['rules/a/b', 'rules/a']);
});

test('releasableAncestors: 골라진 다른 자손이 있거나, 사람이 만졌거나, 조상으로 켠 것이 아니면 거기서 멈춘다', () => {
  assert.deepEqual(R('rules/a/b/c', ['rules/a', 'rules/a/b', 'rules/a/x'], { ancestor: ['rules/a', 'rules/a/b'] }), ['rules/a/b']);
  assert.deepEqual(R('rules/a/b/c', ['rules/a', 'rules/a/b'], { ancestor: ['rules/a', 'rules/a/b'], touched: ['rules/a/b'] }), []);
  assert.deepEqual(R('rules/a/b/c', ['rules/a', 'rules/a/b'], { ancestor: ['rules/a'] }), []);
  assert.deepEqual(R('rules/a/b', ['rules/a/b/c'], { ancestor: ['rules/a'] }), [], '골라지지 않은 조상');
});

// 개인 모드. 프로젝트는 base(필수)·base/browser·web 을 받고, tools·tools/deep·skills/s 는 받지 않는다.
const PERSONAL = {
  chosen: ['rules/base', 'rules/base/browser', 'rules/web', 'rules/web/react'],
  required: ['rules/base/browser'],
  add: [], remove: [], preset: 'none',
};

test('personalSelection 은 필수와 그 조상의 뺌을 거절한다', () => {
  const r = personalSelection({ personal: PERSONAL, choices: { 'rules/base/browser': 'remove', 'rules/base': 'remove', 'rules/web': 'remove' }, saveDefault: false });
  assert.deepEqual(r.rejected, ['rules/base', 'rules/base/browser']);
  assert.deepEqual(r.remove, ['rules/web', 'rules/web/react']);
  assert.equal(r.mode, 'personal');
  assert.equal(r.saveDefault, false);
});

test('personalSelection 은 더한 하위 스택의 조상을 더하고 뺀 스택의 자손을 뺀다', () => {
  const r = personalSelection({
    personal: PERSONAL,
    choices: { 'rules/tools/deep': 'add', 'rules/web': 'remove', 'rules/base/browser/x': 'add', 'skills/s': 'add' },
    saveDefault: true,
  });
  assert.deepEqual(r.add, ['rules/base/browser/x', 'rules/tools', 'rules/tools/deep', 'skills/s'], '프로젝트에 있는 조상(base·base/browser)은 더하지 않는다');
  assert.deepEqual(r.remove, ['rules/web', 'rules/web/react']);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.saveDefault, true);
});

test('personalSelection 은 프로젝트에 있는 블록의 더함과 없는 블록의 뺌을 버리고, 뺀 스택 아래의 더함도 버린다', () => {
  const r = personalSelection({
    personal: PERSONAL,
    choices: { 'rules/base': 'add', 'skills/none': 'remove', 'rules/web': 'remove', 'rules/web/extra': 'add', 'rules/tools': 'keep' },
    saveDefault: false,
  });
  assert.deepEqual(r.add, []);
  assert.deepEqual(r.remove, ['rules/web', 'rules/web/react']);
  // 조상만으로 받는 스택(자손이 골라져 있음)도 프로젝트에 있는 것이라 뺄 수 있다.
  const only = personalSelection({ personal: { ...PERSONAL, chosen: ['rules/a/b'], required: [] }, choices: { 'rules/a': 'remove' }, saveDefault: false });
  assert.deepEqual(only.remove, ['rules/a', 'rules/a/b']);
  // 없는 스택의 뺌은 버리므로 그 아래의 더함을 막지 않는다.
  const absent = personalSelection({ personal: PERSONAL, choices: { 'rules/tools': 'remove', 'rules/tools/deep': 'add' }, saveDefault: false });
  assert.deepEqual([absent.add, absent.remove], [['rules/tools', 'rules/tools/deep'], []]);
});

test('personalChoices 는 미리 체크한 add·remove 를 의미 있는 것만 초기 상태로 바꾼다', () => {
  const c = personalChoices({ ...PERSONAL, add: ['rules/tools/deep', 'rules/base'], remove: ['rules/web', 'rules/base', 'skills/none'], preset: 'defaults' });
  assert.deepEqual(c, { 'rules/tools': 'add', 'rules/tools/deep': 'add', 'rules/web': 'remove', 'rules/web/react': 'remove' });
});

test('buildSelection 은 프로젝트 모드에서 체크된 블록의 필수만 싣는다', () => {
  const items = [
    { kind: 'rule', id: 'rules/base/00-a.md', stack: 'base', state: 'same' },
    { kind: 'rule', id: 'rules/web/00-a.md', stack: 'web', state: 'same' },
    { kind: 'rule', id: 'rules/lib/x/00-a.md', stack: 'lib/x', state: 'missing' },
    { kind: 'skill', id: 'skills/s/SKILL.md', state: 'missing' },
  ];
  const choices = {
    'rule:rules/web/00-a.md': { checked: false },
    'rule:rules/lib/x/00-a.md': { checked: true },
    'skill:skills/s/SKILL.md': { checked: false },
  };
  const sel = buildSelection({ revision: 3, items, choices, project: null, required: ['rules/base', 'rules/web', 'skills/s', 'rules/lib', 'rules/lib/x', 'rules/zzz'] });
  assert.deepEqual(sel.required, ['rules/base', 'rules/lib', 'rules/lib/x']);
  assert.equal(Object.hasOwn(buildSelection({ revision: 3, items, choices, project: null }), 'required'), false, '필수를 주지 않으면 싣지 않는다');
});

test('tierOf: 고정은 골라졌고 required, 기본은 골라지기만, 사용 안 함은 안 골라짐', async () => {
  const { tierOf } = await import('../src/selection.js');
  const chosen = new Set(['rules/a', 'rules/b']);
  const required = new Set(['rules/a', 'rules/c']);
  assert.equal(tierOf('rules/a', { chosen, required }), 'fixed');
  assert.equal(tierOf('rules/b', { chosen, required }), 'default');
  // required 에 있어도 골라지지 않았으면 사용 안 함(풀린 블록의 required 는 제출에서도 빠진다)
  assert.equal(tierOf('rules/c', { chosen, required }), 'off');
  assert.equal(tierOf('rules/d', { chosen, required }), 'off');
});

test('applyTier: 칸마다 블록의 체크와 required', async () => {
  const { applyTier } = await import('../src/selection.js');
  const ctx = { chosen: new Set(), required: new Set() };
  assert.deepEqual(applyTier('rules/a', 'fixed', ctx), { check: true, required: true, direct: true });
  assert.deepEqual(applyTier('rules/a', 'default', ctx), { check: true, required: false, direct: true });
  assert.deepEqual(applyTier('rules/a', 'off', ctx), { check: false, required: false, direct: false });
  assert.throws(() => applyTier('rules/a', 'bogus', ctx));
});

test('applyTier 의 결과를 입히면 tierOf 가 그 칸을 돌려준다', async () => {
  const { applyTier, tierOf } = await import('../src/selection.js');
  for (const tier of ['off', 'default', 'fixed']) {
    for (const start of [[[], []], [['rules/a'], []], [['rules/a'], ['rules/a']]]) {
      const chosen = new Set(start[0]);
      const required = new Set(start[1]);
      const r = applyTier('rules/a', tier, { chosen, required });
      if (r.check) chosen.add('rules/a'); else chosen.delete('rules/a');
      if (r.required) required.add('rules/a'); else required.delete('rules/a');
      assert.equal(tierOf('rules/a', { chosen, required }), tier);
    }
  }
});

test('toggleOn: 기준에 있으면 뺌이 아닐 때 받고, 없으면 더함일 때만 받는다', async () => {
  const { toggleOn } = await import('../src/selection.js');
  assert.equal(toggleOn('rules/a', 'keep', true), true);
  assert.equal(toggleOn('rules/a', 'remove', true), false);
  assert.equal(toggleOn('rules/a', 'keep', false), false);
  assert.equal(toggleOn('rules/a', 'add', false), true);
});

test('toggleTo: 기준에 있으면 켬=그대로·끔=뺌, 없으면 켬=더함·끔=그대로', async () => {
  const { toggleTo } = await import('../src/selection.js');
  assert.equal(toggleTo(true, true), 'keep');
  assert.equal(toggleTo(false, true), 'remove');
  assert.equal(toggleTo(true, false), 'add');
  assert.equal(toggleTo(false, false), 'keep');
});

test('toggleTo 와 toggleOn 은 서로 되돌린다', async () => {
  const { toggleOn, toggleTo } = await import('../src/selection.js');
  for (const inBasis of [true, false]) {
    for (const on of [true, false]) assert.equal(toggleOn('rules/a', toggleTo(on, inBasis), inBasis), on);
  }
});

// 로컬 폼의 켬·끔 한 번(personalTurn). 프로젝트는 base·base/x·web 을 받는다.
const TURN = { chosen: ['rules/base', 'rules/base/x', 'rules/web'], required: [] };
const TURN_KEYS = ['rules/base', 'rules/base/x', 'rules/base/y', 'rules/web', 'rules/tools', 'rules/tools/deep'];
const received = (personal, choices) => {
  const sel = personalSelection({ personal, choices });
  const out = new Set(personalBasis(personal).inProject);
  for (const k of sel.remove) out.delete(k);
  for (const k of sel.add) out.add(k);
  return out;
};

test('personalTurn: 뺀 스택 아래 블록을 켜면 뺀 조상을 되돌려 실제로 받는다(켰는데 안 켜짐이 없다)', async () => {
  const { personalTurn } = await import('../src/selection.js');
  let r = personalTurn({ personal: TURN, choices: {}, unit: 'rules/base', on: false, stackKeys: TURN_KEYS });
  assert.deepEqual(r.choices, { 'rules/base': 'remove', 'rules/base/x': 'remove' });
  assert.deepEqual(r.notes, [{ key: 'childrenRemoved', n: 1 }]);
  r = personalTurn({ personal: TURN, choices: r.choices, unit: 'rules/base/x', on: true, stackKeys: TURN_KEYS });
  assert.ok(received(TURN, r.choices).has('rules/base/x'), 'base/x 를 받는다');
  assert.ok(received(TURN, r.choices).has('rules/base'), '조상 base 도 다시 받는다');
  assert.deepEqual(r.notes, [{ key: 'ancestorKept', by: 'rules/base/x', needs: 'rules/base' }]);
});

test('personalTurn: 기준 밖 하위 스택을 켜면 조상을 더하고, 끄면 그 블록만 기록이 없어진다', async () => {
  const { personalTurn } = await import('../src/selection.js');
  let r = personalTurn({ personal: TURN, choices: {}, unit: 'rules/tools/deep', on: true, stackKeys: TURN_KEYS });
  assert.deepEqual(r.choices, { 'rules/tools': 'add', 'rules/tools/deep': 'add' });
  assert.deepEqual(r.notes, [{ key: 'ancestorAdded', by: 'rules/tools/deep', needs: 'rules/tools' }]);
  r = personalTurn({ personal: TURN, choices: r.choices, unit: 'rules/tools/deep', on: false, stackKeys: TURN_KEYS });
  assert.deepEqual(r.choices, { 'rules/tools': 'add' });
});

test('personalTurn: 켬·끔은 실제로 받는지와 늘 맞는다(한 번 바꾼 뒤마다)', async () => {
  const { personalTurn } = await import('../src/selection.js');
  // 모든 순서의 두 단계 조작에서, 마지막으로 바꾼 블록은 고른 대로 받거나 안 받는다
  for (const a of TURN_KEYS) for (const b of TURN_KEYS) for (const onA of [true, false]) for (const onB of [true, false]) {
    let c = personalTurn({ personal: TURN, choices: {}, unit: a, on: onA, stackKeys: TURN_KEYS }).choices;
    c = personalTurn({ personal: TURN, choices: c, unit: b, on: onB, stackKeys: TURN_KEYS }).choices;
    assert.equal(received(TURN, c).has(b), onB, `${a}=${onA} → ${b}=${onB}`);
  }
});

test('applyTier: 기본·고정은 사람이 직접 고른 것(direct), 사용 안 함은 아니다', async () => {
  const { applyTier } = await import('../src/selection.js');
  const ctx = { chosen: new Set(), required: new Set() };
  assert.equal(applyTier('rules/a', 'fixed', ctx).direct, true);
  assert.equal(applyTier('rules/a', 'default', ctx).direct, true);
  assert.equal(applyTier('rules/a', 'off', ctx).direct, false);
});
