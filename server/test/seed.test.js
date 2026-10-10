import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../../cli/test/helpers.js';
import { start } from '../src/main.js';
import { openDb, MIGRATIONS, SCHEMA_VERSION } from '../src/db.js';
import { createStore } from '../src/store.js';
import { currentLocale, setLocale } from '../../cli/src/i18n.js';
import { ADMIN, request } from './helpers.js';

const HANGUL = /[가-힣]/;

async function boot(t, over = {}, dir = null) {
  const dataDir = dir ?? tmpDir('guideline-seed-');
  if (!dir) t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const prev = currentLocale();
  t.after(() => setLocale(prev));
  const r = await start({ env: { ADMIN_TOKEN: ADMIN, PUBLIC_URL: 'http://guideline.test', DATA_DIR: dataDir, PORT: '0', ...over }, log: () => {}, error: () => {} });
  assert.equal(r.code, 0);
  let closed = false;
  const close = async () => {
    if (!closed) await r.close();
    closed = true;
  };
  t.after(close);
  const base = `http://127.0.0.1:${r.port}`;
  return { r: { ...r, close }, dataDir, get: p => request(base, p, { auth: ADMIN }) };
}

test('빈 서버를 띄우면 서버 언어의 씨앗이 리비전 1 로 들어간다', async t => {
  const s = await boot(t, { GUIDELINE_LANG: 'en' });
  const rev = (await s.get('/api/v1/revisions')).json();
  const list = rev.revisions ?? rev;
  assert.equal(list.length, 1);
  assert.equal(list[0].author, 'system');
  assert.equal(list[0].source, 'seed');
  for (const p of ['docs/authoring.md', 'skills/guideline-sync/SKILL.md', 'skills/guideline-export/SKILL.md']) {
    const f = await s.get(`/api/v1/files/${p}`);
    assert.equal(f.status, 200, p);
    assert.ok(!HANGUL.test(f.text), p);
  }
});

test('한국어 서버의 씨앗은 한국어이고, 리비전이 있으면 다시 넣지 않는다', async t => {
  const dataDir = tmpDir('guideline-seed-');
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = await boot(t, { GUIDELINE_LANG: 'ko' }, dataDir);
  assert.match((await first.get('/api/v1/files/docs/authoring.md')).text, /이 저장소에 지침을 쓰는 규칙/);
  await first.r.close();
  const second = await boot(t, { GUIDELINE_LANG: 'en' }, dataDir);
  const rev = (await second.get('/api/v1/revisions')).json();
  assert.equal((rev.revisions ?? rev).length, 1);
});

test('GUIDELINE_SEED=off 면 넣지 않는다', async t => {
  const s = await boot(t, { GUIDELINE_SEED: 'off' });
  const rev = (await s.get('/api/v1/revisions')).json();
  assert.equal((rev.revisions ?? rev).length, 0);
});

test('v3 DB 를 열면 v4 로 올라가고 기존 리비전이 그대로이며 seed 출처를 쓸 수 있다', t => {
  const dir = tmpDir('guideline-db-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'g.db');
  const old = openDb(file, { migrations: MIGRATIONS.slice(0, 3) });
  createStore(old).commit({ author: 'admin', message: 'm', source: 'web', changes: { 'rules/base/00-a.md': '---\nload: always\n---\n# a\n' } });
  old.close();
  const db = openDb(file);
  t.after(() => db.close());
  assert.equal(SCHEMA_VERSION, 4);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  const store = createStore(db);
  assert.equal(store.headRevision(), 1);
  assert.equal(store.commit({ author: 'system', message: 'seed', source: 'seed', changes: { 'docs/authoring.md': '# x\n' } }), 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});
