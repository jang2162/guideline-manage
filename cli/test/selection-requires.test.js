import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockKey, stepOf, requiredClosure, missingRequires, releasable, pullRequired } from '../src/selection.js';
import { unitOf } from '../src/sources.js';
import * as blocks from '../src/blocks.js';

test('selection.js 의 blockKey 는 blocks.js 의 것이고 sources.js 의 unitOf 와 같은 블록 키를 낸다', () => {
  assert.equal(blockKey, blocks.blockKey);
  assert.equal(unitOf, blocks.blockKey);
  // 예전 sources.js unitOf 가 낸 값을 박은 표 — 한 구현에 기대지 않는다.
  const EXPECTED = {
    'rules/base/00-a.md': 'rules/base',
    'rules/base/SETUP.md': 'rules/base',
    'rules/base/logo.png': 'rules/base',
    'rules/base': 'rules/base',
    'skills/s': 'skills/s',
    'skills/s/x.md': 'skills/s',
    'agents/w.md': 'agents/w.md',
    'agents/x/y.md': null,
    'mcp/m': 'mcp/m',
    'mcp/m/server.json': 'mcp/m',
    'docs/x.md': null,
    rules: null,
    'rules/': null,
    'rules/deploy__gitlab.example.com': 'rules/deploy__gitlab.example.com',
    'rules/deploy__gitlab.example.com/00-a.md': 'rules/deploy__gitlab.example.com',
  };
  for (const [id, key] of Object.entries(EXPECTED)) assert.equal(blockKey(id), key, id);
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

test('stepOf: 새 배치의 고아(.guideline/<조각>/…)는 그 다음 조각으로 단계를 정한다', () => {
  assert.equal(stepOf({ kind: 'orphan', id: '.guideline/skills/old' }), 'skills');
  assert.equal(stepOf({ kind: 'orphan', id: '.guideline/mcp/old' }), 'mcp');
  assert.equal(stepOf({ kind: 'orphan', id: '.guideline/agents/old.md' }), 'agents');
  assert.equal(stepOf({ kind: 'orphan', id: '.guideline/rules/base/07-gone.md' }), 'rules');
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

/** 켤 수 있는 블록(open)만 켜지고, 켠 것을 기록하는 시험용 상태. */
function pullState(chosen, open) {
  const on = new Set(chosen);
  return {
    on,
    opts: { isChosen: u => on.has(u), turnOn: u => (open.has(u) ? (on.add(u), true) : false) },
  };
}

test('pullRequired 는 실제로 켜진 블록에서만 넓힌다 — 켤 수 없는 블록을 거쳐서는 켜지 않는다', () => {
  const requires = { 'mcp/p': ['rules/blk'], 'rules/blk': ['rules/zz'] };
  const s = pullState(['mcp/p'], new Set(['rules/zz']));
  assert.deepEqual(pullRequired(['mcp/p'], requires, s.opts), []);
  assert.equal(s.on.has('rules/zz'), false);
});

test('pullRequired 는 골라지지 않은 시작 블록(반영 불가 추천)에서 출발하지 않는다', () => {
  const s = pullState([], new Set(['rules/zz']));
  assert.deepEqual(pullRequired(['rules/blk'], { 'rules/blk': ['rules/zz'] }, s.opts), []);
});

test('pullRequired 는 켠 블록과 그 블록을 직접 필요로 한 블록을 내고, 이미 골라진 블록은 거쳐 간다', () => {
  const requires = { 'mcp/p': ['rules/b'], 'rules/b': ['rules/c'], 'skills/s': ['rules/a'], 'rules/a': ['rules/d'] };
  const s = pullState(['mcp/p', 'skills/s', 'rules/a'], new Set(['rules/b', 'rules/c', 'rules/d']));
  assert.deepEqual(pullRequired(['mcp/p', 'skills/s'], requires, s.opts), [
    { by: 'mcp/p', needs: 'rules/b' },
    { by: 'rules/b', needs: 'rules/c' },
    { by: 'rules/a', needs: 'rules/d' },
  ]);
});

test('pullRequired 는 순환·자기 참조에서 끝나고 같은 블록을 두 번 켜지 않는다', () => {
  const s = pullState(['a'], new Set(['b']));
  assert.deepEqual(pullRequired(['a'], { a: ['a', 'b'], b: ['a', 'b'] }, s.opts), [{ by: 'a', needs: 'b' }]);
});
