import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRichDocsRepo, filesOf } from '../../cli/test/helpers.js';
import { catalogSummary } from '../../cli/src/summary.js';
import { readText } from '../../cli/src/tree.js';
import { memoryStore, META } from './helpers.js';
import { dbTree } from '../src/db-tree.js';

test('가져온 저장소를 dbTree 로 읽은 목록은 디스크에서 읽은 list --json 과 같다', t => {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = memoryStore();
  store.commit({ ...META, source: 'import', changes: filesOf(root) });
  const fromDb = catalogSummary(dbTree(store));
  assert.deepEqual(fromDb, catalogSummary(root));
  assert.ok(fromDb.stacks.length >= 3);
});

test('dbTree 는 지난 리비전을 읽는다', () => {
  const store = memoryStore();
  store.commit({ ...META, changes: { 'rules/a/00-x.md': '---\nload: always\n---\n\n# x\n', 'rules/b/00-y.md': 'y' } });
  store.commit({ ...META, changes: { 'rules/a/00-x.md': null } });
  assert.deepEqual(dbTree(store, 1).list('rules').map(e => e.name), ['a', 'b']);
  assert.deepEqual(dbTree(store).list('rules').map(e => e.name), ['b']);
  assert.equal(readText(dbTree(store, 1), 'rules/a/00-x.md'), '---\nload: always\n---\n\n# x\n');
  assert.equal(dbTree(store).read('rules/a/00-x.md'), null);
});
