import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultChoice, canUpdate, canOverwrite, buildSelection, itemKey } from '../src/selection.js';

const item = (state, lockState, extra = {}) => ({ kind: 'rule', id: `rules/base/${state}-${lockState}.md`, stack: 'base', state, ...(lockState ? { lockState } : {}), ...extra });

test('잠금 상태의 처음 체크', () => {
  assert.deepEqual(defaultChoice(item('same', 'current')), { checked: true, update: false });
  assert.deepEqual(defaultChoice(item('different', 'upstream')), { checked: true, update: true });
  assert.deepEqual(defaultChoice(item('different', 'gone')), { checked: true, update: true });
  assert.deepEqual(defaultChoice(item('different', 'local')), { checked: true, update: false, overwrite: false });
  assert.deepEqual(defaultChoice(item('present', 'removed')), { checked: true, update: false });
  assert.deepEqual(defaultChoice(item('different')), { checked: true, update: false });
});

test('갱신·덮어쓰기 토글을 둘 수 있는 상태', () => {
  assert.equal(canUpdate(item('different', 'local')), false);
  assert.equal(canUpdate(item('different')), true);
  assert.equal(canOverwrite(item('different', 'both')), true);
  assert.equal(canOverwrite(item('different', 'upstream')), false);
});

test('buildSelection 은 덮어쓰기를 그럴 수 있는 항목에만 싣고 blocked 를 따로 낸다', () => {
  const items = [
    item('different', 'local'),
    item('different', 'upstream'),
    item('same', 'current'),
    { kind: 'rule', id: 'rules/bad/00-x.md', stack: 'bad', state: 'blocked', reason: '칸 경고' },
  ];
  const choices = {
    [itemKey(items[0])]: { checked: true, update: false, overwrite: true },
    [itemKey(items[1])]: { checked: true, update: true, overwrite: true },
    [itemKey(items[2])]: { checked: false, update: false },
  };
  const sel = buildSelection({ revision: 7, items, choices, project: null });
  assert.equal(sel.version, 1);
  assert.equal(sel.revision, 7);
  assert.equal(sel.project, null);
  assert.deepEqual(sel.items, [
    { kind: 'rule', id: items[0].id, action: 'keep', overwrite: true, state: 'different', lockState: 'local' },
    { kind: 'rule', id: items[1].id, action: 'update', state: 'different', lockState: 'upstream' },
    { kind: 'rule', id: items[2].id, action: 'remove', state: 'same', lockState: 'current' },
  ]);
  assert.deepEqual(sel.blocked, [{ kind: 'rule', id: 'rules/bad/00-x.md', stack: 'bad', reason: '칸 경고' }]);
});
