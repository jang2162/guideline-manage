import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockKey, stepOf, requiredClosure, missingRequires, releasable } from '../src/selection.js';
import { unitOf } from '../src/sources.js';

test('blockKey 는 sources.js 의 unitOf 와 같은 블록 키를 낸다', () => {
  for (const id of ['rules/base/00-a.md', 'rules/base/SETUP.md', 'rules/base', 'skills/s', 'skills/s/x.md', 'agents/w.md', 'agents/x/y.md', 'mcp/m', 'mcp/m/server.json', 'docs/x.md', 'rules']) {
    assert.equal(blockKey(id), unitOf(id), id);
  }
});

test('stepOf 는 항목 종류로 단계를 정하고, 원본에서 사라진 항목은 블록 키 앞 조각으로', () => {
  assert.equal(stepOf({ kind: 'rule', id: 'rules/b/00-a.md' }), 'rules');
  assert.equal(stepOf({ kind: 'setup', id: 'rules/b/SETUP.md' }), 'rules');
  assert.equal(stepOf({ kind: 'mcp', id: 'mcp/m' }), 'mcp');
  assert.equal(stepOf({ kind: 'subagent', id: 'agents/w.md' }), 'agents');
  assert.equal(stepOf({ kind: 'skill', id: 'skills/s' }), 'skills');
  assert.equal(stepOf({ kind: 'orphan', id: 'mcp/x' }), 'mcp');
  assert.equal(stepOf({ kind: 'orphan', id: 'skills/x/SKILL.md' }), 'skills');
  assert.equal(stepOf({ kind: 'orphan', id: 'agents/x.md' }), 'agents');
  assert.equal(stepOf({ kind: 'orphan', id: 'docs/x' }), 'rules');
});

test('requiredClosure 는 의존의 의존까지 따라가고 자신·중복·순환을 뺀다', () => {
  assert.deepEqual(requiredClosure(['mcp/p'], { 'mcp/p': ['rules/b'], 'rules/b': ['rules/c'] }), ['rules/b', 'rules/c']);
  assert.deepEqual(requiredClosure(['a'], { a: ['b'], b: ['a'] }), ['b']);
  assert.deepEqual(requiredClosure(['a'], { a: ['a'] }), []);
  assert.deepEqual(requiredClosure(['a', 'b'], { a: ['c'], b: ['c', 'a'] }), ['c']);
  assert.deepEqual(requiredClosure(['x'], {}), []);
});

test('missingRequires 는 골라진 블록이 필요로 하는데 골라지지 않은 것을 낸다', () => {
  assert.deepEqual(missingRequires(new Set(['mcp/p']), { 'mcp/p': ['rules/b'] }), [{ unit: 'mcp/p', needs: 'rules/b' }]);
  assert.deepEqual(missingRequires(new Set(['mcp/p', 'rules/b']), { 'mcp/p': ['rules/b'] }), []);
  assert.deepEqual(missingRequires(new Set(['rules/b']), { 'mcp/p': ['rules/b'] }), []);
});

test('releasable 은 자동으로 켰고, 사람이 건드리지 않았고, 남은 블록이 필요로 하지 않는 것만 낸다', () => {
  const requires = { 'mcp/p': ['rules/b'], 'rules/b': ['rules/c'] };
  const base = { chosen: new Set(['mcp/p', 'rules/b', 'rules/c']), auto: new Set(['rules/b', 'rules/c']), touched: new Set(), requires };
  assert.deepEqual(releasable('mcp/p', base).sort(), ['rules/b', 'rules/c']);
  assert.deepEqual(releasable('mcp/p', { ...base, chosen: new Set([...base.chosen, 'skills/s']), requires: { ...requires, 'skills/s': ['rules/b'] } }), []);
  assert.deepEqual(releasable('mcp/p', { ...base, touched: new Set(['rules/b']) }), []);
  assert.deepEqual(releasable('mcp/p', { ...base, auto: new Set(['rules/c']) }), []);
});
