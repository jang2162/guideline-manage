import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write } from './helpers.js';
import { diskTree, memoryTree, overlayTree, pathsTree, asTree, readText, joinPath } from '../src/tree.js';

test('diskTree 는 이름순 목록, 파일 읽기, 존재를 상대 경로로 답한다', t => {
  const root = tmpDir('guideline-tree-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/b/00-x.md', 'x');
  write(root, 'rules/a.md', 'a');
  const tree = diskTree(root);
  assert.deepEqual(tree.list('rules'), [{ name: 'a.md', dir: false }, { name: 'b', dir: true }]);
  assert.deepEqual(tree.list(''), [{ name: 'rules', dir: true }]);
  assert.deepEqual(tree.list('nope'), []);
  assert.deepEqual(tree.list('rules/a.md'), []);
  assert.equal(readText(tree, 'rules/b/00-x.md'), 'x');
  assert.equal(tree.read('rules/b'), null);
  assert.equal(tree.read('nope.md'), null);
  assert.equal(tree.exists('rules/b'), true);
  assert.equal(tree.exists('rules/b/00-x.md'), true);
  assert.equal(tree.exists('rules/c'), false);
});

test('memoryTree 는 파일 경로에서 디렉터리를 만든다', () => {
  const tree = memoryTree({ 'rules/b/00-x.md': 'x', 'rules/a.md': Buffer.from('a'), 'skills/s/SKILL.md': 's' });
  assert.deepEqual(tree.list(''), [{ name: 'rules', dir: true }, { name: 'skills', dir: true }]);
  assert.deepEqual(tree.list('rules'), [{ name: 'a.md', dir: false }, { name: 'b', dir: true }]);
  assert.equal(readText(tree, 'rules/a.md'), 'a');
  assert.equal(tree.read('rules/b'), null);
  assert.equal(tree.exists('rules/b'), true);
  assert.equal(tree.exists('rule'), false);
  assert.deepEqual(tree.list('rule'), []);
  assert.equal(tree.exists(''), true);
});

test('pathsTree 는 목록에 없는 경로를 읽지 않는다', () => {
  const calls = [];
  const tree = pathsTree(['a/b.md'], p => {
    calls.push(p);
    return Buffer.from(p);
  });
  assert.equal(tree.read('a/c.md'), null);
  assert.equal(readText(tree, 'a/b.md'), 'a/b.md');
  assert.deepEqual(calls, ['a/b.md']);
});

test('overlayTree 는 바꾼 파일을 읽고, 지운 파일과 비게 된 디렉터리를 숨기고, 새 파일을 더한다', () => {
  const base = memoryTree({ 'rules/a/00-x.md': 'x', 'rules/b/00-y.md': 'y', 'rules/b/01-z.md': 'z' });
  const tree = overlayTree(base, { 'rules/a/00-x.md': null, 'rules/b/00-y.md': 'Y', 'rules/c/00-n.md': 'n' });
  assert.deepEqual(tree.list('rules'), [{ name: 'b', dir: true }, { name: 'c', dir: true }]);
  assert.deepEqual(tree.list('rules/b'), [{ name: '00-y.md', dir: false }, { name: '01-z.md', dir: false }]);
  assert.equal(readText(tree, 'rules/b/00-y.md'), 'Y');
  assert.equal(readText(tree, 'rules/b/01-z.md'), 'z');
  assert.equal(tree.read('rules/a/00-x.md'), null);
  assert.equal(tree.exists('rules/a'), false);
  assert.equal(tree.exists('rules/c/00-n.md'), true);
  assert.deepEqual(base.list('rules').map(e => e.name), ['a', 'b']);
});

test('asTree 는 문자열을 diskTree 로 감싸고 트리는 그대로 둔다', t => {
  const root = tmpDir('guideline-tree-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'x.md', 'x');
  assert.equal(readText(asTree(root), 'x.md'), 'x');
  const mem = memoryTree({});
  assert.equal(asTree(mem), mem);
});

test('joinPath 는 루트에서는 이름만 낸다', () => {
  assert.equal(joinPath('', 'a'), 'a');
  assert.equal(joinPath('rules', 'a'), 'rules/a');
});
