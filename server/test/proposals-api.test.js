import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, META, ADMIN } from './helpers.js';
import { sha256 } from '../src/store.js';

const JSON_H = { 'Content-Type': 'application/json' };
const h = s => sha256(Buffer.from(s));

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': 'a\n', 'skills/s/x.png': Buffer.from([1, 2]) } });
  const propose = s.tokens.issue({ name: 'p1', scope: 'propose' }).token;
  const other = s.tokens.issue({ name: 'p2', scope: 'propose' }).token;
  const read = s.tokens.issue({ name: 'r1', scope: 'read' }).token;
  const post = (auth, body) => s.req('/api/v1/proposals', { method: 'POST', auth, headers: JSON_H, body: JSON.stringify(body) });
  return { s, propose, other, read, post };
}
const body = extra => ({
  title: '고침', project: 'my-app',
  changes: [
    { path: 'rules/base/00-a.md', text: 'A\n', base: h('a\n') },
    { path: 'skills/s/y.png', base64: Buffer.from([7]).toString('base64'), base: null },
    { path: 'skills/s/x.png', delete: true, base: sha256(Buffer.from([1, 2])) },
  ],
  ...extra,
});

test('propose 토큰은 제안을 만들고, read 토큰은 403', async t => {
  const { s, propose, read, post } = await setup(t);
  assert.equal((await post(read, body())).status, 403);
  assert.match((await post(read, body())).json().error, /제안 권한이 없는 토큰/);
  const r = await post(propose, body());
  assert.equal(r.status, 201);
  const out = r.json();
  assert.equal(out.status, 'pending');
  assert.equal(out.url, `http://guideline.test/proposals/${out.id}`);
  const got = (await s.req(`/api/v1/proposals/${out.id}`, { auth: propose })).json();
  assert.deepEqual(got.changes.map(c => [c.path, c.kind]), [
    ['rules/base/00-a.md', 'modify'], ['skills/s/x.png', 'delete'], ['skills/s/y.png', 'add'],
  ]);
  assert.equal(got.author, 'p1');
  assert.equal(got.project, 'my-app');
  assert.equal(got.outdated, false);
});

test('발급 토큰은 자기 제안만 본다. 관리자는 전부', async t => {
  const { s, propose, other, post } = await setup(t);
  const { id } = (await post(propose, body())).json();
  assert.equal((await s.req(`/api/v1/proposals/${id}`, { auth: other })).status, 404);
  assert.deepEqual((await s.req('/api/v1/proposals', { auth: other })).json().proposals, []);
  assert.equal((await s.req('/api/v1/proposals', { auth: ADMIN })).json().proposals.length, 1);
  assert.equal((await s.req('/api/v1/proposals?status=pending', { auth: propose })).json().proposals[0].id, id);
  assert.equal((await s.req('/api/v1/proposals?status=nope', { auth: ADMIN })).status, 400);
});

test('apply 는 관리자만이고, 충돌이면 409 와 conflicts, 아니면 바로 리비전', async t => {
  const { s, propose, post } = await setup(t);
  assert.equal((await post(propose, body({ apply: true }))).status, 403);
  const ok = await post(ADMIN, body({ apply: true }));
  assert.equal(ok.status, 201);
  const out = ok.json();
  assert.equal(out.status, 'accepted');
  assert.equal(s.store.fileAt('rules/base/00-a.md', out.revision).toString(), 'A\n');
  assert.equal(s.store.revision(out.revision).author, 'admin');
  const bad = await post(ADMIN, { title: 'x', changes: [{ path: 'rules/base/00-a.md', text: 'B\n', base: h('a\n') }], apply: true });
  assert.equal(bad.status, 409);
  assert.equal(bad.json().conflicts[0].path, 'rules/base/00-a.md');
});

test('본문 형식·경로·바뀐 것 없음은 400', async t => {
  const { propose, post } = await setup(t);
  const cases = [
    { title: 'x', changes: [{ path: 'rules/a.md', text: 'x', base64: 'eA==', base: null }] },
    { title: 'x', changes: [{ path: 'rules/a.md', text: 'x' }] },
    { title: 'x', changes: [{ path: 'rules/a.md', text: 'x', base: 'nothex' }] },
    { title: 'x', changes: [{ path: '/etc/passwd', text: 'x', base: null }] },
    { title: 'x', changes: [{ path: 'rules/base/00-a.md', text: 'a\n', base: h('a\n') }] },
    { title: 'x', changes: 'no' },
    { title: 3, changes: [{ path: 'rules/a.md', text: 'x', base: null }] },
  ];
  for (const c of cases) assert.equal((await post(propose, c)).status, 400, JSON.stringify(c));
});

test('토큰 없이는 401', async t => {
  const { s } = await setup(t);
  assert.equal((await s.req('/api/v1/proposals')).status, 401);
});
