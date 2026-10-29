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

const action = (s, auth, id, what, payload) => s.req(`/api/v1/proposals/${id}/${what}`, {
  method: 'POST', auth, headers: JSON_H, body: payload === undefined ? undefined : JSON.stringify(payload),
});

test('admin 토큰은 apply 로 바로 반영하고 리비전 작성자는 토큰 이름이다', async t => {
  const { s, post } = await setup(t);
  const admin = s.tokens.issue({ name: 'agent-x', scope: 'admin' }).token;
  const r = await post(admin, body({ apply: true }));
  assert.equal(r.status, 201);
  assert.equal(r.json().status, 'accepted');
  const rev = (await s.req(`/api/v1/revisions/${r.json().revision}`, { auth: admin })).json();
  assert.equal(rev.author, 'agent-x');
});

test('admin 토큰은 모든 제안을 보고 수락·거절한다', async t => {
  const { s, propose, other, post } = await setup(t);
  const admin = s.tokens.issue({ name: 'agent-x', scope: 'admin' }).token;
  const a = (await post(propose, body())).json().id;
  const b = (await post(other, body({ title: '다른 것' }))).json().id;
  assert.equal((await s.req('/api/v1/proposals', { auth: admin })).json().proposals.length, 2);
  assert.equal((await s.req(`/api/v1/proposals/${b}`, { auth: admin })).status, 200);
  const ok = await action(s, admin, a, 'accept');
  assert.equal(ok.status, 200);
  assert.equal(ok.json().status, 'accepted');
  assert.ok(ok.json().revision > 1);
  const no = await action(s, admin, b, 'reject', { note: '중복' });
  assert.equal(no.status, 200);
  assert.deepEqual(no.json(), { id: b, status: 'rejected' });
  assert.equal((await s.req(`/api/v1/proposals/${b}`, { auth: admin })).json().note, '중복');
  assert.equal((await action(s, admin, a, 'accept')).status, 409);
  assert.equal((await action(s, admin, 999, 'accept')).status, 404);
  assert.equal((await action(s, admin, 'x', 'reject')).status, 404);
});

test('propose·read 토큰은 수락·거절 403, 토큰 없으면 401', async t => {
  const { s, propose, read, post } = await setup(t);
  const id = (await post(propose, body())).json().id;
  assert.equal((await action(s, propose, id, 'accept')).status, 403);
  assert.equal((await action(s, read, id, 'reject')).status, 403);
  assert.equal((await action(s, undefined, id, 'accept')).status, 401);
});

test('충돌한 제안 수락은 409 와 conflicts', async t => {
  const { s, propose, post } = await setup(t);
  const id = (await post(propose, body())).json().id;
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': 'z\n' } });
  const r = await action(s, ADMIN, id, 'accept');
  assert.equal(r.status, 409);
  assert.equal(r.json().conflicts.length, 1);
});

test('admin 토큰을 Bearer 로 보내도 웹 관리는 관리자가 아니다', async t => {
  const { s } = await setup(t);
  const admin = s.tokens.issue({ name: 'agent-x', scope: 'admin' }).token;
  const issue = await s.req('/tokens', {
    method: 'POST', auth: admin,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: s.config.publicUrl.origin },
    body: 'name=sneaky&scope=admin',
  });
  assert.equal(issue.status, 303);
  assert.match(issue.headers.location, /^\/login\?next=/);
  assert.equal(s.tokens.list().some(r => r.name === 'sneaky'), false);
  const page = await s.req('/proposals', { auth: admin });
  assert.equal(page.status, 303);
});

test('환경 변수 관리자 토큰도 수락 API 를 쓴다', async t => {
  const { s, propose, post } = await setup(t);
  const id = (await post(propose, body())).json().id;
  assert.equal((await action(s, ADMIN, id, 'accept')).status, 200);
});

// 상세 조회의 ?diff=1·?content=1. 더함(base null)·바뀜·지움, 텍스트와 바이너리를 하나씩 섞는다.
async function viewSetup(t) {
  const { s, propose, other, post } = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/base/01-old.md': 'old\n', 'skills/s/z.bin': Buffer.from([0, 9]) } });
  const { id } = (await post(propose, {
    title: '보기',
    changes: [
      { path: 'rules/base/00-a.md', text: 'A\n', base: h('a\n') },
      { path: 'rules/base/01-old.md', delete: true, base: h('old\n') },
      { path: 'rules/base/02-new.md', text: 'new\n', base: null },
      { path: 'skills/s/y.bin', base64: Buffer.from([0, 255, 1]).toString('base64'), base: null },
      { path: 'skills/s/z.bin', delete: true, base: sha256(Buffer.from([0, 9])) },
    ],
  })).json();
  const get = (auth, q = '') => s.req(`/api/v1/proposals/${id}${q}`, { auth });
  return { s, propose, other, id, get };
}

test('상세 조회는 옵션이 없으면 change 가 path·kind·base 뿐이다', async t => {
  const { propose, get } = await viewSetup(t);
  const changes = (await get(propose)).json().changes;
  assert.deepEqual(changes.map(c => Object.keys(c).sort()), changes.map(() => ['base', 'kind', 'path']));
});

test('?diff=1 은 change 마다 기준 대비 unified diff 를, 바이너리면 null 을 붙인다', async t => {
  const { propose, get } = await viewSetup(t);
  const r = await get(propose, '?diff=1');
  assert.equal(r.status, 200);
  const byPath = Object.fromEntries(r.json().changes.map(c => [c.path, c]));
  assert.equal(byPath['rules/base/00-a.md'].diff, '--- base\n+++ proposal\n@@ -1,1 +1,1 @@\n-a\n+A');
  assert.equal(byPath['rules/base/01-old.md'].diff, '--- base\n+++ proposal\n@@ -1,1 +1,0 @@\n-old');
  assert.equal(byPath['rules/base/02-new.md'].diff, '--- base\n+++ proposal\n@@ -1,0 +1,1 @@\n+new');
  assert.equal(byPath['skills/s/y.bin'].diff, null);
  assert.equal(byPath['skills/s/z.bin'].diff, null);
  assert.ok(Object.values(byPath).every(c => !('text' in c) && !('base64' in c) && !('delete' in c)));
});

test('?content=1 은 올릴 때와 같은 형식(text·base64·delete)을 붙이고 diff=1 과 함께 쓸 수 있다', async t => {
  const { propose, get } = await viewSetup(t);
  const only = Object.fromEntries((await get(propose, '?content=1')).json().changes.map(c => [c.path, c]));
  assert.deepEqual(only['rules/base/00-a.md'], { path: 'rules/base/00-a.md', kind: 'modify', base: h('a\n'), text: 'A\n' });
  assert.deepEqual(only['rules/base/02-new.md'], { path: 'rules/base/02-new.md', kind: 'add', base: null, text: 'new\n' });
  assert.deepEqual(only['skills/s/y.bin'], { path: 'skills/s/y.bin', kind: 'add', base: null, base64: Buffer.from([0, 255, 1]).toString('base64') });
  assert.deepEqual(only['rules/base/01-old.md'], { path: 'rules/base/01-old.md', kind: 'delete', base: h('old\n'), delete: true });
  assert.ok(!('diff' in only['rules/base/00-a.md']));
  const both = (await get(propose, '?diff=1&content=1')).json().changes.find(c => c.path === 'rules/base/00-a.md');
  assert.equal(both.text, 'A\n');
  assert.match(both.diff, /^-a\n\+A$/m);
});

test('?diff=1·?content=1 도 권한은 같다: 다른 propose 토큰은 404, admin 범위 토큰은 본다', async t => {
  const { s, other, get } = await viewSetup(t);
  assert.equal((await get(other, '?diff=1&content=1')).status, 404);
  const admin = s.tokens.issue({ name: 'agent-v', scope: 'admin' }).token;
  const r = await get(admin, '?diff=1&content=1');
  assert.equal(r.status, 200);
  assert.equal(r.json().changes.find(c => c.path === 'rules/base/02-new.md').text, 'new\n');
});
