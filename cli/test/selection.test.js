import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { itemKey, defaultChoice, canUpdate, actionOf, selectionItems, summarize, buildResult, stackRows, ancestorsToChoose, chosenDescendants, releasableAncestors } from '../src/selection.js';

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
