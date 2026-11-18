import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, collect, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { projectPick } from '../src/commands/project-pick.js';
import { runGit } from '../src/projects.js';
import { syncedProject } from './synced.js';
import { MANIFEST, manifestText } from '../src/manifest.js';

const WITH_REQUIRES = {
  ...SOURCE,
  'mcp/c7/README.md': '---\nrequires: [rules/base]\n---\n# c7\n',
};

async function server(t, files = WITH_REQUIRES) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: files });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  return { s, env: { GUIDELINE_TOKEN: token, GUIDELINE_SERVER: s.base } };
}

function project(t, files = {}) {
  const p = tmpDir('guideline-rec-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  for (const [k, v] of Object.entries(files)) write(p, k, v);
  runGit(['init', '-q'], p);
  return p;
}

/** 폼을 열어 /data 를 받아 두고 취소한다. */
function peek(s, seen) {
  return async url => {
    const u = new URL(url);
    const r = await s.req(u.pathname + u.search);
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    seen.data = (await s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json();
    await s.req(`${u.pathname}/cancel`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: s.config.publicUrl.origin, Cookie: cookie } });
  };
}

const quiet = { pollWait: 1, runRuler: () => 0, out: () => {} };
const recFile = (t, obj) => {
  const d = tmpDir('guideline-recfile-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const f = path.join(d, 'rec.json');
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return f;
};

test('--recommend 는 추천과 이유를 폼 data 에 싣고, catalog 에 requires 가 있다', async t => {
  const { s, env } = await server(t);
  const p = project(t);
  const seen = {};
  const code = await projectPick({ project: p, env, ...quiet, err: () => {}, recommend: recFile(t, { 'rules/base': '공통', 'mcp/c7': '' }), open: peek(s, seen) });
  assert.equal(code, 3);
  assert.deepEqual(seen.data.recommend, { 'rules/base': '공통', 'mcp/c7': '' });
  assert.deepEqual(seen.data.catalog.mcp.find(m => m.name === 'c7').requires, ['rules/base']);
});

test('--recommend 는 표준 입력(-)도 읽는다', async t => {
  const { s, env } = await server(t);
  const p = project(t);
  const seen = {};
  await projectPick({ project: p, env, ...quiet, err: () => {}, recommend: '-', readStdin: async () => '{"skills/s":"스킬"}', open: peek(s, seen) });
  assert.deepEqual(seen.data.recommend, { 'skills/s': '스킬' });
});

test('추천 JSON 이 틀리거나 원본에 없는 키면 폼을 만들지 않고 코드 2', async t => {
  const { s, env } = await server(t);
  const p = project(t);
  for (const bad of ['[1]', '{"rules/base": 1}', 'not json']) {
    const e = collect();
    assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, recommend: recFile(t, bad), open: () => assert.fail('폼을 열면 안 됨') }), 2, bad);
  }
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, recommend: recFile(t, { 'rules/nope': '' }), open: () => assert.fail('폼을 열면 안 됨') }), 2);
  assert.match(e.text(), /rules\/nope/);
  assert.equal(s.app.store.db.prepare('SELECT COUNT(*) AS n FROM forms').get().n, 0);
});

test('출처가 여럿인데 --source 없이 --recommend 면 코드 2', async t => {
  const { s, env } = await server(t);
  const p = project(t, {
    'guideline.json': JSON.stringify({ version: 2, form: 'ruler', agents: ['claude'], sources: { a: { server: s.base, items: [], aliases: {} }, b: { server: s.base, items: [], aliases: { 'rules/base': 'b-base' } } } }),
  });
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, recommend: recFile(t, { 'rules/base': '' }), open: () => assert.fail('폼을 열면 안 됨') }), 2);
});

test('별칭이 걸린 출처에서는 추천과 requires 를 별칭 이름으로 싣는다', async t => {
  const { s, env } = await server(t);
  const p = project(t, {
    'guideline.json': JSON.stringify({ version: 2, form: 'ruler', agents: ['claude'], sources: { company: { server: s.base, items: [], aliases: { 'rules/base': 'company-base' } } } }),
  });
  const seen = {};
  await projectPick({ project: p, env, ...quiet, err: () => {}, source: 'company', recommend: recFile(t, { 'rules/base': '공통' }), open: peek(s, seen) });
  assert.deepEqual(seen.data.recommend, { 'rules/company-base': '공통' });
  assert.deepEqual(seen.data.catalog.mcp.find(m => m.name === 'c7').requires, ['rules/company-base']);
});

test('--recommend 는 하위 스택 키를 받는다', async t => {
  const { s, env } = await server(t, { ...WITH_REQUIRES, 'rules/base/sub/00-s.md': `${ALWAYS}# 에스\n\n본문 S\n` });
  const p = project(t);
  const seen = {};
  const e = collect();
  const code = await projectPick({ project: p, env, ...quiet, err: e.out, recommend: recFile(t, { 'rules/base/sub': '하위' }), open: peek(s, seen) });
  assert.equal(code, 3, e.text());
  assert.deepEqual(seen.data.recommend, { 'rules/base/sub': '하위' });
});

/** 응답에서 formVersion 을 뗀 옛 서버처럼 보이게 하는 fetch. 폼 본문과 취소 요청을 기록한다. */
function oldServerFetch(log) {
  return async (url, init = {}) => {
    const u = new URL(url);
    log.push({ method: init.method ?? 'GET', path: u.pathname, body: init.body, headers: init.headers });
    const res = await fetch(url, init);
    if (init.method === 'POST' && u.pathname === '/api/v1/forms') {
      const { formVersion, ...old } = await res.json();
      return new Response(JSON.stringify(old), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
    return res;
  };
}

test('formVersion 없는 서버(옛 서버)면 폼을 취소하고 serverOld 로 코드 1', async t => {
  const { s, env } = await server(t);
  const p = project(t);
  const log = [];
  const e = collect();
  const code = await projectPick({
    project: p, env, ...quiet, err: e.out, fetchImpl: oldServerFetch(log), open: () => assert.fail('옛 서버의 폼을 열면 안 됨'),
  });
  assert.equal(code, 1);
  assert.match(e.text(), /지침 서버 0\.24\.0 이상이 필요/);
  const post = log.find(c => c.method === 'POST' && c.path === '/api/v1/forms');
  assert.equal(JSON.parse(post.body).formVersion, 2);
  assert.equal(s.app.store.db.prepare('SELECT status FROM forms').get().status, 'cancelled');
  assert.ok(!fs.existsSync(path.join(p, 'guideline.json')), '옛 서버면 아무것도 쓰지 않는다');
});

test('--recommend 는 --local 에서 remove 를 받고 필수 뺌은 거절한다', async t => {
  const { s, env } = await server(t);
  const p = fs.realpathSync(tmpDir('guideline-rec-local-'));
  const config = tmpDir('guideline-rec-local-config-');
  t.after(() => {
    fs.rmSync(p, { recursive: true, force: true });
    fs.rmSync(config, { recursive: true, force: true });
  });
  runGit(['init', '-q'], p);
  const { manifest } = syncedProject(p, { server: s.base, items: ['rules/base', 'skills/s'], source: WITH_REQUIRES });
  manifest.sources.default.required = ['rules/base'];
  write(p, MANIFEST, manifestText(manifest));
  const lenv = { ...env, XDG_CONFIG_HOME: config };
  // 새 모양: 더함·뺌을 미리 체크하고 둘 다 추천 표시(이유)로 싣는다
  const seen = {};
  const e = collect();
  const code = await projectPick({
    project: p, local: true, env: lenv, ...quiet, err: e.out, open: peek(s, seen),
    recommend: recFile(t, { add: { 'mcp/c7': '문서 찾기' }, remove: { 'skills/s': '안 씀' } }),
  });
  assert.equal(code, 3, e.text());
  assert.equal(seen.data.mode, 'personal');
  assert.deepEqual(seen.data.personal.add, ['mcp/c7']);
  assert.deepEqual(seen.data.personal.remove, ['skills/s']);
  assert.deepEqual(seen.data.recommend, { 'mcp/c7': '문서 찾기', 'skills/s': '안 씀' });
  // 지금 모양 { 키: 이유 } 는 더함이다
  await projectPick({ project: p, local: true, env: lenv, ...quiet, err: () => {}, open: peek(s, seen), recommend: recFile(t, { 'mcp/c7': '' }) });
  assert.deepEqual([seen.data.personal.add, seen.data.personal.remove], [['mcp/c7'], []]);
  // 필수(와 필수를 품은 스택)를 빼라는 추천은 폼을 만들지 않고 코드 2
  const before = s.app.store.db.prepare('SELECT COUNT(*) AS n FROM forms').get().n;
  const bad = collect();
  assert.equal(await projectPick({
    project: p, local: true, env: lenv, ...quiet, err: bad.out, open: () => assert.fail('폼을 열면 안 됨'),
    recommend: recFile(t, { remove: { 'rules/base': '' } }),
  }), 2);
  assert.match(bad.text(), /필수 블록\(또는 필수를 품은 스택\)은 빼라고 추천할 수 없음: rules\/base/);
  assert.equal(s.app.store.db.prepare('SELECT COUNT(*) AS n FROM forms').get().n, before);
  // 새 모양은 --local 에서만 받는다
  const plain = collect();
  assert.equal(await projectPick({ project: p, env: lenv, ...quiet, err: plain.out, open: () => assert.fail(), recommend: recFile(t, { add: { 'mcp/c7': '' } }) }), 2);
  assert.match(plain.text(), /JSON 이어야 함/);
});
