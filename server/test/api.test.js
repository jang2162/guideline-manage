import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRichDocsRepo, filesOf } from '../../cli/test/helpers.js';
import { catalogSummary } from '../../cli/src/summary.js';
import { startApp, testConfig, ADMIN, META } from './helpers.js';
import { sha256 } from '../src/store.js';

test('health 는 인증 없이 버전·스키마·리비전을 내고, 보안 헤더가 붙고, 요청이 로그에 한 줄 남는다', async t => {
  const s = await startApp(t);
  const r = await s.req('/api/v1/health');
  assert.equal(r.status, 200);
  const body = r.json();
  assert.equal(body.ok, true);
  assert.equal(body.schema, 4);
  assert.equal(body.api, 2);
  assert.equal(body.revision, 0);
  assert.match(body.version, /^\d+\.\d+\.\d+/);
  assert.equal(r.headers['content-security-policy'], "default-src 'self'; frame-ancestors 'none'");
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'same-origin');
  await s.req('/api/v1/catalog', { auth: ADMIN });
  assert.match(s.lines.join('\n'), /^GET \/api\/v1\/health 200 \d+ms$/m);
  assert.doesNotMatch(s.lines.join('\n'), new RegExp(ADMIN));
});

test('비공개(PUBLIC_READ=0)면 토큰 없이는 401, 관리자·발급 토큰은 통과, 폐기한 토큰은 401', async t => {
  const s = await startApp(t, { config: testConfig({ publicRead: false }) });
  const none = await s.req('/api/v1/catalog');
  assert.equal(none.status, 401);
  assert.equal(none.headers['www-authenticate'], 'Bearer');
  assert.deepEqual(none.json(), { error: '토큰 필요' });
  assert.equal((await s.req('/api/v1/catalog', { auth: ADMIN })).status, 200);
  const { id, token } = s.tokens.issue({ name: 'a', scope: 'read' });
  assert.equal((await s.req('/api/v1/catalog', { auth: token })).status, 200);
  s.tokens.revoke(id);
  assert.equal((await s.req('/api/v1/catalog', { auth: token })).status, 401);
});

test('공개(PUBLIC_READ=1)면 읽기 API 는 토큰 없이 되지만, 틀린·폐기한 토큰은 401', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/a/00-x.md': 'a\n' } });
  assert.equal((await s.req('/api/v1/health')).json().publicRead, true);
  for (const p of ['/api/v1/catalog', '/api/v1/tree', '/api/v1/files/rules/a/00-x.md', '/api/v1/revisions', '/api/v1/revisions/1', '/api/v1/archive']) {
    assert.equal((await s.req(p)).status, 200, p);
  }
  assert.equal((await s.req('/api/v1/catalog', { auth: 'glt_wrong' })).status, 401);
  const { id, token } = s.tokens.issue({ name: 'a', scope: 'read' });
  s.tokens.revoke(id);
  assert.equal((await s.req('/api/v1/catalog', { auth: token })).status, 401);
  assert.equal((await s.req('/api/v1/proposals')).status, 401, '제안은 공개와 상관없이 토큰');
});

test('catalog 는 리비전 번호를 더한 list --json 을 낸다. 없는 리비전은 404', async t => {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: filesOf(root) });
  const r = await s.req('/api/v1/catalog', { auth: ADMIN });
  assert.deepEqual(r.json(), { revision: 1, ...catalogSummary(root) });
  for (const rev of ['0', '2', 'abc']) assert.equal((await s.req(`/api/v1/catalog?rev=${rev}`, { auth: ADMIN })).status, 404, rev);
});

test('tree 와 files 는 리비전·접두사·인코딩된 한글 경로를 다룬다', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/한글/00-a.md': 'a1', 'skills/s/SKILL.md': 's' } });
  s.store.commit({ ...META, changes: { 'rules/한글/00-a.md': 'a2' } });
  const tree = (await s.req('/api/v1/tree?prefix=rules/', { auth: ADMIN })).json();
  assert.deepEqual(tree, { revision: 2, files: [{ path: 'rules/한글/00-a.md', hash: sha256(Buffer.from('a2')), size: 2 }] });
  const enc = encodeURIComponent('한글');
  const f = await s.req(`/api/v1/files/rules/${enc}/00-a.md?rev=1`, { auth: ADMIN });
  assert.equal(f.status, 200);
  assert.equal(f.text, 'a1');
  assert.equal(f.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.equal(f.headers['x-guideline-revision'], '1');
  assert.equal(f.headers.etag, `"${sha256(Buffer.from('a1'))}"`);
  const nfd = encodeURIComponent('한글'.normalize('NFD'));
  assert.equal((await s.req(`/api/v1/files/rules/${nfd}/00-a.md`, { auth: ADMIN })).text, 'a2');
  assert.equal((await s.req('/api/v1/files/rules/none.md', { auth: ADMIN })).status, 404);
  assert.equal((await s.req('/api/v1/files/skills/s', { auth: ADMIN })).status, 404);
});

test('revisions 는 최신순과 limit 검사, revisions/:id 는 바뀐 파일과 차이를 낸다', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/a/00-x.md': 'a1\n' } });
  s.store.commit({ ...META, message: '바꿈', changes: { 'rules/a/00-x.md': 'a2\n' } });
  const list = (await s.req('/api/v1/revisions?limit=1', { auth: ADMIN })).json();
  assert.deepEqual(list.revisions.map(r => [r.id, r.message, r.files]), [[2, '바꿈', 1]]);
  assert.equal((await s.req('/api/v1/revisions?limit=0', { auth: ADMIN })).status, 400);
  assert.equal((await s.req('/api/v1/revisions?limit=201', { auth: ADMIN })).status, 400);
  const one = (await s.req('/api/v1/revisions/2?diff=1', { auth: ADMIN })).json();
  assert.equal(one.id, 2);
  assert.equal(one.changes[0].kind, 'modify');
  assert.match(one.changes[0].diff, /^--- r1\n\+\+\+ r2\n@@ -1,1 \+1,1 @@\n-a1\n\+a2$/);
  assert.equal((await s.req('/api/v1/revisions/9', { auth: ADMIN })).status, 404);
});

test('가져오기 API 는 없다', async t => {
  const s = await startApp(t);
  const r = await s.req('/api/v1/admin/import', { method: 'POST', auth: ADMIN, headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 404);
});

test('없는 경로는 404, 메서드가 틀리면 405 와 Allow', async t => {
  const s = await startApp(t);
  const r = await s.req('/api/v1/nope', { auth: ADMIN });
  assert.equal(r.status, 404);
  assert.deepEqual(r.json(), { error: '페이지 없음' });
  const m = await s.req('/api/v1/health', { method: 'POST' });
  assert.equal(m.status, 405);
  assert.equal(m.headers.allow, 'GET');
});
