import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, testConfig, META } from '../../server/test/helpers.js';
import { tmpDir, write, collect, ALWAYS } from './helpers.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { SOURCE } from './render-fixture.js';
import { syncedProject } from './synced.js';
import { MANIFEST, manifestText, readManifest } from '../src/manifest.js';
import { projectStatus } from '../src/commands/project-status.js';
import { projectApply } from '../src/commands/project-apply.js';
import { personalStore, writeLocal } from '../src/personal.js';
import { writeRole } from '../src/role.js';
import { runGit } from '../src/projects.js';

async function setup(t, opts) {
  const s = await startApp(t, opts);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = fs.realpathSync(tmpDir('guideline-status-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  syncedProject(p, { server: s.base, items: ['rules/base', 'skills/s'] });
  return { s, p, env: { GUIDELINE_TOKEN: token } };
}

test('매니페스트가 없으면 안내하고 0', async t => {
  const p = tmpDir('guideline-status-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  fs.mkdirSync(path.join(p, '.ruler'));
  const o = collect();
  assert.equal(await projectStatus({ project: p, env: {}, out: o.out }), 0);
  assert.match(o.text(), /아직 이 방식으로 받지 않음: guideline pick/);
});

test('status --json 은 원본 새로 나옴·프로젝트에서 고침을 내고, 고른 스택에 새로 생긴 파일은 원본 새로 나옴이다', async t => {
  const { s, p, env } = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새\n`, 'rules/base/02-new.md': `${ALWAYS}# 새\n` } });
  write(p, '.guideline/rules/base/01-b.md', '# 고침\n');
  const o = collect();
  assert.equal(await projectStatus({ project: p, json: true, env, out: o.out }), 0);
  const data = JSON.parse(o.text());
  assert.equal(data.revision, 1);
  assert.equal(data.head, 2);
  assert.deepEqual(data.items, [
    { id: 'rules/base/00-a.md', state: 'upstream' },
    { id: 'rules/base/01-b.md', state: 'local' },
    { id: 'rules/base/02-new.md', state: 'upstream' },
    { id: 'rules/base/SETUP.md', state: 'current' },
    { id: 'skills/s', state: 'current' },
  ]);
  assert.equal('newFiles' in data, false);
  // 사본을 고치고 조합하지 않았으니 생성물이 낡았다. 고친 사본은 frontmatter 가 없어 조합에서 막힌다 — 조합 할 일도 status 에 나온다
  assert.deepEqual(data.todos.map(x => x.kind), ['apply', 'blocked']);
  assert.equal(data.todos[1].item, 'rules/base/01-b.md');
});

test('status 는 새 파일 줄을 내지 않는다', async t => {
  const { s, p, env } = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/base/02-new.md': `${ALWAYS}# 새\n` } });
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, out: o.out }), 0);
  assert.doesNotMatch(o.text(), /고른 스택에 새로 생긴 파일|New files/);
  assert.match(o.text(), /^ {2}원본 새로 나옴 {2}rules\/base\/02-new\.md$/m);
});

test('고른 스택에서 원본이 뺀 파일은 status 가 원본 새로 나옴으로 보이고 할 일은 없다', async t => {
  const { s, p, env } = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/base/01-b.md': null } });
  const o = collect();
  assert.equal(await projectStatus({ project: p, json: true, env, out: o.out }), 0);
  const data = JSON.parse(o.text());
  assert.deepEqual(data.items.find(i => i.id === 'rules/base/01-b.md'), { id: 'rules/base/01-b.md', state: 'upstream' });
  assert.deepEqual(data.todos, []);
});

test('status 글 출력', async t => {
  const { p, env } = await setup(t);
  write(p, '.guideline/rules/base/01-b.md', '# 고침\n');
  const o = collect();
  await projectStatus({ project: p, env, out: o.out });
  assert.match(o.text(), new RegExp(`^지침 상태 — ${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(반영 r1, 서버 최신 r1\\)$`, 'm'));
  assert.match(o.text(), /^ {2}최신 3 · 프로젝트에서 고침 1$/m);
  assert.match(o.text(), /^ {2}프로젝트에서 고침 {2}rules\/base\/01-b\.md$/m);
});

test('비공개 서버에 토큰이 없으면 1, 공개 서버는 토큰 없이 된다', async t => {
  const { p } = await setup(t, { config: testConfig({ publicRead: false }) });
  const e = collect();
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(await projectStatus({ project: p, env: {}, home, err: e.out, out: () => {} }), 1);
  assert.match(e.text(), /로그인 필요/);
  const open = await setup(t);
  const o = collect();
  assert.equal(await projectStatus({ project: open.p, env: {}, home, out: o.out }), 0);
  assert.match(o.text(), /^지침 상태/m);
  assert.ok(path.isAbsolute(p));
});

test('status 는 서버가 본 토큰 이름·범위를 보이고(--json 은 token), 토큰이 없으면 아무것도 추가하지 않는다', async t => {
  const { s, p, env } = await setup(t);
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, out: o.out }), 0);
  assert.match(o.text(), /^ {2}토큰: cli-t — 범위 read$/m);
  const j = collect();
  await projectStatus({ project: p, env, json: true, out: j.out });
  assert.deepEqual(JSON.parse(j.text()).token, { name: 'cli-t', scope: 'read' });
  const admin = { GUIDELINE_TOKEN: s.tokens.issue({ name: 'cli-a', scope: 'admin' }).token };
  const a = collect();
  await projectStatus({ project: p, env: admin, json: true, out: a.out });
  assert.deepEqual(JSON.parse(a.text()).token, { name: 'cli-a', scope: 'admin' });
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const none = collect();
  assert.equal(await projectStatus({ project: p, env: {}, home, out: none.out }), 0);
  assert.doesNotMatch(none.text(), /토큰:/);
  const noneJson = collect();
  await projectStatus({ project: p, env: {}, home, json: true, out: noneJson.out });
  assert.equal(JSON.parse(noneJson.text()).token, null);
});

test('status 는 whoami 가 없는 옛 서버(404)에서도 실패하지 않고 token 은 null', async t => {
  const { p, env } = await setup(t);
  const old = (url, init) => (String(url).endsWith('/api/v1/whoami')
    ? Promise.resolve(new Response(JSON.stringify({ error: '페이지 없음' }), { status: 404 }))
    : fetch(url, init));
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: o.out, fetchImpl: old }), 0);
  assert.equal(JSON.parse(o.text()).token, null);
  const text = collect();
  assert.equal(await projectStatus({ project: p, env, out: text.out, fetchImpl: old }), 0);
  assert.doesNotMatch(text.text(), /토큰:/);
});

/** 받은 프로젝트(git 루트, 항목은 rules/base 하나). */
async function setupNew(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = fs.realpathSync(tmpDir('guideline-status-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  syncedProject(p, { server: s.base });
  return { s, p, env: { GUIDELINE_TOKEN: token } };
}

test('status 는 생성물이 낡았으면 apply 할 일을 낸다', async t => {
  const { p, env } = await setupNew(t);
  const fresh = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: fresh.out, err: () => {} }), 0);
  assert.equal(JSON.parse(fresh.text()).todos.some(x => x.kind === 'apply'), false);

  // 사본을 고쳤는데 조합하지 않았다
  write(p, '.guideline/rules/base/00-a.md', `${ALWAYS}# 에이\n\n고침\n`);
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: o.out, err: () => {} }), 0);
  const todo = JSON.parse(o.text()).todos.find(x => x.kind === 'apply');
  assert.equal(todo.message, '생성물이 낡음 — guideline apply 실행');

  // 서버 없이도 이 판정은 한다
  const m = JSON.parse(fs.readFileSync(path.join(p, MANIFEST), 'utf8'));
  m.sources.default.server = 'http://127.0.0.1:9';
  write(p, MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
  const off = collect();
  assert.equal(await projectStatus({ project: p, env, out: off.out, err: () => {} }), 1);
  assert.match(off.text(), /할 일\n {2}- 생성물이 낡음 — guideline apply 실행/);
});

test('사본이 최신 원본과 같으면(제안이 수락된 뒤) status 는 둘 다 바뀜이 아니라 원본 새로 나옴이다', async t => {
  const { s, p, env } = await setupNew(t);
  const accepted = `${ALWAYS}# 에이\n\n수락된 본문\n`;
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': accepted } });
  // 새 배치의 사본은 원본 바이트 그대로라 수락된 원본과 같다
  write(p, '.guideline/rules/base/00-a.md', accepted);
  const o = collect();
  assert.equal(await projectStatus({ project: p, json: true, env, out: o.out, err: () => {} }), 0);
  assert.equal(JSON.parse(o.text()).items.find(x => x.id === 'rules/base/00-a.md').state, 'upstream');
});

test('status 는 prepare 가 ruler apply 만 부르는 동안 dev-dependency 할 일을 계속 내고, 고칠 수 있는 prepare 는 apply 할 일로 본다', async t => {
  const { p, env } = await setupNew(t);
  const pkg = deps => `{\n  "scripts": {\n    "prepare": "ruler apply"\n  }${deps ? ',\n  "devDependencies": { "guideline-manage": "1" }' : ''}\n}\n`;
  write(p, 'package.json', pkg(false));
  write(p, 'pnpm-lock.yaml', '');
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: o.out, err: () => {} }), 0);
  const todos = JSON.parse(o.text()).todos;
  assert.deepEqual(todos.map(x => x.kind), ['dev-dependency']);
  assert.match(todos[0].message, /pnpm add -D guideline-manage .* 그 전까지 클론의 prepare 는 ruler 만 돌아 지침 없는 AGENTS\.md 를 만듦$/);
  // 의존성이 생기면 apply 가 prepare 를 고칠 수 있다 — 낡은 것으로 본다(status 는 쓰지 않는다)
  write(p, 'package.json', pkg(true));
  const o2 = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: o2.out, err: () => {} }), 0);
  assert.deepEqual(JSON.parse(o2.text()).todos.map(x => x.kind), ['apply']);
  assert.equal(fs.readFileSync(path.join(p, 'package.json'), 'utf8'), pkg(true));
});

test('status 는 조합 할 일(고르지 않은 스택의 바꿈 등)을 apply·update 없이도 낸다', async t => {
  const { p, env } = await setupNew(t);
  write(p, '.guideline/overrides/gone/override.md', '## 바꿈\n');
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: o.out, err: () => {} }), 0);
  const todos = JSON.parse(o.text()).todos;
  assert.deepEqual(todos.map(x => x.kind), ['override-unchosen']);
  assert.match(todos[0].message, /^\.guideline\/overrides\/gone\/: 고르지 않은 스택이라 바꿈을 조합하지 않음/);
});

test('status 는 개인 겹이 있어도 apply 할 일을 거짓으로 내지 않는다', async t => {
  const { p, env } = await setup(t);
  runGit(['init', '-q'], p);
  // 개인으로 하나 더하고(skills/s 는 프로젝트가 고른 것) 하나 뺀다
  const store = personalStore({ dir: p, root: p });
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: ['skills/s'] } } });
  write(store, '.guideline/rules/extra/00-e.md', `${ALWAYS}# 개인 더함\n`);
  const kinds = async () => {
    const o = collect();
    assert.equal(await projectStatus({ project: p, json: true, env, out: o.out }), 0);
    return JSON.parse(o.text()).todos.map(x => x.kind);
  };
  // 개인 선택을 아직 조합하지 않았으면 apply 할 일
  assert.ok((await kinds()).includes('apply'));
  assert.equal(await projectApply({ dir: p, json: true, out: () => {}, err: () => {}, env: { PATH: '' } }), 0);
  assert.ok(fs.existsSync(path.join(p, '.ruler/extra/00-e.md')));
  assert.equal((await kinds()).includes('apply'), false);
  // info/exclude 의 단위 블록이 지워졌으면 다시 apply 할 일
  fs.writeFileSync(path.join(p, '.git/info/exclude'), '');
  assert.ok((await kinds()).includes('apply'));
});

test('status 는 개인 더함·뺌과 개인 사본 상태를 보인다', async t => {
  const { s, p, env } = await setup(t);
  // git 저장소가 아니면 개인 범위가 없다
  const none = collect();
  assert.equal(await projectStatus({ project: p, json: true, env, out: none.out }), 0);
  assert.equal(JSON.parse(none.text()).personal, null);

  runGit(['init', '-q'], p);
  s.store.commit({ ...META, changes: { 'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n` } });
  const m = readManifest(p);
  write(p, MANIFEST, manifestText({ ...m, sources: { default: { ...m.sources.default, required: ['rules/base'] } } }));
  const store = personalStore({ dir: p, root: p });
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: ['skills/s', 'rules/base', 'mcp/c7'] } } });
  assert.equal(await projectUpdate({ project: p, env, json: true, out: () => {}, err: () => {}, runRuler: () => 0 }), 0);
  // mcp/c7 은 프로젝트가 고르지 않아 뺄 것이 없다 — 그것은 필수라 무시된 뺌이 아니다
  // 개인 사본을 받은 뒤 원본이 바뀌었다
  s.store.commit({ ...META, changes: { 'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n\n새\n` } });

  const o = collect();
  assert.equal(await projectStatus({ project: p, json: true, env, out: o.out }), 0);
  const data = JSON.parse(o.text());
  assert.deepEqual(data.personal, {
    added: ['rules/extra'],
    removed: ['skills/s'],
    ignored: ['rules/base'],
    shadowed: [],
    items: [{ id: 'rules/extra/00-e.md', state: 'upstream' }],
    role: null,
  });
  const ignored = data.todos.filter(x => x.kind === 'personal-ignored');
  assert.deepEqual(ignored.map(x => x.item), ['rules/base']);

  const text = collect();
  await projectStatus({ project: p, env, out: text.out });
  assert.match(text.text(), /^ {2}개인 범위 — 더함 1: rules\/extra$/m);
  assert.match(text.text(), /^ {2}개인 범위 — 뺌 1: skills\/s$/m);
  assert.match(text.text(), /^ {2}원본 새로 나옴 {2}rules\/extra\/00-e\.md \(개인 사본\)$/m);
  assert.match(text.text(), /- rules\/base: 필수가 된 블록이라 개인 뺌을 무시함/);
});

test('status --json 의 personal.role 과 겹별 줄', async t => {
  const { s, p, env } = await setup(t);
  runGit(['init', '-q'], p);
  s.store.commit({ ...META, changes: { 'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n` } });
  const m = readManifest(p);
  write(p, MANIFEST, manifestText({ ...m, sources: { default: { ...m.sources.default, required: ['rules/base'] } } }));
  const store = personalStore({ dir: p, root: p });
  // 공통 겹은 skills/s 를 빼고, 역할 ui 는 rules/extra 를 더하고 필수 rules/base 를 빼려 한다
  writeLocal(store, {
    version: 2,
    sources: { default: { add: [], remove: ['skills/s'] } },
    roles: { ui: { sources: { default: { add: ['rules/extra'], remove: ['rules/base'] } } } },
  });
  writeRole(p, 'ui');
  assert.equal(await projectUpdate({ project: p, env, json: true, out: () => {}, err: () => {}, runRuler: () => 0 }), 0);
  assert.ok(fs.existsSync(path.join(p, '.ruler/extra/00-e.md')));

  const o = collect();
  assert.equal(await projectStatus({ project: p, json: true, env, out: o.out }), 0);
  const data = JSON.parse(o.text());
  assert.deepEqual(data.personal, {
    added: [],
    removed: ['skills/s'],
    ignored: [],
    shadowed: [],
    items: [{ id: 'rules/extra/00-e.md', state: 'current' }],
    role: { name: 'ui', defined: true, added: ['rules/extra'], removed: [], ignored: ['rules/base'] },
  });
  assert.equal(data.todos.some(x => x.kind === 'apply'), false, JSON.stringify(data.todos));
  assert.deepEqual(data.todos.filter(x => x.kind === 'personal-ignored').map(x => x.item), ['rules/base']);

  const text = collect();
  await projectStatus({ project: p, env, out: text.out });
  assert.match(text.text(), /^ {2}역할 — ui$/m);
  assert.match(text.text(), /^ {2}개인 범위 — 더함 0: -$/m);
  assert.match(text.text(), /^ {2}개인 범위 — 뺌 1: skills\/s$/m);
  assert.match(text.text(), /^ {2}역할 ui — 더함 1: rules\/extra$/m);
  assert.match(text.text(), /^ {2}역할 ui — 뺌 0: -$/m);
});

test('status 는 guideline.json 의 agents 와 ruler.project.toml 의 default_agents 가 다르면 서버 없이도 agents-mismatch 할 일을 낸다', async t => {
  const todosOf = async opts => {
    const p = fs.realpathSync(tmpDir('guideline-status-agents-'));
    t.after(() => fs.rmSync(p, { recursive: true, force: true }));
    // 닿지 않는 서버: 받기에 실패해도 로컬 할 일은 나온다
    syncedProject(p, { server: 'http://127.0.0.1:9', ...opts });
    const o = collect();
    assert.equal(await projectStatus({ project: p, env: {}, json: true, out: o.out, err: () => {} }), 1);
    // 로컬 할 일이 없으면 아무것도 쓰지 않는다
    return o.text() ? JSON.parse(o.text()).todos : [];
  };
  const differ = (await todosOf({ agents: ['claude', 'codex'], toml: 'default_agents = ["claude"]\nnested = false\n' }))
    .filter(x => x.kind === 'agents-mismatch');
  assert.equal(differ.length, 1);
  assert.equal(differ[0].item, null);
  assert.match(differ[0].message, /claude, codex/);
  assert.match(differ[0].message, /guideline agents add\|remove/);
  const same = await todosOf({ agents: ['codex', 'claude'], toml: 'default_agents = ["claude", "codex"]\nnested = false\n' });
  assert.equal(same.some(x => x.kind === 'agents-mismatch'), false);
  const none = await todosOf({ agents: ['claude', 'codex'], toml: null });
  assert.equal(none.some(x => x.kind === 'agents-mismatch'), false);
});
