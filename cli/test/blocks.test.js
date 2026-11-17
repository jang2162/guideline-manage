import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockKey, isBlockKey, parentKey, ancestorKeys, withAncestors, isWithin } from '../src/blocks.js';
import { unitOf, aliasUnitOf } from '../src/sources.js';

test('blockKey 는 하위 스택 파일을 그 스택으로 묶는다', () => {
  assert.equal(blockKey('rules/browser/browseros-neo/00-switch.md'), 'rules/browser/browseros-neo');
  assert.equal(blockKey('rules/browser/SETUP.md'), 'rules/browser');
  assert.equal(blockKey('rules/browser/browseros-neo'), 'rules/browser/browseros-neo');
  assert.equal(blockKey('skills/x/refs/a.md'), 'skills/x');
  assert.equal(blockKey('agents/rev.md'), 'agents/rev.md');
  assert.equal(blockKey('docs/a.md'), null);
});

test('blockKey 는 기존 깊이 1 id 에서 예전 단위와 같다', () => {
  for (const id of ['rules/base/00-a.md', 'rules/base/SETUP.md', 'rules/base', 'skills/s', 'skills/s/x.md', 'agents/w.md', 'agents/x/y.md', 'mcp/m', 'mcp/m/server.json', 'docs/x.md', 'rules', 'rules/']) {
    assert.equal(blockKey(id), unitOf(id), id);
  }
});

test('blockKey 는 스택이 아닌 rules 직속 파일·빈 조각을 null 로 둔다', () => {
  assert.equal(blockKey('rules/x.md'), null);
  assert.equal(blockKey('rules'), null);
  assert.equal(blockKey('rules/a//b.md'), null);
  assert.equal(blockKey('skills/'), null);
});

test('isBlockKey 는 blockKey 가 자기 자신인 문자열이다', () => {
  assert.equal(isBlockKey('rules/a/b'), true);
  assert.equal(isBlockKey('rules/a/b/00-x.md'), false);
  assert.equal(isBlockKey('agents/rev.md'), true);
  assert.equal(isBlockKey('docs/a'), false);
});

test('ancestorKeys·withAncestors 는 조상을 가까운 것부터 채운다', () => {
  assert.deepEqual(ancestorKeys('rules/a/b/c'), ['rules/a/b', 'rules/a']);
  assert.deepEqual(ancestorKeys('rules/a'), []);
  assert.deepEqual(ancestorKeys('skills/x'), []);
  assert.deepEqual(withAncestors(['rules/a/b', 'mcp/x']), ['mcp/x', 'rules/a', 'rules/a/b']);
  assert.deepEqual(withAncestors(['rules/a/b', 'rules/a']), ['rules/a', 'rules/a/b']);
  assert.equal(parentKey('rules/a'), null);
  assert.equal(parentKey('rules/a/b'), 'rules/a');
  assert.equal(parentKey('skills/x'), null);
  assert.equal(isWithin('rules/a/b', 'rules/a'), true);
  assert.equal(isWithin('rules/a', 'rules/a'), true);
  assert.equal(isWithin('rules/a', 'rules/a/b'), false);
  assert.equal(isWithin('rules/ab', 'rules/a'), false);
});

test('aliasUnitOf 는 하위 스택도 최상위 스택 단위로 본다', () => {
  assert.equal(aliasUnitOf('rules/browser/browseros-neo/00-x.md'), 'rules/browser');
  assert.equal(aliasUnitOf('rules/browser/SETUP.md'), 'rules/browser');
  assert.equal(aliasUnitOf('skills/x/refs/a.md'), 'skills/x');
  assert.equal(aliasUnitOf('agents/rev.md'), 'agents/rev.md');
  assert.equal(aliasUnitOf('docs/a.md'), null);
});
