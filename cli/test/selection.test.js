import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { itemKey, defaultChoice, canUpdate, actionOf, selectionItems, summarize, buildResult } from '../src/selection.js';

test('selection.js 는 브라우저에서도 돌도록 import 가 없다', () => {
  const text = fs.readFileSync(new URL('../src/selection.js', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /^\s*import /m);
  assert.doesNotMatch(text, /require\(|node:/);
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
