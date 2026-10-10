import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../../cli/test/helpers.js';
import { openDb, SCHEMA_VERSION, SchemaTooNewError } from '../src/db.js';

function dbFile(t) {
  const dir = tmpDir('guideline-db-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'g.db');
}

test('openDb 는 새 DB 에 스키마를 만들고 user_version 을 올린다', t => {
  const db = openDb(dbFile(t));
  t.after(() => db.close());
  assert.equal(SCHEMA_VERSION, 4);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
  assert.deepEqual(tables, ['file_versions', 'forms', 'head', 'proposal_changes', 'proposals', 'revisions', 'tokens']);
});

test('openDb 는 스키마를 올리기 직전에 beforeMigrate 를 부른다. 새 DB 에서는 부르지 않는다', t => {
  const file = dbFile(t);
  const calls = [];
  openDb(file, { migrations: ['CREATE TABLE a (x)'], beforeMigrate: (_, from, to) => calls.push([from, to]) }).close();
  assert.deepEqual(calls, []);
  const db = openDb(file, { migrations: ['CREATE TABLE a (x)', 'CREATE TABLE b (y)'], beforeMigrate: (_, from, to) => calls.push([from, to]) });
  t.after(() => db.close());
  assert.deepEqual(calls, [[1, 2]]);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
});

test('올리기가 실패하면 아무것도 남지 않는다', t => {
  const file = dbFile(t);
  assert.throws(() => openDb(file, { migrations: ['CREATE TABLE a (x)', 'CREATE TABLE a (x)'] }));
  const db = openDb(file, { migrations: [] });
  t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'a'").get().n, 0);
});

test('DB 가 코드보다 새 스키마면 SchemaTooNewError', t => {
  const file = dbFile(t);
  openDb(file, { migrations: ['CREATE TABLE a (x)', 'CREATE TABLE b (y)'] }).close();
  assert.throws(() => openDb(file, { migrations: ['CREATE TABLE a (x)'] }), e => (
    e instanceof SchemaTooNewError && e.message === 'DB schema v2 is newer than this server (v1). Deploy a newer image'
  ));
});
