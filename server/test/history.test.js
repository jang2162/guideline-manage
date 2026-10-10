import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, clock, META } from './helpers.js';
import { sha256 } from '../src/store.js';

const h = s => sha256(Buffer.from(s));
const text = buf => (buf === null ? null : buf.toString('utf8'));

/** r1: a=a1, b=b1 / r2: a=a2, c=c1 / r3: b 삭제 */
function seeded() {
  const store = memoryStore({ now: clock() });
  store.commit({ ...META, message: '처음', source: 'import', changes: { 'rules/x/00-a.md': 'a1', 'rules/x/01-b.md': 'b1' } });
  store.commit({ ...META, message: '둘째', changes: { 'rules/x/00-a.md': 'a2', 'rules/x/02-c.md': 'c1' } });
  store.commit({ ...META, message: '셋째', changes: { 'rules/x/01-b.md': null } });
  return store;
}

test('revision 과 revisions 는 리비전 정보와 바뀐 파일 수를 최신순으로 낸다', () => {
  const store = seeded();
  assert.deepEqual(store.revision(2), {
    id: 2, createdAt: '2026-10-07T00:00:02.000Z', author: 'admin', tokenId: null, message: '둘째', source: 'web',
  });
  assert.equal(store.revision(9), null);
  assert.deepEqual(store.revisions().map(r => [r.id, r.files]), [[3, 1], [2, 2], [1, 2]]);
  assert.deepEqual(store.revisions({ before: 3, limit: 1 }).map(r => r.id), [2]);
});

test('changes 는 더함·바꿈·삭제와 앞뒤 해시를 낸다', () => {
  const store = seeded();
  assert.deepEqual(store.changes(2), [
    { path: 'rules/x/00-a.md', kind: 'modify', before: h('a1'), after: h('a2') },
    { path: 'rules/x/02-c.md', kind: 'add', before: null, after: h('c1') },
  ]);
  assert.deepEqual(store.changes(3), [{ path: 'rules/x/01-b.md', kind: 'delete', before: h('b1'), after: null }]);
});

test('fileHistory 는 그 파일을 바꾼 리비전만 낸다', () => {
  const store = seeded();
  assert.deepEqual(store.fileHistory('rules/x/01-b.md').map(r => [r.id, r.hash]), [[3, null], [1, h('b1')]]);
  assert.deepEqual(store.fileHistory('rules/x/00-a.md', { before: 2 }).map(r => r.id), [1]);
});

test('revertFile 은 그 시점의 내용으로, 그 시점에 없던 파일은 삭제로 새 리비전을 만든다', () => {
  const store = seeded();
  const r4 = store.revertFile('rules/x/00-a.md', 1, { author: 'admin' });
  assert.equal(r4, 4);
  assert.equal(text(store.fileAt('rules/x/00-a.md')), 'a1');
  assert.deepEqual(store.revision(4), { ...store.revision(4), message: '되돌리기: rules/x/00-a.md → r1', source: 'revert' });
  assert.equal(store.revertFile('rules/x/02-c.md', 1, { author: 'admin' }), 5);
  assert.equal(store.fileAt('rules/x/02-c.md'), null);
  assert.equal(store.revertFile('rules/x/02-c.md', 1, { author: 'admin' }), null);
});

test('revertRevision 은 그 리비전이 바꾼 파일을 바로 앞 시점으로 돌리고, 뒤에 또 바뀐 파일을 알려 준다', () => {
  const store = seeded();
  store.commit({ ...META, changes: { 'rules/x/02-c.md': 'c2' } });
  const plan = store.revertPlan(2);
  assert.deepEqual(Object.keys(plan.changes), ['rules/x/00-a.md', 'rules/x/02-c.md']);
  assert.equal(text(plan.changes['rules/x/00-a.md']), 'a1');
  assert.equal(plan.changes['rules/x/02-c.md'], null);
  assert.deepEqual(plan.laterTouched, ['rules/x/02-c.md']);
  assert.equal(store.revertPlan(99), null);
  const r = store.revertRevision(2, { author: 'admin', message: '둘째 취소' });
  assert.equal(r, 5);
  assert.equal(text(store.fileAt('rules/x/00-a.md')), 'a1');
  assert.equal(store.fileAt('rules/x/02-c.md'), null);
  assert.equal(store.revision(5).message, '둘째 취소');
  assert.equal(store.revertRevision(3, { author: 'admin' }), 6);
  assert.equal(text(store.fileAt('rules/x/01-b.md')), 'b1');
  assert.equal(store.revision(6).message, '되돌리기: r3');
});
