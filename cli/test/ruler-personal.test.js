import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir, read, exists, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { syncedProject } from './synced.js';
import { readManifest } from '../src/manifest.js';
import { runGit } from '../src/projects.js';
import { memoryTree } from '../src/tree.js';
import { personalStore, readLocal, writeLocal } from '../src/personal.js';
import { writeRole } from '../src/role.js';
import { projectApply } from '../src/commands/project-apply.js';
import { finishPersonal, defaultRunRuler } from '../src/commands/sync-common.js';
import { role } from '../src/commands/role.js';
import { writePersonal } from '../src/personal-sync.js';
import { t as tr } from '../src/i18n.js';

// 진짜 ruler(이 저장소 devDependency)로 개인 겹이 ruler 출력 종류(MCP·스킬)를 바꿀 때를 본다. 단위 테스트의 runRuler: () => 0 은
// ruler 가 커밋되는 .gitignore 의 자기 블록을 바꾸는 것도, 빠진 MCP·스킬을 지우지 않는 것도 보지 못한다.
// 프로젝트는 임시 git 저장소, 개인 저장소는 그 공용 디렉터리라 이 저장소의 .git 은 건드리지 않는다.

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '.bin');
const FILES = {
  ...SOURCE,
  'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n`,
  'skills/p/SKILL.md': '---\nname: p\ndescription: 개인 스킬\n---\n\n본문\n',
  'mcp/c8/server.json': JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c8'] }),
};
const env = { PATH: BIN };
const runRuler = (bin, cwd) => defaultRunRuler(bin, cwd, { quiet: true });
const porcelain = p => runGit(['status', '--porcelain', '--untracked-files=all'], p).stdout;
const servers = p => (exists(p, '.mcp.json') ? Object.keys(JSON.parse(read(p, '.mcp.json')).mcpServers ?? {}).sort() : null);
const skills = p => (exists(p, '.claude/skills') ? fs.readdirSync(path.join(p, '.claude/skills')).sort() : []);

async function apply(p) {
  const errs = [];
  assert.equal(await projectApply({ dir: p, env, runRuler, out: () => {}, err: m => errs.push(m) }), 0, errs.join('\n'));
  assert.equal(porcelain(p), '', 'apply 뒤 깨끗');
}

/** 프로젝트를 받아 apply(진짜 ruler — .gitignore 에 ruler 블록이 생긴다)하고 커밋한 상태. */
async function project(t, items, { projectToml = null } = {}) {
  const p = fs.realpathSync(tmpDir('guideline-ruler-personal-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  syncedProject(p, { items, source: FILES });
  if (projectToml !== null) fs.writeFileSync(path.join(p, '.ruler', 'ruler.project.toml'), projectToml);
  assert.equal(await projectApply({ dir: p, env, runRuler, out: () => {}, err: () => {} }), 0);
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
  await apply(p);
  return p;
}

/** pick --local 의 마무리를 같은 원본으로: 지난 개인 선택을 읽고 local.json 을 쓰고 개인 사본을 받아 조합하고 진짜 ruler 를 돈다. */
function pickLocal(p, add, remove, files = FILES) {
  const store = personalStore({ dir: p, root: p });
  const prior = readLocal(store);
  writeLocal(store, { version: 1, sources: { default: { add, remove } } });
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(files) }]]);
  const errs = [];
  const r = finishPersonal({
    project: p, manifest: readManifest(p), sync: { trees, revisions: { default: 1 } }, prior, env, runRuler, err: m => errs.push(m),
  });
  assert.equal(r.code, 0, errs.join('\n'));
  return r;
}

const leftovers = r => r.todos.filter(x => x.kind === 'ruler-leftover').map(x => x.message).sort();
const exclude = p => fs.readFileSync(path.join(p, '.git', 'info', 'exclude'), 'utf8');

test('진짜 ruler: 프로젝트의 MCP·스킬을 개인으로 빼면 에이전트 설정에서 빠지고 .gitignore 는 그대로다', async t => {
  const p = await project(t, ['rules/base', 'skills/s', 'mcp/c7']);
  const gitignore = read(p, '.gitignore');
  assert.match(gitignore, /\/\.mcp\.json\n/);
  assert.deepEqual(servers(p), ['c7']);
  assert.deepEqual(skills(p), ['s']);

  const r = pickLocal(p, ['rules/extra'], ['mcp/c7', 'skills/s']);
  assert.deepEqual(r.todos.filter(x => x.kind === 'ruler-apply' || x.kind === 'ruler-leftover'), []);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.equal(porcelain(p), '');
  assert.ok(servers(p) === null || !servers(p).includes('c7'), `.mcp.json: ${servers(p)}`);
  assert.deepEqual(skills(p), []);
  assert.match(read(p, 'CLAUDE.md'), /개인 더함/);

  // 되돌리면 프로젝트 것이 돌아온다
  pickLocal(p, [], []);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.equal(porcelain(p), '');
  assert.deepEqual(servers(p), ['c7']);
  assert.deepEqual(skills(p), ['s']);
  assert.doesNotMatch(read(p, 'CLAUDE.md'), /개인 더함/);
});

test('진짜 ruler: 개인으로만 더한 스킬·MCP 는 info/exclude 로 가리고, 되돌리면 지운다', async t => {
  const p = await project(t, ['rules/base']);
  const gitignore = read(p, '.gitignore');
  assert.equal(servers(p), null);
  assert.deepEqual(skills(p), []);

  pickLocal(p, ['skills/p', 'mcp/c7'], []);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.equal(porcelain(p), '');
  assert.deepEqual(servers(p), ['c7']);
  assert.deepEqual(skills(p), ['p']);
  assert.match(exclude(p), /^\/\.mcp\.json$/m);
  assert.match(exclude(p), /^\/\.claude\/skills$/m);

  // 같은 개인 선택으로 apply 를 다시 돌아도 그대로다(ruler 블록이 다시 바뀌지 않는다)
  await apply(p);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.deepEqual(servers(p), ['c7']);
  // MCP 를 하나 더 더하면 ruler 가 지난 .mcp.json 을 .mcp.json.bak 으로 남긴다 — 그것도 개인 출력이다
  pickLocal(p, ['skills/p', 'mcp/c7', 'mcp/c8'], []);
  assert.deepEqual(servers(p), ['c7', 'c8']);
  assert.equal(exists(p, '.mcp.json.bak'), true);
  assert.equal(porcelain(p), '');
  assert.doesNotMatch(exclude(p), /keeps human backup/, '.mcp.json 이 지난 개인 출력이었으니 .bak 은 그 백업이다');

  // 되돌리면 ruler 가 만든 것은 지운다. .mcp.json 을 지웠으니 그 .bak 도 ruler 출력의 백업이라 함께 지운다
  const r = pickLocal(p, [], []);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.equal(porcelain(p), '');
  assert.equal(servers(p), null);
  assert.equal(exists(p, '.mcp.json.bak'), false);
  assert.deepEqual(skills(p), []);
  assert.deepEqual(r.todos.filter(x => x.kind === 'ruler-leftover'), []);
  assert.doesNotMatch(exclude(p), /guideline personal files/);
  // 다음 apply 도 깨끗하다
  await apply(p);
});

test('진짜 ruler: 개인 MCP 정의가 원본에서 바뀐 뒤(update) 되돌려도 .mcp.json.bak 이 남지 않는다', async t => {
  const p = await project(t, ['rules/base']);
  pickLocal(p, ['mcp/c8'], []);
  const changed = { ...FILES, 'mcp/c8/server.json': JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c8@2'] }) };
  pickLocal(p, ['mcp/c8'], [], changed);
  assert.equal(exists(p, '.mcp.json.bak'), true);
  assert.equal(porcelain(p), '');
  const r = pickLocal(p, [], [], changed);
  assert.equal(porcelain(p), '');
  assert.equal(servers(p), null);
  assert.equal(exists(p, '.mcp.json.bak'), false);
  assert.deepEqual(r.todos.filter(x => x.kind === 'ruler-leftover'), []);
});

test('진짜 ruler: 정리가 빈 .mcp.json 을 지우는 실행에서 그 .bak 도 지운다(설정을 먼저, .bak 을 나중에 본다)', async t => {
  const p = await project(t, ['rules/base']);
  pickLocal(p, ['mcp/c7'], []);
  pickLocal(p, ['mcp/c7', 'mcp/c8'], []);
  assert.equal(exists(p, '.mcp.json.bak'), true);
  // 서버를 손으로 다 지워 두면 조합은 뺄 서버가 없어 .mcp.json 을 그대로 두고, ruler 뒤 정리가 빈 설정으로 지운다
  fs.writeFileSync(path.join(p, '.mcp.json'), '{\n  "mcpServers": {}\n}\n');
  const r = pickLocal(p, [], []);
  assert.equal(exists(p, '.mcp.json'), false);
  assert.equal(exists(p, '.mcp.json.bak'), false);
  assert.equal(porcelain(p), '');
  assert.deepEqual(leftovers(r), []);
});

test('진짜 ruler: 손으로 둔 .mcp.json 에 개인 MCP 를 더했다 되돌리면 그 .mcp.json 과 .bak(사람 원본)은 두고 알린다', async t => {
  const p = await project(t, ['rules/base']);
  const mine = `${JSON.stringify({ mcpServers: { mine: { command: 'mine' } } }, null, 2)}\n`;
  fs.writeFileSync(path.join(p, '.mcp.json'), mine);
  pickLocal(p, ['mcp/c8'], []);
  assert.deepEqual(servers(p), ['c8', 'mine']);
  assert.equal(read(p, '.mcp.json.bak'), mine);

  const r = pickLocal(p, [], []);
  assert.deepEqual(servers(p), ['mine']);
  assert.equal(read(p, '.mcp.json.bak'), mine);
  assert.deepEqual(leftovers(r), [
    tr('todo.rulerLeftover', { path: '.mcp.json' }),
    tr('todo.rulerLeftover', { path: '.mcp.json.bak' }),
  ].sort());
});

test('진짜 ruler: 손으로 둔 .mcp.json 의 서버가 개인 MCP 와 같은 이름뿐이어도 되돌릴 때 .bak(사람 원본)은 두고 알린다', async t => {
  const p = await project(t, ['rules/base']);
  // 사람 정의(키가 든 args 등)가 같은 이름의 개인 MCP 정의로 덮여 .bak 에만 남는다
  const mine = `${JSON.stringify({ mcpServers: { c8: { command: 'mine', args: ['--key', 'secret'] } } }, null, 2)}\n`;
  fs.writeFileSync(path.join(p, '.mcp.json'), mine);
  pickLocal(p, ['mcp/c8'], []);
  assert.deepEqual(servers(p), ['c8']);
  assert.equal(read(p, '.mcp.json.bak'), mine);
  assert.equal(porcelain(p), '');
  const mark = /^# guideline keeps human backup \/\.mcp\.json\.bak$/m;
  assert.match(exclude(p), mark);
  // 같은 선택으로 다시 돌아도 사람 원본이라는 표시는 남는다
  await apply(p);
  assert.match(exclude(p), mark);

  // 조합이 이름 c8 을 지워 .mcp.json 은 사라지지만, .bak 은 이 .mcp.json 이 개인 출력이 되기 전부터 있던 사람 파일의 원본이다
  const r = pickLocal(p, [], []);
  assert.equal(servers(p), null);
  assert.equal(read(p, '.mcp.json.bak'), mine);
  assert.deepEqual(leftovers(r), [tr('todo.rulerLeftover', { path: '.mcp.json.bak' })]);
  assert.equal(porcelain(p), '?? .mcp.json.bak\n');
  assert.doesNotMatch(exclude(p), /guideline personal files/);
});

test('진짜 ruler: 개인 더함을 되돌릴 때 사람이 둔 스킬은 지우지 않고 할 일로 알린다', async t => {
  const p = await project(t, ['rules/base']);
  pickLocal(p, ['skills/p'], []);
  fs.mkdirSync(path.join(p, '.claude/skills/mine'));
  fs.writeFileSync(path.join(p, '.claude/skills/mine/SKILL.md'), '# 내 것\n');
  const r = pickLocal(p, [], []);
  assert.deepEqual(skills(p), ['mine']);
  assert.deepEqual(r.todos.filter(x => x.kind === 'ruler-leftover').map(x => x.message), [tr('todo.rulerLeftover', { path: '.claude/skills' })]);
});

test('진짜 ruler: 개인 선택이 없으면 프로젝트에서 뺀 MCP 를 지우지 않는다(지금 동작)', async t => {
  const p = await project(t, ['rules/base', 'mcp/c7']);
  assert.deepEqual(servers(p), ['c7']);
  // 프로젝트가 c7 을 뺀 것처럼 매니페스트·사본을 바꾼다
  const m = readManifest(p);
  m.sources.default.items = ['rules/base'];
  fs.writeFileSync(path.join(p, 'guideline.json'), `${JSON.stringify(m, null, 2)}\n`);
  fs.rmSync(path.join(p, '.guideline', 'mcp'), { recursive: true, force: true });
  const errs = [];
  assert.equal(await projectApply({ dir: p, env, runRuler, out: () => {}, err: m2 => errs.push(m2) }), 0, errs.join('\n'));
  assert.deepEqual(servers(p), ['c7']);
});

// ruler.project.toml 로 claude·codex·opencode 밖 에이전트(cursor)를 켠 프로젝트. guideline 은 cursor 의 MCP 자리를 모른다
const WITH_CURSOR = 'default_agents = ["claude", "cursor"]\nnested = false\n\n[gitignore]\nenabled = true\n';
const cursorServers = p => Object.keys(JSON.parse(read(p, '.cursor/mcp.json')).mcpServers ?? {}).sort();

test('진짜 ruler: 개인 MCP 더함을 되돌릴 때 다른 에이전트의 설정(손으로 둔 것)과 그 .bak 은 지우지 않고 알린다', async t => {
  const p = await project(t, ['rules/base'], { projectToml: WITH_CURSOR });
  fs.mkdirSync(path.join(p, '.cursor'));
  const mine = `${JSON.stringify({ mcpServers: { mine: { command: 'mine' } } }, null, 2)}\n`;
  fs.writeFileSync(path.join(p, '.cursor/mcp.json'), mine);

  pickLocal(p, ['mcp/c7'], []);
  assert.deepEqual(cursorServers(p), ['c7', 'mine']);
  assert.equal(read(p, '.cursor/mcp.json.bak'), mine);

  const r = pickLocal(p, [], []);
  assert.deepEqual(cursorServers(p), ['c7', 'mine']);
  assert.equal(read(p, '.cursor/mcp.json.bak'), mine);
  assert.equal(servers(p), null);
  assert.deepEqual(leftovers(r), [
    tr('todo.rulerLeftover', { path: '.cursor/mcp.json' }),
    tr('todo.rulerLeftover', { path: '.cursor/mcp.json.bak' }),
    tr('todo.rulerMcpOther', { agents: 'cursor', servers: 'c7' }),
  ].sort());
});

test('진짜 ruler: 개인으로 뺀 MCP 가 MCP 자리를 모르는 에이전트 설정에 남으면 한 번 알린다', async t => {
  const p = await project(t, ['rules/base', 'mcp/c7'], { projectToml: WITH_CURSOR });
  const gitignore = read(p, '.gitignore');
  assert.deepEqual(cursorServers(p), ['c7']);

  const r = pickLocal(p, [], ['mcp/c7']);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.equal(porcelain(p), '');
  assert.equal(servers(p), null);
  assert.deepEqual(cursorServers(p), ['c7']);
  assert.deepEqual(leftovers(r), [tr('todo.rulerMcpOther', { agents: 'cursor', servers: 'c7' })]);
  // 다음 실행에는 지난 ruler.toml 에도 c7 이 없어 다시 알리지 않는다
  const again = pickLocal(p, [], ['mcp/c7']);
  assert.deepEqual(leftovers(again), []);
});

test('진짜 ruler: 개인 선택을 비운 작업자도 프로젝트에서 뺀 MCP 를 지우지 않는다(local.json 이 없는 팀원과 같다)', async t => {
  const p = await project(t, ['rules/base', 'mcp/c7']);
  pickLocal(p, [], []);
  assert.equal(exists(p, path.join(path.relative(p, personalStore({ dir: p, root: p })), 'local.json')), true);
  const m = readManifest(p);
  m.sources.default.items = ['rules/base'];
  fs.writeFileSync(path.join(p, 'guideline.json'), `${JSON.stringify(m, null, 2)}\n`);
  fs.rmSync(path.join(p, '.guideline', 'mcp'), { recursive: true, force: true });
  const errs = [];
  assert.equal(await projectApply({ dir: p, env, runRuler, out: () => {}, err: m2 => errs.push(m2) }), 0, errs.join('\n'));
  assert.deepEqual(servers(p), ['c7']);
});

test('진짜 ruler: 프로젝트 MCP 위에 개인으로 더한 MCP 를 pick --local 로 비우면 지운다(지난 개인 선택)', async t => {
  const p = await project(t, ['rules/base', 'mcp/c7']);
  pickLocal(p, ['mcp/c8'], []);
  assert.deepEqual(servers(p), ['c7', 'c8']);
  // 개인 출력이 프로젝트 블록에 다 들어 있어 이 워크트리 단위 블록이 없다 — 지난 개인 선택만이 되돌림을 알려 준다
  assert.doesNotMatch(exclude(p), /guideline personal files/);
  pickLocal(p, [], []);
  assert.deepEqual(servers(p), ['c7']);
  assert.equal(porcelain(p), '');
});

test('진짜 ruler: local.json 을 손으로 비우고 apply 해도 개인으로 더했던 스킬을 지운다(이 워크트리 단위 블록)', async t => {
  const p = await project(t, ['rules/base']);
  pickLocal(p, ['skills/p'], []);
  assert.deepEqual(skills(p), ['p']);
  writeLocal(personalStore({ dir: p, root: p }), { version: 1, sources: {} });
  const out = [];
  assert.equal(await projectApply({ dir: p, env, runRuler, json: true, out: m => out.push(m), err: () => {} }), 0);
  assert.deepEqual(skills(p), []);
  assert.equal(porcelain(p), '');
  assert.doesNotMatch(out.join('\n'), /ruler-leftover/);
});

test('진짜 ruler: 역할만 MCP 를 더해도 커밋되는 .gitignore 는 그대로고 info/exclude 가 가린다', async t => {
  const p = await project(t, ['rules/base']);
  const gitignore = read(p, '.gitignore');
  assert.equal(servers(p), null);
  const store = personalStore({ dir: p, root: p });
  writeLocal(store, { version: 2, sources: {}, roles: { ui: { sources: { default: { add: ['mcp/c7', 'skills/p'], remove: [] } } } } });
  writeRole(p, 'ui');
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(FILES) }]]);
  const errs = [];
  const r = finishPersonal({ project: p, manifest: readManifest(p), sync: { trees, revisions: { default: 1 } }, env, runRuler, err: m => errs.push(m) });
  assert.equal(r.code, 0, errs.join('\n'));
  assert.deepEqual(r.todos.filter(x => x.kind === 'ruler-apply' || x.kind === 'ruler-leftover'), []);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.equal(porcelain(p), '');
  assert.deepEqual(servers(p), ['c7']);
  assert.deepEqual(skills(p), ['p']);
  assert.match(exclude(p), /^\/\.mcp\.json$/m);
  // 같은 역할로 apply 를 다시 돌아도 그대로
  await apply(p);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.deepEqual(servers(p), ['c7']);
});

/** guideline role use 를 진짜 ruler 로. */
async function roleUse(p, name) {
  const errs = [];
  const opts = name === null ? { action: 'use', none: true } : { action: 'use', name };
  assert.equal(await role({ ...opts, cwd: p, env, runRuler, out: () => {}, err: m => errs.push(m) }), 0, errs.join('\n'));
  assert.equal(porcelain(p), '', 'role use 뒤 깨끗');
}

test('진짜 ruler: role use 로 역할을 바꾸면 지난 역할만 더했던 MCP·스킬을 지운다', async t => {
  const p = await project(t, ['rules/base']);
  const gitignore = read(p, '.gitignore');
  const store = personalStore({ dir: p, root: p });
  writeLocal(store, {
    version: 2, sources: {}, roles: { a: { sources: { default: { add: ['mcp/c8', 'skills/p'], remove: [] } } }, b: { sources: {} } },
  });
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(FILES) }]]);
  writePersonal({ personal: { store, local: readLocal(store) }, manifest: readManifest(p), trees, revisions: { default: 1 } });
  await roleUse(p, 'a');
  assert.deepEqual(servers(p), ['c8']);
  assert.deepEqual(skills(p), ['p']);
  await roleUse(p, 'b');
  assert.equal(servers(p), null);
  assert.deepEqual(skills(p), []);
  assert.equal(read(p, '.gitignore'), gitignore);
});

test('진짜 ruler: 프로젝트 MCP 위에 역할로 더한 MCP 를 role use 로 다른 역할·역할 없음으로 바꾸면 지운다(지난 역할)', async t => {
  const p = await project(t, ['rules/base', 'mcp/c7']);
  const gitignore = read(p, '.gitignore');
  const store = personalStore({ dir: p, root: p });
  writeLocal(store, { version: 2, sources: {}, roles: { a: { sources: { default: { add: ['mcp/c8'], remove: [] } } }, b: { sources: {} } } });
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(FILES) }]]);
  writePersonal({ personal: { store, local: readLocal(store) }, manifest: readManifest(p), trees, revisions: { default: 1 } });
  for (const next of ['b', null]) {
    await roleUse(p, 'a');
    assert.deepEqual(servers(p), ['c7', 'c8']);
    // 개인 출력이 프로젝트 블록에 다 들어 있어 이 워크트리 단위 블록이 없다 — 지난 역할만이 되돌림을 알려 준다
    assert.doesNotMatch(exclude(p), /guideline personal files/);
    await roleUse(p, next);
    assert.deepEqual(servers(p), ['c7'], String(next));
  }
  assert.equal(read(p, '.gitignore'), gitignore);
});
