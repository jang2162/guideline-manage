import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tarGz } from '../../server/src/tar.js';
import { remoteClient, serverOf, explain, loadSource, API_LEVEL, ServerError, tokenInfo } from '../src/remote.js';
import { readText } from '../src/tree.js';

/** 요청을 기록하고 정한 응답을 주는 fetch. */
function fakeFetch(respond) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    return respond(String(url), init);
  };
  f.calls = calls;
  return f;
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('serverOf 는 --server > 매니페스트 > 환경 변수, 끝 / 를 뗀다', () => {
  assert.equal(serverOf({ flag: 'http://a/', manifest: { server: 'http://b' }, env: { GUIDELINE_SERVER: 'http://c' } }), 'http://a');
  assert.equal(serverOf({ manifest: { server: 'http://b' }, env: { GUIDELINE_SERVER: 'http://c' } }), 'http://b');
  assert.equal(serverOf({ env: { GUIDELINE_SERVER: 'http://c//' } }), 'http://c');
  assert.equal(serverOf({ env: {} }), null);
});

test('요청마다 X-Guideline-Client 를 보내고 토큰은 인증이 필요한 요청에만 붙인다', async () => {
  const f = fakeFetch(() => json(200, { ok: true, api: 2, revision: 3 }));
  const c = remoteClient({ server: 'http://s', token: 'glt_x', fetchImpl: f, version: '9.9.9' });
  await c.health();
  await c.tree(3);
  await c.exchange('code', 'ver');
  assert.deepEqual(f.calls.map(x => x.url), ['http://s/api/v1/health', 'http://s/api/v1/tree?rev=3', 'http://s/api/v1/cli/token']);
  assert.equal(f.calls[0].headers['X-Guideline-Client'], '9.9.9');
  assert.equal(f.calls[0].headers.Authorization, undefined);
  assert.equal(f.calls[1].headers.Authorization, 'Bearer glt_x');
  assert.equal(f.calls[2].headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(f.calls[2].body), { code: 'code', verifier: 'ver' });
});

test('archive 는 바이트, 오류는 ServerError(status 와 서버 메시지)', async () => {
  const gz = tarGz([{ path: 'a.md', content: Buffer.from('A') }]);
  const f = fakeFetch(url => (url.includes('archive') ? new Response(gz, { status: 200 }) : json(401, { error: '토큰 필요' })));
  const c = remoteClient({ server: 'http://s', token: 't', fetchImpl: f });
  assert.ok((await c.archive(1)).equals(gz));
  await assert.rejects(c.tree(), e => e instanceof ServerError && e.status === 401 && e.message === '토큰 필요');
});

test('서버에 닿지 못하면 status 0', async () => {
  const c = remoteClient({ server: 'http://s', fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); } });
  await assert.rejects(c.health(), e => e.status === 0 && /지침 서버 연결 실패: http:\/\/s \(ECONNREFUSED\)/.test(e.message));
});

test('explain 은 401·426 을 할 일로 바꾼다', () => {
  assert.equal(explain(new ServerError('x', 401), 'http://s'), '로그인 필요: guideline login --server http://s');
  assert.match(explain(new ServerError('x', 426), 'http://s'), /CLI 버전이 낮음/);
  assert.equal(explain(new Error('그 밖'), 'http://s'), '그 밖');
});

test('loadSource 는 api 수준과 리비전을 확인하고 최신 원본 트리를 받는다', async () => {
  const gz = tarGz([{ path: 'rules/base/00-a.md', content: Buffer.from('A') }]);
  const client = rev => ({ health: async () => ({ api: API_LEVEL, revision: rev }), archive: async r => (assert.equal(r, rev), gz) });
  const { revision, tree } = await loadSource(client(4));
  assert.equal(revision, 4);
  assert.equal(readText(tree, 'rules/base/00-a.md'), 'A');
  await assert.rejects(loadSource({ health: async () => ({ revision: 4 }) }), /지침 서버 버전이 낮음/);
  await assert.rejects(loadSource(client(0)), /아직 지침 없음/);
});

test('whoami 는 토큰을 보내 범위를 받고, 옛 서버(404)면 null, 401 은 오류다. tokenInfo 는 어떤 오류든 null', async () => {
  const ok = fakeFetch(() => json(200, { kind: 'token', name: 'cli-a', scope: 'admin' }));
  const c = remoteClient({ server: 'http://s', token: 'glt_x', fetchImpl: ok });
  assert.deepEqual(await c.whoami(), { kind: 'token', name: 'cli-a', scope: 'admin' });
  assert.equal(ok.calls[0].url, 'http://s/api/v1/whoami');
  assert.equal(ok.calls[0].headers.Authorization, 'Bearer glt_x');
  assert.deepEqual(await tokenInfo(c), { name: 'cli-a', scope: 'admin' });
  const old = remoteClient({ server: 'http://s', token: 'glt_x', fetchImpl: fakeFetch(() => json(404, { error: '페이지 없음' })) });
  assert.equal(await old.whoami(), null);
  assert.equal(await tokenInfo(old), null);
  const bad = remoteClient({ server: 'http://s', token: 'glt_x', fetchImpl: fakeFetch(() => json(401, { error: '토큰 필요' })) });
  await assert.rejects(bad.whoami(), e => e instanceof ServerError && e.status === 401);
  assert.equal(await tokenInfo(bad), null);
  const down = remoteClient({ server: 'http://s', token: 'glt_x', fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')) });
  assert.equal(await tokenInfo(down), null);
});
