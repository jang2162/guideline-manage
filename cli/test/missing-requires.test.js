import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, collect } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { saveToken } from '../src/credentials.js';
import { manifestText } from '../src/manifest.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { projectStatus } from '../src/commands/project-status.js';
import { runGit } from '../src/projects.js';

const C7_NEEDS_BASE = { 'mcp/c7/README.md': '---\nrequires: [rules/base]\n---\n# c7\n' };

/** 지침 서버 n 개와 각 서버에 저장한 토큰. */
async function servers(t, n) {
  const config = tmpDir('guideline-cfg-');
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: config };
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = await startApp(t);
    s.store.commit({ ...META, source: 'import', changes: SOURCE });
    saveToken(s.base, { token: s.tokens.issue({ name: 'cli-t', scope: 'read' }).token, name: 'cli-t' }, { env });
    list.push(s);
  }
  return { list, env };
}

function project(t, sources) {
  const p = tmpDir('guideline-proj-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  write(p, 'guideline.json', manifestText({ version: 2, form: 'ruler', agents: ['claude'], sources }));
  runGit(['init', '-q'], p);
  return p;
}

const quiet = { err: () => {}, runRuler: () => 0 };
const missingOf = todos => todos.filter(x => x.kind === 'missing-requires');

async function updateJson(p, env) {
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  return JSON.parse(o.text());
}

async function statusJson(p, env) {
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: o.out, err: () => {} }), 0);
  return JSON.parse(o.text());
}

test('update: 원본에 새 requires 가 생겨 빠진 블록이 있으면 missing-requires 를 낸다(글 출력에도)', async t => {
  const { list: [a], env } = await servers(t, 1);
  const p = project(t, { default: { server: a.base, items: ['mcp/c7'] } });
  assert.deepEqual(missingOf((await updateJson(p, env)).todos), []);
  a.store.commit({ ...META, changes: C7_NEEDS_BASE });
  const todos = missingOf((await updateJson(p, env)).todos);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].item, 'mcp/c7');
  assert.deepEqual(todos[0].data, { missing: ['rules/base'] });
  assert.match(todos[0].message, /^mcp\/c7: .*rules\/base.*guideline pick/);
  const o = collect();
  await projectUpdate({ project: p, env, ...quiet, out: o.out });
  assert.match(o.text(), /^할 일$/m);
  assert.match(o.text(), /^ {2}- mcp\/c7: .*rules\/base/m);
});

test('update: 요구하는 스택의 파일이 하나라도 받혀 있으면 missing-requires 가 없다', async t => {
  const { list: [a], env } = await servers(t, 1);
  a.store.commit({ ...META, changes: C7_NEEDS_BASE });
  const p = project(t, { default: { server: a.base, items: ['mcp/c7', 'rules/base/01-b.md'] } });
  assert.deepEqual(missingOf((await updateJson(p, env)).todos), []);
});

test('status: 빠진 블록이 있으면 missing-requires 를 내고(글 출력에도), 다 받았으면 내지 않는다', async t => {
  const { list: [a], env } = await servers(t, 1);
  a.store.commit({ ...META, changes: C7_NEEDS_BASE });
  const p = project(t, { default: { server: a.base, items: ['mcp/c7'] } });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  const todos = missingOf((await statusJson(p, env)).todos);
  assert.deepEqual(todos.map(({ kind, item, data }) => ({ kind, item, data })), [
    { kind: 'missing-requires', item: 'mcp/c7', data: { missing: ['rules/base'] } },
  ]);
  const o = collect();
  await projectStatus({ project: p, env, out: o.out });
  assert.match(o.text(), /^ {2}- mcp\/c7: .*rules\/base.*guideline pick/m);

  const full = project(t, { default: { server: a.base, items: ['mcp/c7', 'rules/base/00-a.md'] } });
  await projectUpdate({ project: full, env, ...quiet, out: () => {} });
  assert.deepEqual(missingOf((await statusJson(full, env)).todos), []);
});

test('출처가 여럿이면 출처마다 그 출처의 requires 와 실제 이름으로 판정한다(별칭이 있어도, 다른 출처의 같은 이름 블록은 세지 않는다)', async t => {
  const { list: [a, b], env } = await servers(t, 2);
  a.store.commit({ ...META, changes: C7_NEEDS_BASE });
  b.store.commit({ ...META, changes: C7_NEEDS_BASE });
  // a 는 c7 만 받았다. b 는 c7 과 base 를 별칭으로 받았다 — b 의 base 는 a 의 c7 이 요구하는 블록이 아니다.
  const p = project(t, {
    a: { server: a.base, items: ['mcp/c7'] },
    b: { server: b.base, items: ['mcp/c7', 'rules/base/00-a.md'], aliases: { 'mcp/c7': 'b-c7', 'rules/base': 'b-base' } },
  });
  const expected = [{ kind: 'missing-requires', item: 'a:mcp/c7', data: { missing: ['rules/base'] } }];
  const pick = todos => missingOf(todos).map(({ kind, item, data }) => ({ kind, item, data }));
  assert.deepEqual(pick((await updateJson(p, env)).todos), expected);
  assert.deepEqual(pick((await statusJson(p, env)).todos), expected);
});
