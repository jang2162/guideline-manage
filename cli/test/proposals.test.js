import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, collect } from './helpers.js';
import { sha256 } from '../src/hashes.js';
import { proposals } from '../src/commands/proposals.js';
import { main } from '../src/cli.js';

const h = s => sha256(Buffer.from(s));
// 명령은 cwd 의 guideline.json 에서 서버를 찾는다. 이 저장소 루트에도 guideline.json 이 있으므로 빈 폴더를 cwd 로 준다.
const NEUTRAL = tmpDir('guideline-cwd-');
process.on('exit', () => fs.rmSync(NEUTRAL, { recursive: true, force: true }));
const cap = async opts => {
  const o = collect();
  const e = collect();
  const code = await proposals({ out: o.out, err: e.out, cwd: NEUTRAL, ...opts });
  return { code, out: o.text(), err: e.text() };
};

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': 'a\n', 'skills/s/z.bin': Buffer.from([0, 9]) } });
  const p1 = s.tokens.issue({ name: 'p1', scope: 'propose' });
  const p2 = s.tokens.issue({ name: 'p2', scope: 'propose' });
  const [mine, other] = [p1.token, p2.token];
  const first = s.proposals.submit({
    title: '첫 제안', description: '설명 한 줄', project: 'my-app', tokenId: p1.id, author: 'p1',
    changes: [
      { path: 'rules/base/00-a.md', content: Buffer.from('A\n'), base: h('a\n') },
      { path: 'rules/base/01-new.md', content: Buffer.from('new\n'), base: null },
      { path: 'skills/s/z.bin', content: null, base: sha256(Buffer.from([0, 9])) },
    ],
  });
  s.proposals.submit({
    title: '둘째', project: null, tokenId: p2.id, author: 'p2',
    changes: [{ path: 'rules/base/02-b.md', content: Buffer.from('b\n'), base: null }],
  });
  const env = { GUIDELINE_SERVER: s.base, GUIDELINE_TOKEN: mine };
  return { s, env, mine, other, id: String(first.id), admin: { ...env, GUIDELINE_TOKEN: s.tokens.issue({ name: 'a1', scope: 'admin' }).token } };
}

test('목록은 번호·상태·제목·작성자·프로젝트·날짜·파일 수를 보이고 --status 로 거른다', async t => {
  const { s, admin, env } = await setup(t);
  const all = await cap({ env: admin });
  assert.equal(all.code, 0, all.err);
  const lines = all.out.split('\n');
  assert.match(lines[0], /^번호\s+상태\s+제목\s+올린 이\s+프로젝트\s+올린 때\s+파일$/);
  assert.match(lines[1], /^#2\s+대기\s+둘째\s+p2\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+1$/);
  assert.match(lines[2], /^#1\s+대기\s+첫 제안\s+p1\s+my-app\s+\d{4}-\d\d-\d\d \d\d:\d\d\s+3$/);
  // 발급 토큰은 자기 것만 본다
  assert.doesNotMatch((await cap({ env })).out, /둘째/);
  s.proposals.reject(2, '');
  assert.equal((await cap({ env: admin, status: 'pending' })).out.split('\n').length, 2);
  assert.equal((await cap({ env: admin, status: 'accepted' })).out, '제안 없음.');
});

test('상세는 메타와 파일마다 종류·차이를 보이고, 바이너리는 차이 대신 안내', async t => {
  const { env, id } = await setup(t);
  const r = await cap({ env, id });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  const lines = r.out.split('\n');
  assert.equal(lines[0], '#1 첫 제안');
  assert.match(lines[1], /^대기 · p1 · my-app · \d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.match(r.out, /\n설명 한 줄\n/);
  assert.match(r.out, /\/proposals\/1\n/);
  assert.match(r.out, /파일 3개\n {2}바뀜 {2}rules\/base\/00-a\.md\n--- base\n\+\+\+ proposal\n@@ -1,1 \+1,1 @@\n-a\n\+A\n/);
  assert.match(r.out, / {2}더함 {2}rules\/base\/01-new\.md\n--- base\n\+\+\+ proposal\n@@ -1,0 \+1,1 @@\n\+new\n/);
  assert.match(r.out, / {2}지움 {2}skills\/s\/z\.bin\n {4}\(텍스트가 아니라 차이 없음\)$/);
  assert.doesNotMatch(r.out, /Outdated/);
});

test('상세는 원본이 겹치게 바뀌었으면 Outdated 와 충돌 경로를 보인다', async t => {
  const { s, env, id } = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': 'z\n' } });
  const r = await cap({ env, id });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Outdated: .*\n {2}rules\/base\/00-a\.md — .+\n/);
});

test('--json 은 서버 응답(?diff=1)을 그대로 출력한다', async t => {
  const { s, env, mine, id } = await setup(t);
  const r = await cap({ env, id, json: true });
  assert.equal(r.code, 0, r.err);
  const server = (await s.req(`/api/v1/proposals/${id}?diff=1`, { auth: mine })).json();
  assert.deepEqual(JSON.parse(r.out), server);
  assert.equal(server.changes[0].diff.split('\n')[0], '--- base');
  const list = await cap({ env, json: true });
  assert.deepEqual(JSON.parse(list.out), (await s.req('/api/v1/proposals', { auth: mine })).json());
});

test('change 에 diff 가 없는 옛 서버면 안내를 띄우고 파일 목록만 보인다', async t => {
  const { env, id } = await setup(t);
  // ?diff=1 을 모르는 서버 흉내: 응답의 diff 키를 뗀다.
  const old = async (url, init) => {
    const res = await fetch(url, init);
    const body = await res.json();
    for (const c of body.changes ?? []) delete c.diff;
    return new Response(JSON.stringify(body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  };
  const r = await cap({ env, id, fetchImpl: old });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '서버가 옛 버전이라 차이를 보여 줄 수 없음. 파일 목록만 보임');
  assert.match(r.out, /파일 3개\n {2}바뀜 {2}rules\/base\/00-a\.md\n {2}더함 {2}rules\/base\/01-new\.md\n {2}지움 {2}skills\/s\/z\.bin$/);
  assert.doesNotMatch(r.out, /^--- base/m);
});

test('남의 제안·없는 번호는 서버 오류로 1, 잘못된 번호·상태·조합·서버 없음은 2', async t => {
  const { env, other, id } = await setup(t);
  const theirs = await cap({ env: { ...env, GUIDELINE_TOKEN: other }, id });
  assert.equal(theirs.code, 1);
  assert.equal(theirs.err, '제안 없음');
  assert.equal((await cap({ env, id: '999' })).code, 1);
  for (const opts of [{ id: 'abc' }, { id: '0' }, { id: '-1' }, { status: 'nope' }, { id, status: 'pending' }]) {
    const r = await cap({ env, ...opts });
    assert.equal(r.code, 2, JSON.stringify(opts));
    assert.notEqual(r.err, '');
  }
  assert.match((await cap({ env, status: 'nope' })).err, /pending, accepted, rejected/);
  const none = await cap({ env: {} });
  assert.equal(none.code, 2);
  assert.match(none.err, /서버 주소 없음/);
});

test('main: proposals 는 인자가 둘 넘거나 모르는 옵션이면 2', async () => {
  const saved = console.error;
  console.error = () => {};
  try {
    assert.equal(await main(['proposals', '1', '2']), 2);
    assert.equal(await main(['proposals', '--force']), 2);
    assert.equal(await main(['proposals', '1', '--status', 'pending', '--server', 'http://127.0.0.1:9']), 2);
  } finally {
    console.error = saved;
  }
});
