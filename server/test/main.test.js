import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { tmpDir } from '../../cli/test/helpers.js';
import { start } from '../src/main.js';
import { ADMIN, request } from './helpers.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/guideline-server.js');

function env(t, over = {}) {
  const dir = tmpDir('guideline-main-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, env: { ADMIN_TOKEN: ADMIN, PUBLIC_URL: 'http://guideline.test', DATA_DIR: dir, PORT: '0', GUIDELINE_SEED: 'off', ...over } };
}

function collector() {
  const lines = [];
  return { lines, fn: m => lines.push(m) };
}

test('start 는 DB 를 만들고, 바로 백업 하나를 남기고, health 에 답하고, 닫힌다', async t => {
  const { dir, env: e } = env(t);
  const log = collector();
  const r = await start({ env: e, log: log.fn, error: log.fn });
  assert.equal(r.code, 0);
  t.after(() => r.close());
  assert.match(log.lines.join('\n'), new RegExp(`guideline-server listening on port ${r.port} \\(revision r0, http://guideline\\.test\\)`));
  assert.ok(fs.existsSync(path.join(dir, 'guideline.db')));
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
  const h = await request(`http://127.0.0.1:${r.port}`, '/api/v1/health');
  assert.equal(h.json().revision, 0);
});

test('다시 띄워도 데이터가 남는다', async t => {
  const { env: e } = env(t);
  const quiet = () => {};
  const first = await start({ env: e, log: quiet, error: quiet });
  const base = `http://127.0.0.1:${first.port}`;
  const body = JSON.stringify({ title: '채움', changes: [{ path: 'rules/a/00-x.md', text: 'x', base: null }], apply: true });
  const imported = await request(base, '/api/v1/proposals', { method: 'POST', auth: ADMIN, headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(imported.json().revision, 1);
  await first.close();
  const second = await start({ env: e, log: quiet, error: quiet });
  t.after(() => second.close());
  assert.equal((await request(`http://127.0.0.1:${second.port}`, '/api/v1/health')).json().revision, 1);
});

test('설정이 틀리면 이유를 내고 code 1', async t => {
  const { env: e } = env(t, { ADMIN_TOKEN: '' });
  const log = collector();
  assert.equal((await start({ env: e, log: log.fn, error: log.fn })).code, 1);
  assert.deepEqual(log.lines, ['ADMIN_TOKEN is not set']);
});

test('DATA_DIR 에 쓸 수 없으면 uid 1000 권한을 안내하고 code 1', async t => {
  const { dir, env: e } = env(t);
  const file = path.join(dir, 'not-a-dir');
  fs.writeFileSync(file, '');
  const log = collector();
  assert.equal((await start({ env: { ...e, DATA_DIR: file }, log: log.fn, error: log.fn })).code, 1);
  assert.match(log.lines[0], /^cannot write to .*\. Make DATA_HOST_DIR writable by uid 1000 \(chown 1000:1000\)$/);
});

test('DB 가 더 새 스키마면 이유를 내고 code 1', async t => {
  const { dir, env: e } = env(t);
  const db = new DatabaseSync(path.join(dir, 'guideline.db'));
  db.exec('PRAGMA user_version = 99');
  db.close();
  const log = collector();
  assert.equal((await start({ env: e, log: log.fn, error: log.fn })).code, 1);
  assert.deepEqual(log.lines, ['DB schema v99 is newer than this server (v4). Deploy a newer image']);
});

test('실행 파일은 듣기 시작하고 SIGTERM 에 0 으로 끝난다', async t => {
  const { env: e } = env(t);
  const child = spawn(process.execPath, [bin], { env: { ...process.env, ...e }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', d => {
      out += d;
      const m = /listening on port (\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', code => reject(new Error(`일찍 끝났다: ${code}`)));
  });
  assert.equal((await request(`http://127.0.0.1:${port}`, '/api/v1/health')).status, 200);
  const exited = new Promise(resolve => child.on('exit', resolve));
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
});
