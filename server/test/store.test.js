import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, clock, META } from './helpers.js';
import { ConflictError, WriteError, sha256 } from '../src/store.js';

const text = buf => (buf === null ? null : buf.toString('utf8'));

test('commit 은 리비전을 만들고 파일을 시점별로 읽는다', () => {
  const store = memoryStore({ now: clock() });
  assert.equal(store.headRevision(), 0);
  const r1 = store.commit({ ...META, changes: { 'rules/b/00-x.md': 'x1', 'rules/a/00-y.md': Buffer.from('y') } });
  assert.equal(r1, 1);
  const r2 = store.commit({ ...META, changes: { 'rules/b/00-x.md': 'x2' } });
  assert.equal(r2, 2);
  assert.equal(store.headRevision(), 2);
  assert.equal(text(store.fileAt('rules/b/00-x.md')), 'x2');
  assert.equal(text(store.fileAt('rules/b/00-x.md', 1)), 'x1');
  assert.equal(store.fileAt('nope.md'), null);
  assert.deepEqual(store.pathsAt(), [
    { path: 'rules/a/00-y.md', hash: sha256(Buffer.from('y')), size: 1 },
    { path: 'rules/b/00-x.md', hash: sha256(Buffer.from('x2')), size: 2 },
  ]);
  assert.equal(store.hashAt('rules/b/00-x.md', 1), sha256(Buffer.from('x1')));
});

test('같은 내용과 없는 파일의 삭제는 빠지고, 남는 변경이 없으면 리비전을 만들지 않는다', () => {
  const store = memoryStore();
  store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x' } });
  assert.equal(store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x', 'rules/a/01-gone.md': null } }), null);
  assert.equal(store.headRevision(), 1);
  const r = store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x', 'rules/a/02-new.md': 'n' } });
  assert.equal(r, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM file_versions WHERE revision_id = 2').get().n, 1);
});

test('삭제한 파일은 지금은 없고 지난 리비전에서는 읽힌다', () => {
  const store = memoryStore();
  store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x', 'rules/a/01-y.md': 'y' } });
  store.commit({ ...META, changes: { 'rules/a/00-x.md': null } });
  assert.equal(store.fileAt('rules/a/00-x.md'), null);
  assert.equal(store.hashAt('rules/a/00-x.md'), null);
  assert.equal(text(store.fileAt('rules/a/00-x.md', 1)), 'x');
  assert.deepEqual(store.pathsAt(1).map(f => f.path), ['rules/a/00-x.md', 'rules/a/01-y.md']);
  assert.deepEqual(store.pathsAt(2).map(f => f.path), ['rules/a/01-y.md']);
});

test('base 의 해시가 지금과 다르면 아무것도 쓰지 않고 ConflictError', () => {
  const store = memoryStore();
  store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x' } });
  const old = sha256(Buffer.from('x'));
  store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x2' } });
  assert.throws(
    () => store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x3', 'rules/a/01-y.md': 'y' }, base: { 'rules/a/00-x.md': old } }),
    e => e instanceof ConflictError && e.paths.length === 1 && e.paths[0] === 'rules/a/00-x.md',
  );
  assert.throws(() => store.commit({ ...META, changes: { 'rules/a/00-x.md': 'z' }, base: { 'rules/a/00-x.md': null } }), ConflictError);
  assert.equal(store.headRevision(), 2);
  assert.equal(store.fileAt('rules/a/01-y.md'), null);
  const r = store.commit({ ...META, changes: { 'rules/a/00-x.md': 'x3' }, base: { 'rules/a/00-x.md': sha256(Buffer.from('x2')) } });
  assert.equal(r, 3);
});

test('경로·내용 규칙을 어기거나 메시지가 비면 WriteError', () => {
  const store = memoryStore();
  store.commit({ ...META, changes: { 'skills/a/SKILL.md': 's' } });
  assert.throws(() => store.commit({ ...META, changes: { 'docs/x.txt': 'x' } }), e => (
    e instanceof WriteError && e.problems[0].message === '최상위는 rules/, skills/, agents/, mcp/ 또는 docs/<이름>.md 여야 함'
  ));
  assert.throws(() => store.commit({ ...META, changes: { 'skills/a': 'x' } }), WriteError);
  assert.throws(() => store.commit({ ...META, message: '  ', changes: { 'rules/a/00-x.md': 'x' } }), e => (
    e instanceof WriteError && e.problems[0].message === '메시지가 비어 있음'
  ));
  assert.equal(store.headRevision(), 1);
});

test('쓰기 중간에 실패하면 리비전도 파일도 남지 않는다', () => {
  const store = memoryStore();
  store.db.exec("CREATE TRIGGER boom BEFORE INSERT ON head WHEN NEW.path = 'rules/a/01-boom.md' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  assert.throws(() => store.commit({ ...META, changes: { 'rules/a/00-ok.md': 'ok', 'rules/a/01-boom.md': 'b' } }), /boom/);
  assert.equal(store.headRevision(), 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM file_versions').get().n, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM head').get().n, 0);
});

test('경로는 NFC 로 맞춰 저장하고, 맞춘 뒤 겹치면 WriteError', () => {
  const store = memoryStore();
  const nfd = 'rules/한/00-a.md'.normalize('NFD');
  assert.notEqual(nfd, 'rules/한/00-a.md');
  store.commit({ ...META, changes: { [nfd]: 'a' } });
  assert.equal(text(store.fileAt('rules/한/00-a.md')), 'a');
  assert.deepEqual(store.pathsAt().map(f => f.path), ['rules/한/00-a.md']);
  assert.throws(() => store.commit({ ...META, changes: { [nfd]: 'b', 'rules/한/00-a.md': 'c' } }), e => (
    e instanceof WriteError && e.problems[0].message === '같은 경로가 두 번 있음'
  ));
});
