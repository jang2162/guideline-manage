import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { syncedProject } from './synced.js';
import { MANIFEST, LOCK, manifestText, readManifest } from '../src/manifest.js';
import { runGit } from '../src/projects.js';
import { personalStore, readLocal, writeLocal } from '../src/personal.js';
import { readDefaults, writeDefaults } from '../src/defaults.js';
import { saveToken } from '../src/credentials.js';
import { projectPick } from '../src/commands/project-pick.js';
import { projectApply } from '../src/commands/project-apply.js';
import { readRole, writeRole } from '../src/role.js';

// 개인 저장소는 임시 git 저장소의 공용 디렉터리에, 머신 기본값·로그인은 임시 XDG_CONFIG_HOME 에 둔다
// (이 저장소 자신의 .git 과 사용자의 ~/.config 는 건드리지 않는다).

const EXTRA = {
  'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n`,
  'rules/extra/sub/00-s.md': `${ALWAYS}# 하위\n`,
  'rules/base/sub/00-bs.md': `${ALWAYS}# 베이스 하위\n`,
};
const FILES = { ...SOURCE, ...EXTRA };

const commitAll = p => {
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
};
const porcelain = p => runGit(['status', '--porcelain', '--untracked-files=all'], p).stdout;

/**
 * 서버와, 그 서버에서 받아 커밋한 git 프로젝트. sources 를 주면 출처 여럿({ 이름: { items, aliases? } }, 모두 같은 서버),
 * required 는 { 출처: [키] }. 출처를 sources 로 주면 토큰은 임시 로그인 정보에 저장한다(GUIDELINE_TOKEN 은 출처 하나일 때만 쓴다).
 */
async function setup(t, { items = ['rules/base'], sources, required = {}, git = true } = {}) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: FILES });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = fs.realpathSync(tmpDir('guideline-pick-local-'));
  const config = tmpDir('guideline-pick-local-config-');
  t.after(() => {
    fs.rmSync(p, { recursive: true, force: true });
    fs.rmSync(config, { recursive: true, force: true });
  });
  if (git) runGit(['init', '-q'], p);
  const { manifest } = syncedProject(p, { server: s.base, items, source: FILES, sources });
  if (Object.keys(required).length) {
    for (const [name, keys] of Object.entries(required)) manifest.sources[name].required = keys;
    write(p, MANIFEST, manifestText(manifest));
  }
  if (git) commitAll(p);
  const env = { PATH: '', XDG_CONFIG_HOME: config, GUIDELINE_TOKEN: sources ? '' : token };
  if (sources) saveToken(s.base, { token, name: 'cli-t' }, { env });
  return { s, p, env, store: git ? personalStore({ dir: p, root: p }) : null };
}

/** 폼을 열고 data 를 seen 에 남긴 뒤, submit(본문 또는 data → 본문)이 있으면 제출하고 없으면 취소한다. */
function form(s, seen, submit) {
  return async url => {
    const u = new URL(url);
    const r = await s.req(u.pathname + u.search);
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    seen.data = (await s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json();
    const headers = { 'Content-Type': 'application/json', Origin: s.config.publicUrl.origin, Cookie: cookie };
    const body = typeof submit === 'function' ? submit(seen.data) : submit;
    if (body) seen.submit = await s.req(`${u.pathname}/submit`, { method: 'POST', body: JSON.stringify(body), headers });
    else await s.req(`${u.pathname}/cancel`, { method: 'POST', body: '{}', headers });
  };
}

const quiet = { pollWait: 1, runRuler: () => 0, out: () => {} };
/** 프로젝트 모드 폼의 체크: 그 블록들(접두)의 항목만 켠다. */
const only = (data, ...prefixes) => Object.fromEntries(data.items.map(i => [
  `${i.kind}:${i.id}`, { checked: prefixes.some(x => i.id === x || i.id.startsWith(`${x}/`)), update: false },
]));

test('pick --local 은 개인 선택을 공용 저장소에 쓰고 조합한다', async t => {
  const { s, p, env, store } = await setup(t);
  const before = { manifest: read(p, MANIFEST), lock: read(p, LOCK), gitignore: read(p, '.gitignore') };
  const seen = {};
  const e = collect();
  const o = collect();
  const code = await projectPick({
    project: p, local: true, env, ...quiet, json: true, out: o.out, err: e.out,
    open: form(s, seen, { personalChoices: { 'rules/extra': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  // 폼은 개인 모드로, 프로젝트 선택(가상 키)과 미리 체크 없음(none)을 싣는다
  assert.equal(seen.data.mode, 'personal');
  assert.deepEqual(seen.data.personal, { chosen: ['rules/base'], required: [], add: [], remove: [], preset: 'none', role: null });
  assert.equal(seen.submit.status, 200);
  // 결과는 공용 저장소의 local.json 과 개인 사본으로 — 커밋되는 파일은 그대로다
  assert.deepEqual(readLocal(store), { version: 2, sources: { default: { add: ['rules/extra'], remove: [] } }, roles: {} });
  assert.equal(read(store, '.guideline/rules/extra/00-e.md'), EXTRA['rules/extra/00-e.md']);
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.equal(exists(p, '.guideline/rules/extra'), false);
  assert.deepEqual({ manifest: read(p, MANIFEST), lock: read(p, LOCK), gitignore: read(p, '.gitignore') }, before);
  assert.equal(porcelain(p), '');
  const r = JSON.parse(o.text());
  assert.equal(r.revision, 1);
  assert.ok(r.written.includes('.ruler/extra/00-e.md'));
  // 기본값으로 저장하지 않았으면 머신 기본값은 비어 있다
  assert.deepEqual(readDefaults({ env }).servers, {});
});

test('pick --local 은 저장된 역할별 개인 선택을 지우지 않는다', async t => {
  const { s, p, env, store } = await setup(t);
  const roles = { ui: { sources: { default: { add: ['rules/extra'], remove: [] } } } };
  writeLocal(store, { version: 2, sources: {}, roles });
  const e = collect();
  const code = await projectPick({
    project: p, local: true, env, ...quiet, json: true, out: () => {}, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/extra': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readLocal(store).roles, roles);
});

test('저장된 역할 기본값을 공통 기본값 저장이 지우지 않는다', async t => {
  const { s, p, env } = await setup(t);
  const roles = { ui: { add: ['rules/x'], remove: [] } };
  writeDefaults({ version: 2, servers: { [s.base]: { add: [], remove: [], roles } } }, { env });
  const e = collect();
  const code = await projectPick({
    project: p, local: true, env, ...quiet, json: true, out: () => {}, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/extra': 'add' }, saveDefault: true }),
  });
  assert.equal(code, 0, e.text());
  const saved = readDefaults({ env }).servers[new URL(s.base).origin];
  assert.deepEqual(saved.add, ['rules/extra']);
  assert.deepEqual(saved.roles, roles);
});

test('pick --local 은 개인 선택이 없으면 머신 기본값으로 미리 체크한다', async t => {
  const { s, p, env, store } = await setup(t);
  // 원본에 없는 블록은 고를 수 없으므로 싣지 않는다
  writeDefaults({ version: 1, servers: { [s.base]: { add: ['rules/extra', 'rules/gone'], remove: [] } } }, { env });
  const seen = {};
  assert.equal(await projectPick({ project: p, local: true, env, ...quiet, err: () => {}, open: form(s, seen, null) }), 3);
  assert.equal(seen.data.personal.preset, 'defaults');
  assert.deepEqual(seen.data.personal.add, ['rules/extra']);
  // 취소했으면 아무것도 쓰지 않는다
  assert.equal(exists(store, 'local.json'), false);
  // 이 단위의 개인 선택이 있으면(비어 있어도) 그것이 기본값보다 앞선다
  writeLocal(store, { version: 1, sources: { default: { add: [], remove: [] } } });
  await projectPick({ project: p, local: true, env, ...quiet, err: () => {}, open: form(s, seen, null) });
  assert.equal(seen.data.personal.preset, 'local');
  assert.deepEqual(seen.data.personal.add, []);
});

test('pick --local 의 기본값 저장은 그 서버 origin 에 쓴다', async t => {
  const { s, p, env } = await setup(t);
  // 다른 서버의 기본값은 그대로 남는다
  writeDefaults({ version: 1, servers: { 'https://other.example': { add: ['rules/x'], remove: [] } } }, { env });
  const e = collect();
  const code = await projectPick({
    project: p, local: true, env, ...quiet, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/extra/sub': 'add' }, saveDefault: true }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readDefaults({ env }).servers, {
    [new URL(s.base).origin]: { add: ['rules/extra', 'rules/extra/sub'], remove: [] },
    'https://other.example': { add: ['rules/x'], remove: [] },
  });
});

/** 응답에서 modes 를 뗀 서버(개인 모드를 모르는 서버)처럼 보이게 하는 fetch. */
function noModesFetch() {
  return async (url, init = {}) => {
    const res = await fetch(url, init);
    if (init.method === 'POST' && new URL(url).pathname === '/api/v1/forms') {
      const { modes, ...old } = await res.json();
      return new Response(JSON.stringify(old), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
    return res;
  };
}

test('pick --local 은 개인 모드를 모르는 서버에서 멈춘다', async t => {
  const { s, p, env, store } = await setup(t);
  const e = collect();
  const code = await projectPick({
    project: p, local: true, env, ...quiet, err: e.out, fetchImpl: noModesFetch(), open: () => assert.fail('폼을 열면 안 됨'),
  });
  assert.equal(code, 1);
  assert.match(e.text(), /개인 폼을 모름/);
  // 프로젝트 모드로 뜬 폼은 닫는다(제출되면 프로젝트 선택이 바뀐다)
  assert.equal(s.app.store.db.prepare('SELECT status FROM forms').get().status, 'cancelled');
  assert.equal(exists(store, 'local.json'), false);
  assert.equal(porcelain(p), '');
});

test('pick --local 은 git 이 아닌 단위에서 멈춘다', async t => {
  const { p, env } = await setup(t, { git: false });
  const e = collect();
  assert.equal(await projectPick({ project: p, local: true, env, ...quiet, err: e.out, open: () => assert.fail('폼을 열면 안 됨') }), 2);
  // git 아님과 git 이 너무 옛 버전(--path-format 미지원)은 가를 수 없어 둘 다 말한다
  assert.match(e.text(), /git 저장소가 아니거나 git 이 너무 옛 버전/);
  assert.match(e.text(), /2\.31/);
});

test('pick --local 은 받은 적 없는 프로젝트와 --new 를 거절한다', async t => {
  const { s, env } = await setup(t);
  const empty = tmpDir('guideline-pick-local-empty-');
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  runGit(['init', '-q'], empty);
  const e = collect();
  assert.equal(await projectPick({ project: empty, local: true, env: { ...env, GUIDELINE_SERVER: s.base }, ...quiet, err: e.out, open: () => assert.fail() }), 2);
  assert.match(e.text(), /guideline pick 먼저/);
  const n = collect();
  assert.equal(await projectPick({ newTarget: 'x', local: true, env, ...quiet, err: n.out, open: () => assert.fail() }), 2);
  assert.match(n.text(), /--local 과 --new/);
});

test('pick --local 은 필수와 그 조상을 가상 키로 싣고, 별칭 이름의 결과를 실제 이름으로 쓴다', async t => {
  const { s, p, env, store } = await setup(t, {
    sources: { company: { items: ['rules/base', 'rules/base/sub'], aliases: { 'rules/base': 'company-base', 'rules/extra': 'company-extra' } } },
    required: { company: ['rules/base/sub'] },
  });
  const seen = {};
  const e = collect();
  const code = await projectPick({
    project: p, local: true, env, ...quiet, err: e.out, open: form(s, seen, { personalChoices: { 'rules/company-extra': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(seen.data.personal.chosen, ['rules/company-base', 'rules/company-base/sub']);
  // 필수의 조상도 뺄 수 없다(화면이 잠그고 서버가 거절한다)
  assert.deepEqual(seen.data.personal.required, ['rules/company-base', 'rules/company-base/sub']);
  assert.deepEqual(readLocal(store).sources.company, { add: ['rules/extra'], remove: [] });
  assert.equal(porcelain(p), '');
});

test('pick --local 은 다른 출처가 같은 이름으로 고른 블록을 개인으로 더하지 않고 알린다', async t => {
  // 출처 a 가 rules/base 를, b 는 skills/s 를 프로젝트로 고른다. 두 출처는 같은 원본(별칭 없음)
  const { s, p, env, store } = await setup(t, { sources: { a: { items: ['rules/base'] }, b: { items: ['skills/s'] } } });
  const o = collect();
  const e = collect();
  const code = await projectPick({
    project: p, source: 'b', local: true, env, ...quiet, json: true, out: o.out, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/base': 'add', 'rules/extra': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  // b 의 rules/base 는 a 의 것에 가려져 쓰이지 않는다 — 저장하지 않고 할 일로 알린다
  assert.deepEqual(readLocal(store).sources.b, { add: ['rules/extra'], remove: [] });
  const todo = JSON.parse(o.text()).todos.find(x => x.kind === 'personal-shadowed');
  assert.equal(todo.item, 'b:rules/base');
  assert.match(todo.message, /더하지 않음 — 프로젝트가 출처 a 의 같은 이름 블록\(rules\/base\)/);
  assert.equal(porcelain(p), '');
});

test('pick --local 은 가려진 조상 아래의 더함도 함께 빼고, 뺀 것을 할 일에 적는다', async t => {
  // a 가 rules/base 를 프로젝트로 고른다. b 에서 rules/base/sub 를 개인으로 더하면 화면이 조상 rules/base 도 더한다 —
  // 그 조상은 a 의 것에 가려지고, 그 아래 sub 를 b 사본으로 받으면 a 의 스택 안에 b 의 하위가 섞인다
  const { s, p, env, store } = await setup(t, { sources: { a: { items: ['rules/base'] }, b: { items: ['skills/s'] } } });
  const o = collect();
  const e = collect();
  const code = await projectPick({
    project: p, source: 'b', local: true, env, ...quiet, json: true, out: o.out, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/base/sub': 'add', 'rules/extra': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readLocal(store).sources.b, { add: ['rules/extra'], remove: [] });
  const todos = JSON.parse(o.text()).todos.filter(x => x.kind === 'personal-shadowed');
  assert.deepEqual(todos.map(x => x.item), ['b:rules/base']);
  assert.match(todos[0].message, /b:rules\/base: 더하지 않음 \(아래의 rules\/base\/sub 도 함께\)/);
  // 두 번째 조합(apply)은 같은 할 일을 다시 내지 않는다
  const again = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: again.out, err: () => {}, env }), 0);
  assert.deepEqual(JSON.parse(again.text()).todos.filter(x => x.kind === 'personal-shadowed'), []);
  assert.equal(porcelain(p), '');
});

test('pick --local 은 같은 서버 origin 의 출처들이 저장한 기본값을 합친다', async t => {
  const { s, p, env } = await setup(t, { sources: { a: { items: ['rules/base'] }, b: { items: ['skills/s'] } } });
  const origin = new URL(s.base).origin;
  // 출처 이름 순(a, b)으로 폼이 열린다
  const runs = choices => {
    let i = 0;
    return form(s, {}, () => ({ personalChoices: choices[i++], saveDefault: true }));
  };
  const e = collect();
  let code = await projectPick({
    project: p, local: true, env, ...quiet, err: e.out,
    open: runs([{ 'rules/extra': 'add' }, { 'skills/s': 'remove' }]),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readDefaults({ env }).servers[origin], { add: ['rules/extra'], remove: ['skills/s'] });
  assert.doesNotMatch(e.text(), /기본값/);
  // 같은 블록을 한쪽은 더하고 한쪽은 빼면 이름 순 뒤의 출처를 따르고 한 줄로 알린다
  const w = collect();
  code = await projectPick({
    project: p, local: true, env, ...quiet, err: w.out,
    open: runs([{ 'skills/s': 'add' }, { 'skills/s': 'remove' }]),
  });
  assert.equal(code, 0, w.text());
  assert.deepEqual(readDefaults({ env }).servers[origin], { add: [], remove: ['skills/s'] });
  assert.match(w.text(), new RegExp(`${origin.replace(/[.]/g, '\\.')} 기본값: skills/s 는 출처 a 와 b 가 다르게 골라 b 의 것을 저장`));
});

test('프로젝트 pick 은 필수를 guideline.json 에 쓴다', async t => {
  const { s, p, env } = await setup(t, { items: ['rules/base', 'skills/s'], required: { default: ['skills/s'] } });
  // 폼에는 지금 필수(가상 키)가 실리고, 화면이 보낸 필수가 매니페스트에 들어간다
  const seen = {};
  const e = collect();
  let code = await projectPick({
    project: p, env, ...quiet, err: e.out,
    open: form(s, seen, data => ({ choices: only(data, 'rules/base', 'skills/s'), required: ['rules/base'], force: true })),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(seen.data.required, ['skills/s']);
  assert.deepEqual(readManifest(p).sources.default.required, ['rules/base']);
  // 필수 블록을 풀면 그 필수는 매니페스트에서 빠진다(필수는 items 안에 있어야 한다 — 다시 읽어도 깨지지 않는다)
  code = await projectPick({
    project: p, env, ...quiet, err: e.out,
    open: form(s, seen, data => ({ choices: only(data, 'skills/s'), required: ['rules/base'], force: true })),
  });
  assert.equal(code, 0, e.text());
  const m = readManifest(p);
  assert.deepEqual(m.sources.default.items, ['skills/s']);
  assert.deepEqual(m.sources.default.required, []);
});

test('폼 결과에 필수가 없으면(payload 에 필수가 없는 옛 흐름) 프로젝트 pick 은 매니페스트의 필수를 그대로 둔다', async t => {
  const { s, p, env } = await setup(t, { items: ['rules/base', 'skills/s'], required: { default: ['skills/s'] } });
  // 폼 본문에서 required 를 빼 보낸다 — 서버는 화면이 보낸 required: [] 를 결과에 싣지 않는다
  const stripRequired = async (url, init = {}) => {
    if (init.method === 'POST' && new URL(url).pathname === '/api/v1/forms') {
      const { required, ...body } = JSON.parse(init.body);
      assert.deepEqual(required, ['skills/s'], 'CLI 는 지금 필수를 늘 싣는다');
      return fetch(url, { ...init, body: JSON.stringify(body) });
    }
    return fetch(url, init);
  };
  const e = collect();
  const code = await projectPick({
    project: p, env, ...quiet, err: e.out, fetchImpl: stripRequired,
    open: form(s, {}, data => ({ choices: only(data, 'rules/base', 'skills/s'), required: [], force: true })),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readManifest(p).sources.default.required, ['skills/s']);
  // 그 흐름에서 필수 블록을 풀면, 남겨 둔 필수도 남은 items 안으로 줄인다(안 그러면 다음 읽기에서 매니페스트가 깨진다)
  const again = await projectPick({
    project: p, env, ...quiet, err: e.out, fetchImpl: stripRequired,
    open: form(s, {}, data => ({ choices: only(data, 'rules/base'), required: [], force: true })),
  });
  assert.equal(again, 0, e.text());
  const m = readManifest(p);
  assert.deepEqual(m.sources.default.items, ['rules/base', 'rules/base/sub']);
  assert.deepEqual(m.sources.default.required, []);
});

test('pick --local 으로 개인 선택을 비우면 지난 선택으로 더했던 MCP 서버를 에이전트 설정에서 지운다', async t => {
  const { s, p, env, store } = await setup(t);
  const pick = choices => projectPick({ project: p, local: true, env, ...quiet, err: () => {}, open: form(s, {}, { personalChoices: choices }) });
  assert.equal(await pick({ 'mcp/c7': 'add' }), 0);
  assert.match(read(p, '.ruler/ruler.toml'), /\[mcp_servers\.c7\]/);
  // ruler 가 merge 해 쓴 것처럼(이 테스트의 runRuler 는 아무것도 하지 않는다)
  write(p, '.mcp.json', `${JSON.stringify({ mcpServers: { c7: { command: 'npx' } } }, null, 2)}\n`);
  assert.equal(await pick({}), 0);
  assert.deepEqual(readLocal(store), { version: 2, sources: { default: { add: [], remove: [] } }, roles: {} });
  assert.equal(exists(p, '.mcp.json'), false);
});

// pick --local --role: 역할 겹을 고르는 개인 폼

test('pick --local --role 은 역할 정의에 쓰고 공통은 그대로 둔다', async t => {
  const { s, p, env, store } = await setup(t);
  const common = { default: { add: ['rules/extra'], remove: [] } };
  const doc = { sources: { default: { add: [], remove: ['rules/base'] } } };
  writeLocal(store, { version: 2, sources: common, roles: { doc } });
  const before = { manifest: read(p, MANIFEST), lock: read(p, LOCK), gitignore: read(p, '.gitignore') };
  const seen = {};
  const e = collect();
  const code = await projectPick({
    project: p, local: true, role: 'ui', env, ...quiet, json: true, out: () => {}, err: e.out,
    open: form(s, seen, { personalChoices: { 'rules/extra/sub': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  assert.equal(seen.data.personal.role, 'ui');
  assert.deepEqual(readLocal(store), {
    version: 2, sources: common, roles: { doc, ui: { sources: { default: { add: ['rules/extra/sub'], remove: [] } } } },
  });
  // 이 워크트리의 역할이 ui 가 아니어도 개인 사본은 받는다(다른 워크트리가 쓸 수 있다). 조합은 이 워크트리의 역할(없음)로
  assert.equal(read(store, '.guideline/rules/extra/sub/00-s.md'), EXTRA['rules/extra/sub/00-s.md']);
  assert.equal(exists(p, '.ruler/extra/sub'), false);
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.deepEqual({ manifest: read(p, MANIFEST), lock: read(p, LOCK), gitignore: read(p, '.gitignore') }, before);
  assert.equal(porcelain(p), '');
});

test('이 워크트리의 역할이 다른 역할이어도 pick --local --role 은 그 역할의 사본을 받고, 조합은 이 워크트리의 역할로 한다', async t => {
  const { s, p, env, store } = await setup(t);
  const doc = { sources: { default: { add: ['rules/extra'], remove: [] } } };
  writeLocal(store, { version: 2, sources: {}, roles: { doc } });
  writeRole(p, 'doc');
  const e = collect();
  const code = await projectPick({
    project: p, local: true, role: 'ui', env, ...quiet, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/extra/sub': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readRole(p), { name: 'doc', bad: false });
  // 폼은 하위를 더하면 그 조상도 함께 더해 보낸다
  assert.deepEqual(readLocal(store).roles, { doc, ui: { sources: { default: { add: ['rules/extra', 'rules/extra/sub'], remove: [] } } } });
  // ui 가 더한 하위 스택의 사본은 받는다(ui 워크트리가 쓸 수 있다)
  assert.equal(read(store, '.guideline/rules/extra/sub/00-s.md'), EXTRA['rules/extra/sub/00-s.md']);
  // 조합은 doc: rules/extra 는 받고 ui 만 더한 rules/extra/sub 는 받지 않는다
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.equal(exists(p, '.ruler/extra/sub'), false);
  assert.equal(porcelain(p), '');
});

test('역할 폼의 chosen 은 프로젝트 + 공통 결과다', async t => {
  const { s, p, env, store } = await setup(t, { items: ['rules/base', 'rules/base/sub'] });
  writeLocal(store, { version: 2, sources: { default: { add: ['rules/extra'], remove: ['rules/base/sub'] } }, roles: {} });
  const seen = {};
  assert.equal(await projectPick({ project: p, local: true, role: 'ui', env, ...quiet, err: () => {}, open: form(s, seen, null) }), 3);
  assert.deepEqual(seen.data.personal, { chosen: ['rules/base', 'rules/extra'], required: [], add: [], remove: [], preset: 'none', role: 'ui' });
  // 취소했으면 아무것도 쓰지 않는다
  assert.deepEqual(readLocal(store).roles, {});
});

test('역할 미리 체크는 정의 → 역할 기본값 → 없음 순', async t => {
  const { s, p, env, store } = await setup(t);
  // 공통 기본값·공통 선택은 역할 폼을 미리 체크하지 않는다
  writeDefaults({ version: 2, servers: { [s.base]: { add: ['rules/base/sub'], remove: [], roles: { ui: { add: ['rules/extra', 'rules/gone'], remove: [] } } } } }, { env });
  writeLocal(store, { version: 2, sources: { default: { add: ['rules/base/sub'], remove: [] } }, roles: {} });
  const seen = {};
  const pick = role => projectPick({ project: p, local: true, role, env, ...quiet, err: () => {}, open: form(s, seen, null) });
  assert.equal(await pick('ui'), 3);
  assert.equal(seen.data.personal.preset, 'defaults');
  assert.deepEqual(seen.data.personal.add, ['rules/extra']);
  assert.equal(await pick('doc'), 3);
  assert.equal(seen.data.personal.preset, 'none');
  assert.deepEqual([seen.data.personal.add, seen.data.personal.remove], [[], []]);
  // 그 역할의 정의가 있으면(비어 있어도) 역할 기본값보다 앞선다
  writeLocal(store, { version: 2, sources: {}, roles: { ui: { sources: { default: { add: [], remove: [] } } } } });
  assert.equal(await pick('ui'), 3);
  assert.equal(seen.data.personal.preset, 'local');
  assert.deepEqual(seen.data.personal.add, []);
});

test('역할 기본값 저장은 그 origin 의 roles 에', async t => {
  const { s, p, env, store } = await setup(t);
  const origin = new URL(s.base).origin;
  const doc = { add: [], remove: ['rules/base'] };
  writeDefaults({ version: 2, servers: { [s.base]: { add: ['rules/base/sub'], remove: [], roles: { doc } } } }, { env });
  const e = collect();
  const code = await projectPick({
    project: p, local: true, role: 'ui', env, ...quiet, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/extra/sub': 'add' }, saveDefault: true }),
  });
  assert.equal(code, 0, e.text());
  // 공통 기본값과 다른 역할의 기본값은 그대로
  assert.deepEqual(readDefaults({ env }).servers[origin], {
    add: ['rules/base/sub'], remove: [], roles: { doc, ui: { add: ['rules/extra', 'rules/extra/sub'], remove: [] } },
  });
  assert.deepEqual(readLocal(store).sources, {});
});

test('잘못된 역할 이름은 코드 2', async t => {
  const { p, env, store } = await setup(t);
  for (const role of ['UI', '1x', 'a'.repeat(33), '']) {
    const e = collect();
    assert.equal(await projectPick({ project: p, local: true, role, env, ...quiet, err: e.out, open: () => assert.fail('폼을 열면 안 됨') }), 2, role);
    assert.match(e.text(), /역할 이름은 영소문자로 시작/);
  }
  // --local 없이 --role 은 2
  const n = collect();
  assert.equal(await projectPick({ project: p, role: 'ui', env, ...quiet, err: n.out, open: () => assert.fail('폼을 열면 안 됨') }), 2);
  assert.match(n.text(), /--role 은 --local 과 함께만/);
  assert.equal(exists(store, 'local.json'), false);
});

test('역할 폼이 공통의 자동 조상을 남긴다고 보였으면 결과에도 남고, 역할 정의에는 적지 않는다', async t => {
  // 공통이 하위 스택(rules/extra/sub)만 더했다(손으로 쓴 local.json). 폼은 조상 rules/extra 도 받는다고 보인다. 역할 겹의 기준은
  // 공통 결과 그대로(자동 조상 포함)라 역할이 하위만 빼도 조상은 남고, 역할 정의에는 사람이 고른 것만 적힌다
  const { s, p, env, store } = await setup(t);
  writeLocal(store, { version: 2, sources: { default: { add: ['rules/extra/sub'], remove: [] } }, roles: {} });
  writeRole(p, 'ui');
  const seen = {};
  const e = collect();
  const code = await projectPick({
    project: p, local: true, role: 'ui', env, ...quiet, err: e.out,
    open: form(s, seen, { personalChoices: { 'rules/extra/sub': 'remove' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(seen.data.personal.chosen, ['rules/base', 'rules/extra', 'rules/extra/sub']);
  assert.deepEqual(readLocal(store).roles.ui.sources.default, { add: [], remove: ['rules/extra/sub'] });
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.equal(exists(p, '.ruler/extra/sub'), false);
  assert.equal(porcelain(p), '');
  // 리뷰 반례: 나중에 공통에서 하위 더함을 지우면 역할 워크트리에서도 rules/extra 가 사라진다(역할이 공통을 따라간다)
  const common = await projectPick({
    project: p, local: true, env, ...quiet, err: e.out,
    open: form(s, {}, { personalChoices: {} }),
  });
  assert.equal(common, 0, e.text());
  assert.deepEqual(readLocal(store).sources.default, { add: [], remove: [] });
  assert.deepEqual(readLocal(store).roles.ui.sources.default, { add: [], remove: ['rules/extra/sub'] });
  assert.equal(exists(p, '.ruler/extra'), false);
  assert.equal(porcelain(p), '');
});

test('역할 폼에서 공통의 자동 조상까지 빼면 조상도 빠진다', async t => {
  const { s, p, env, store } = await setup(t);
  writeLocal(store, { version: 2, sources: { default: { add: ['rules/extra/sub'], remove: [] } }, roles: {} });
  writeRole(p, 'ui');
  const e = collect();
  const code = await projectPick({
    project: p, local: true, role: 'ui', env, ...quiet, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/extra': 'remove' } }),
  });
  assert.equal(code, 0, e.text());
  // 폼은 뺀 블록의 자손도 함께 빼서 보낸다
  assert.deepEqual(readLocal(store).roles.ui.sources.default, { add: [], remove: ['rules/extra', 'rules/extra/sub'] });
  assert.equal(exists(p, '.ruler/extra'), false);
  assert.equal(porcelain(p), '');
});

test('pick --local --role 은 다른 출처가 같은 이름으로 고른 블록을 역할에 더하지 않고 알린다', async t => {
  const { s, p, env, store } = await setup(t, { sources: { a: { items: ['rules/base'] }, b: { items: ['skills/s'] } } });
  const o = collect();
  const e = collect();
  const code = await projectPick({
    project: p, source: 'b', local: true, role: 'ui', env, ...quiet, json: true, out: o.out, err: e.out,
    open: form(s, {}, { personalChoices: { 'rules/base/sub': 'add', 'rules/extra': 'add' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readLocal(store).roles.ui.sources.b, { add: ['rules/extra'], remove: [] });
  assert.deepEqual(readLocal(store).sources, {});
  const todos = JSON.parse(o.text()).todos.filter(x => x.kind === 'personal-shadowed');
  assert.deepEqual(todos.map(x => x.item), ['b:rules/base']);
  assert.equal(porcelain(p), '');
});
