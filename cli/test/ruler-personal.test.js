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
import { projectApply } from '../src/commands/project-apply.js';
import { finishPersonal, defaultRunRuler } from '../src/commands/sync-common.js';
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
function pickLocal(p, add, remove) {
  const store = personalStore({ dir: p, root: p });
  const prior = readLocal(store);
  writeLocal(store, { version: 1, sources: { default: { add, remove } } });
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(FILES) }]]);
  const errs = [];
  const r = finishPersonal({
    project: p, manifest: readManifest(p), sync: { trees, revisions: { default: 1 } }, prior, env, runRuler, err: m => errs.push(m),
  });
  assert.equal(r.code, 0, errs.join('\n'));
  return r;
}

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

  // 되돌리면 ruler 가 만든 것은 지운다. .bak 은 ruler 가 사람이 둔 설정을 바꿀 때도 남기는 백업이라 지우지 않고 알린다
  const r = pickLocal(p, [], []);
  assert.equal(read(p, '.gitignore'), gitignore);
  assert.equal(porcelain(p), '?? .mcp.json.bak\n');
  assert.equal(servers(p), null);
  assert.deepEqual(skills(p), []);
  assert.deepEqual(r.todos.filter(x => x.kind === 'ruler-leftover').map(x => x.message), [tr('todo.rulerLeftover', { path: '.mcp.json.bak' })]);
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
const leftovers = r => r.todos.filter(x => x.kind === 'ruler-leftover').map(x => x.message).sort();

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
