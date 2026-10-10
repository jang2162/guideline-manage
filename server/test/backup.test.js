import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../../cli/test/helpers.js';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { stamp, backupNow, pruneBackups, migrationBackup, scheduleBackups } from '../src/backup.js';
import { META } from './helpers.js';

function setup(t) {
  const dir = tmpDir('guideline-backup-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDb(path.join(dir, 'guideline.db'));
  t.after(() => db.close());
  createStore(db).commit({ ...META, changes: { 'rules/a/00-x.md': 'x' } });
  return { dir, db, backups: path.join(dir, 'backups') };
}

test('stamp 는 UTC 의 YYYYMMDD-HHmmss', () => {
  assert.equal(stamp(new Date('2026-10-07T03:04:05.678Z')), '20261007-030405');
});

test('backupNow 는 같은 내용을 읽을 수 있는 사본을 만들고, 같은 이름이면 다시 만들지 않는다', t => {
  const { db, backups } = setup(t);
  const now = new Date('2026-10-07T03:04:05Z');
  const file = backupNow(db, backups, now);
  assert.equal(path.basename(file), 'guideline-20261007-030405.db');
  assert.equal(backupNow(db, backups, now), file);
  const copy = openDb(file);
  t.after(() => copy.close());
  assert.equal(createStore(copy).fileAt('rules/a/00-x.md').toString(), 'x');
});

test('pruneBackups 는 자동 백업만 오래된 것부터 지우고 마이그레이션 전 백업은 남긴다', t => {
  const { db, backups } = setup(t);
  for (let d = 1; d <= 4; d++) backupNow(db, backups, new Date(`2026-10-0${d}T00:00:00Z`));
  migrationBackup(db, backups, 2, new Date('2026-09-01T00:00:00Z'));
  assert.deepEqual(pruneBackups(backups, 2), ['guideline-20261001-000000.db', 'guideline-20261002-000000.db']);
  assert.deepEqual(fs.readdirSync(backups).sort(), [
    'guideline-20261003-000000.db', 'guideline-20261004-000000.db', 'guideline-pre-v2-20260901-000000.db',
  ]);
});

test('scheduleBackups 는 바로 한 번 백업하고, 실패는 로그로만 남긴다', t => {
  const { dir, db, backups } = setup(t);
  const stop = scheduleBackups(db, backups, 3, { now: () => new Date('2026-10-07T00:00:00Z') });
  stop();
  assert.deepEqual(fs.readdirSync(backups), ['guideline-20261007-000000.db']);
  const blocked = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocked, '');
  const logs = [];
  scheduleBackups(db, blocked, 3, { log: m => logs.push(m) })();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^backup failed: /);
});
