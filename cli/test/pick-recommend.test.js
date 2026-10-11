import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, collect } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { projectPick } from '../src/commands/project-pick.js';
import { runGit } from '../src/projects.js';

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
