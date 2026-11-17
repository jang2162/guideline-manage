import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockKey, isBlockKey, parentKey, ancestorKeys, withAncestors, isWithin } from '../src/blocks.js';
import { aliasUnitOf } from '../src/sources.js';

test('blockKey 는 하위 스택 파일을 그 스택으로 묶는다', () => {
  assert.equal(blockKey('rules/browser/browseros-neo/00-switch.md'), 'rules/browser/browseros-neo');
  assert.equal(blockKey('rules/browser/SETUP.md'), 'rules/browser');
  assert.equal(blockKey('rules/browser/browseros-neo'), 'rules/browser/browseros-neo');
  assert.equal(blockKey('skills/x/refs/a.md'), 'skills/x');
  assert.equal(blockKey('agents/rev.md'), 'agents/rev.md');
  assert.equal(blockKey('docs/a.md'), null);
});

test('blockKey 는 깊이 1 id 에서 예전 unitOf 가 낸 값을 그대로 낸다(리터럴 표)', () => {
  const OLD_UNIT_OF = {
    'rules/base/00-a.md': 'rules/base',
    'rules/base/SETUP.md': 'rules/base',
    'rules/base/logo.png': 'rules/base',
    'rules/base': 'rules/base',
    'rules/next.js': 'rules/next.js',
    'rules/next.js/00-a.md': 'rules/next.js',
    'rules/next.js/logo.png': 'rules/next.js',
    'rules/README.md': 'rules/README.md',
    'skills/s': 'skills/s',
    'skills/s/x.md': 'skills/s',
    'agents/w.md': 'agents/w.md',
    'agents/x/y.md': null,
    'mcp/m': 'mcp/m',
    'mcp/m/server.json': 'mcp/m',
    'docs/x.md': null,
    rules: null,
    'rules/': null,
  };
  for (const [id, key] of Object.entries(OLD_UNIT_OF)) assert.equal(blockKey(id), key, id);
});

test('blockKey 는 rules/ 아래 둘째 조각부터 마지막 조각에 점이 있고 __ 가 없으면 파일로, __ 가 있으면 도메인 스택 폴더로 본다', () => {
  assert.equal(blockKey('rules/base/logo.png'), 'rules/base');
  assert.equal(blockKey('rules/a/b/logo.png'), 'rules/a/b');
  assert.equal(blockKey('rules/a/v1.2'), 'rules/a');
  assert.equal(blockKey('rules/next.js'), 'rules/next.js');
  assert.equal(blockKey('rules/deploy__gitlab.example.com'), 'rules/deploy__gitlab.example.com');
  assert.equal(blockKey('rules/deploy__gitlab.example.com/00-a.md'), 'rules/deploy__gitlab.example.com');
  assert.equal(blockKey('rules/a/deploy__gitlab.example.com'), 'rules/a/deploy__gitlab.example.com');
  assert.equal(blockKey('rules/a/deploy__gitlab.example.com/logo.png'), 'rules/a/deploy__gitlab.example.com');
});

test('blockKey 는 끝 조각이 비면 null 이다', () => {
  assert.equal(blockKey('rules/base/'), null);
  assert.equal(blockKey('rules/a/b/'), null);
});

test('blockKey 는 빈 조각을 null 로 둔다', () => {
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
  assert.equal(aliasUnitOf('rules/browser/browseros-neo/logo.png'), 'rules/browser');
  assert.equal(aliasUnitOf('rules/deploy__gitlab.example.com/00-a.md'), 'rules/deploy__gitlab.example.com');
});
