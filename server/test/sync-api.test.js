import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startApp, testConfig, ADMIN, META } from './helpers.js';
import { untarGz } from '../../cli/src/tar-read.js';

const FORM = { revision: 1, project: { name: 'p', path: '/x/p', form: 'ruler', isNew: false, gitRepo: true, dirty: false }, items: [], overrides: [] };
const post = (s, path, body, { auth, headers = {} } = {}) => s.req(path, {
  method: 'POST', auth, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers },
});

async function withData(t, opts) {
  const s = await startApp(t, opts);
  s.store.commit({ ...META, source: 'import', changes: { 'rules/a/00-x.md': 'a1\n', 'skills/s/SKILL.md': 's' } });
  return s;
}

test('health 는 api 2 를 낸다', async t => {
  const s = await startApp(t);
  assert.equal((await s.req('/api/v1/health')).json().api, 2);
});

test('archive 는 그 리비전 트리의 tar.gz', async t => {
  const s = await withData(t);
  s.store.commit({ ...META, changes: { 'rules/a/00-x.md': 'a2\n' } });
  const r1 = await s.req('/api/v1/archive?rev=1', { auth: ADMIN });
  assert.equal(r1.status, 200);
  assert.equal(r1.headers['content-type'], 'application/gzip');
  assert.equal(r1.headers['x-guideline-revision'], '1');
  assert.equal(untarGz(r1.body).get('rules/a/00-x.md').toString(), 'a1\n');
  const head = await s.req('/api/v1/archive', { auth: ADMIN });
  assert.equal(untarGz(head.body).get('rules/a/00-x.md').toString(), 'a2\n');
  assert.equal((await s.req('/api/v1/archive')).status, 200, '공개 서버는 토큰 없이');
  const closed = await withData(t, { config: testConfig({ publicRead: false }) });
  assert.equal((await closed.req('/api/v1/archive')).status, 401);
});

test('지침이 없으면 archive 는 404', async t => {
  const s = await startApp(t);
  assert.equal((await s.req('/api/v1/archive', { auth: ADMIN })).status, 404);
});

test('tokens/self 는 자기 토큰을 폐기하고, 관리자 토큰이면 400', async t => {
  const s = await startApp(t);
  const { token } = s.tokens.issue({ name: 'cli-x', scope: 'read' });
  assert.equal((await s.req('/api/v1/tokens/self', { method: 'DELETE', auth: token })).status, 200);
  assert.equal(s.tokens.verify(token), null);
  assert.equal((await s.req('/api/v1/tokens/self', { method: 'DELETE', auth: ADMIN })).status, 400);
});

test('폼 만들기·결과: 만든 토큰만 결과를 본다', async t => {
  const s = await withData(t);
  const a = s.tokens.issue({ name: 'cli-a', scope: 'read' }).token;
  const b = s.tokens.issue({ name: 'cli-b', scope: 'read' }).token;
  const r = await post(s, '/api/v1/forms', FORM, { auth: a });
  assert.equal(r.status, 201);
  const { id, url, expiresAt } = r.json();
  assert.match(url, new RegExp(`^http://guideline\\.test/forms/${id}\\?k=[A-Za-z0-9_-]+$`));
  assert.ok(Date.parse(expiresAt) > Date.now());
  assert.deepEqual((await s.req(`/api/v1/forms/${id}/result?wait=0`, { auth: a })).json(), { status: 'pending' });
  assert.equal((await s.req(`/api/v1/forms/${id}/result`, { auth: b })).status, 404);
  assert.equal((await s.req(`/api/v1/forms/${id}/result`, { auth: ADMIN })).status, 404);
  s.app.deps.forms.finish(id, 'submitted', { version: 1, items: [] });
  assert.deepEqual((await s.req(`/api/v1/forms/${id}/result`, { auth: a })).json(), { status: 'submitted', selection: { version: 1, items: [] } });
});

test('폼 만들기는 본문 모양·리비전·크기·형식·CLI 버전을 검사한다', async t => {
  const s = await withData(t);
  const a = s.tokens.issue({ name: 'cli-a', scope: 'read' }).token;
  assert.equal((await post(s, '/api/v1/forms', { ...FORM, items: 'x' }, { auth: a })).status, 400);
  assert.equal((await post(s, '/api/v1/forms', { ...FORM, revision: 9 }, { auth: a })).status, 400);
  assert.equal((await post(s, '/api/v1/forms', { ...FORM, pad: 'x'.repeat(2 * 1024 * 1024) }, { auth: a })).status, 413);
  assert.equal((await post(s, '/api/v1/forms', FORM, { auth: a, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await post(s, '/api/v1/forms', FORM, { auth: a, headers: { 'X-Guideline-Client': '0.11.0' } })).status, 426);
  assert.equal((await post(s, '/api/v1/forms', FORM, { auth: a, headers: { 'X-Guideline-Client': '0.12.0' } })).status, 201);
  const closed = await withData(t, { config: testConfig({ publicRead: false }) });
  assert.equal((await post(closed, '/api/v1/forms', FORM)).status, 401);
});

test('공개 서버는 토큰 없이 폼을 만들고, 그 결과는 링크 토큰(X-Form-Link)으로만 본다', async t => {
  const s = await withData(t);
  const r = await post(s, '/api/v1/forms', FORM);
  assert.equal(r.status, 201);
  const { id, url } = r.json();
  const k = new URL(url).searchParams.get('k');
  assert.equal((await s.req(`/api/v1/forms/${id}/result`)).status, 404);
  assert.equal((await s.req(`/api/v1/forms/${id}/result`, { headers: { 'X-Form-Link': 'nope' } })).status, 404);
  const other = s.tokens.issue({ name: 'cli-b', scope: 'read' }).token;
  assert.equal((await s.req(`/api/v1/forms/${id}/result`, { auth: other })).status, 404);
  assert.deepEqual((await s.req(`/api/v1/forms/${id}/result`, { headers: { 'X-Form-Link': k } })).json(), { status: 'pending' });
  assert.equal((await s.req(`/api/v1/forms/${id}/result`, { auth: ADMIN })).status, 200);
  const a = s.tokens.issue({ name: 'cli-a', scope: 'read' }).token;
  const mine = (await post(s, '/api/v1/forms', FORM, { auth: a })).json();
  const mk = new URL(mine.url).searchParams.get('k');
  assert.equal((await s.req(`/api/v1/forms/${mine.id}/result`, { headers: { 'X-Form-Link': mk } })).status, 404, '토큰 폼은 그 토큰만');
});

test('result 는 wait 동안 기다렸다가 끝나면 바로 답한다', async t => {
  const s = await withData(t);
  const a = s.tokens.issue({ name: 'cli-a', scope: 'read' }).token;
  const { id } = (await post(s, '/api/v1/forms', FORM, { auth: a })).json();
  setTimeout(() => s.app.deps.forms.finish(id, 'cancelled'), 300);
  const started = Date.now();
  const r = await s.req(`/api/v1/forms/${id}/result?wait=5`, { auth: a });
  assert.equal(r.json().status, 'cancelled');
  assert.ok(Date.now() - started < 3000);
});

test('열지 않은 폼은 notOpenedMs 뒤에 expired', async t => {
  const s = await withData(t, { formTimers: { notOpenedMs: 50, gapMs: 50, keepMs: 1e9 } });
  const a = s.tokens.issue({ name: 'cli-a', scope: 'read' }).token;
  const { id } = (await post(s, '/api/v1/forms', FORM, { auth: a })).json();
  await new Promise(r => setTimeout(r, 80));
  assert.equal((await s.req(`/api/v1/forms/${id}/result`, { auth: a })).json().status, 'expired');
});

test('cli/token 은 코드와 verifier 를 읽기 토큰으로 바꾼다. 틀리면 400, 다섯 번 틀리면 429', async t => {
  const s = await withData(t);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = s.app.deps.cliLogins.issue({ challenge, name: 'cli-host-abc123' });
  const r = await post(s, '/api/v1/cli/token', { code, verifier });
  assert.equal(r.status, 200);
  const { token, name } = r.json();
  assert.equal(name, 'cli-host-abc123');
  assert.match(token, /^glt_/);
  assert.equal((await s.req('/api/v1/tree', { auth: token })).status, 200);
  assert.equal(s.tokens.list().find(x => x.name === name).scope, 'read');
  assert.equal((await post(s, '/api/v1/cli/token', { code, verifier })).status, 400);
  for (let i = 0; i < 4; i++) await post(s, '/api/v1/cli/token', { code: 'x', verifier });
  assert.equal((await post(s, '/api/v1/cli/token', { code: 'x', verifier })).status, 429);
});
