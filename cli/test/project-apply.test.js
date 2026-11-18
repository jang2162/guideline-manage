import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, write, read, exists, collect } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { memoryTree } from '../src/tree.js';
import { render } from '../src/render/index.js';
import { applyFiles } from '../src/apply.js';
import { diskReader } from '../src/project-state.js';
import { virtualize, toRealLock } from '../src/workspace.js';
import { MANIFEST, LOCK, manifestText, lockText, checkManifest } from '../src/manifest.js';
import { RULER_TOML_BASE } from '../src/render/outputs.js';
import { PROJECT_TOML, RULER_TOML } from '../src/layout.js';
import { readBlock } from '../src/gitignore-block.js';
import { runGit } from '../src/projects.js';
import { projectApply } from '../src/commands/project-apply.js';
import { mergeTodos, writeComposedOrFail } from '../src/commands/sync-common.js';
import { projectStatus } from '../src/commands/project-status.js';
import { writeExclude, readExclude } from '../src/exclude.js';
import { personalStore, writeLocal, worktreeId, MAIN_WORKTREE } from '../src/personal.js';

const ITEMS = ['rules/base', 'skills/s', 'agents/rev.md', 'mcp/c7', 'mcp/gl', 'mcp/b'];

function gitDir(t, files = {}) {
  const p = fs.realpathSync(tmpDir('guideline-apply-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  for (const [k, v] of Object.entries(files)) write(p, k, v);
  runGit(['init', '-q'], p);
  return p;
}

/** 서버 없이 새 배치 동기화를 흉내 낸다: .guideline/ 사본, 매니페스트, 잠금 v3, ruler.project.toml. 생성물은 아직 없다. */
function syncNew(p, { items = ITEMS, source = SOURCE, toml = RULER_TOML_BASE(['claude']) } = {}) {
  fs.mkdirSync(path.join(p, '.ruler'), { recursive: true });
  const manifest = checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://x', items, aliases: {} } } });
  const trees = new Map([['default', { server: 'http://x', revision: 4, tree: memoryTree(source) }]]);
  const v = virtualize({ manifest, lock: null, trees });
  const r = render({ tree: v.tree, revision: 0, manifest: v.view, lock: null, project: diskReader(p), management: v.management, layout: 'guideline' });
  applyFiles(p, r.files);
  const lock = toRealLock({ viewLock: r.lock, sources: v.sources, revisions: { default: 4 } });
  write(p, MANIFEST, manifestText(manifest));
  write(p, LOCK, lockText(lock));
  if (toml !== null) write(p, PROJECT_TOML, toml);
  return { manifest, lock };
}

/** fetch 를 부르면 테스트가 실패하게 한다. */
function noFetch(t) {
  const real = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('apply 가 서버를 불렀다');
  };
  t.after(() => {
    globalThis.fetch = real;
  });
}

const rulerCalls = () => {
  const calls = [];
  const run = (bin, cwd) => {
    calls.push({ bin, cwd });
    return 0;
  };
  run.calls = calls;
  return run;
};
/** findRuler 가 찾게 하는 env. */
const withRuler = p => {
  write(p, 'bin/ruler', '#!/bin/sh\n');
  fs.chmodSync(path.join(p, 'bin/ruler'), 0o755);
  return { PATH: path.join(p, 'bin') };
};

test('apply 는 서버 없이 .guideline 에서 생성물을 만들고 ruler 를 돈다', async t => {
  noFetch(t);
  const p = gitDir(t);
  syncNew(p);
  const runRuler = rulerCalls();
  const o = collect();
  const code = await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: withRuler(p), runRuler });
  assert.equal(code, 0);
  assert.equal(runRuler.calls.length, 1);
  assert.equal(runRuler.calls[0].cwd, p);
  assert.equal(read(p, RULER_TOML).startsWith(RULER_TOML_BASE(['claude'])), true, read(p, RULER_TOML));
  assert.match(read(p, RULER_TOML), /\[mcp_servers\.c7\]/);
  assert.equal(read(p, '.ruler/base/00-a.md'), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  assert.ok(exists(p, 'docs/guideline/base/01-b.md'));
  assert.ok(exists(p, '.ruler/skills/s/img/a.png'));
  assert.ok(readBlock(read(p, '.gitignore')).includes('/.ruler/ruler.toml'));
  const r = JSON.parse(o.text());
  assert.equal(r.revision, 4);
  assert.ok(r.written.includes(RULER_TOML));
  // 사본이 없는 build MCP 는 할 일 없이 빠지지 않는다. 서브에이전트는 새 배치 문구로.
  assert.deepEqual(r.todos.filter(x => x.kind === 'no-copy').map(x => x.item), ['mcp/b']);
  const sub = r.todos.find(x => x.kind === 'subagents-off');
  assert.match(sub.message, /\.guideline\/ 에 사본은 있지만 \.ruler\/ruler\.project\.toml/);
  assert.equal(r.todos.filter(x => x.kind === 'env').length, 1);
  // 두 번째는 바뀐 것이 없어도 ruler 를 돈다(ruler apply 를 대신한다)
  const again = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: again.out, err: () => {}, env: withRuler(p), runRuler }), 0);
  assert.deepEqual(JSON.parse(again.text()).written, []);
  assert.equal(runRuler.calls.length, 2);
});

test('apply 는 ruler 가 없으면 ruler-apply 할 일을 내고 0', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  const o = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: { PATH: '' }, runRuler: () => assert.fail('부르면 안 됨') }), 0);
  assert.deepEqual(JSON.parse(o.text()).todos.map(x => x.kind), ['ruler-apply']);
});

test('apply 는 이전 배치 프로젝트에서 update 를 하라고 멈춘다', async t => {
  noFetch(t);
  const p = gitDir(t, {
    '.ruler/ruler.toml': 'default_agents = ["claude"]\n',
    '.ruler/base/00-a.md': '# 에이\n',
    [MANIFEST]: manifestText(checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://x', items: ['rules/base'], aliases: {} } } })),
    [LOCK]: lockText({ version: 2, revisions: { default: 1 }, sources: {}, outputs: [] }),
  });
  const e = collect();
  assert.equal(await projectApply({ dir: p, out: () => {}, err: e.out, runRuler: () => assert.fail('부르면 안 됨') }), 2);
  assert.match(e.text(), /아직 예전 배치 — guideline update 를 한 번 실행\(서버 필요\)해 \.guideline\/ 으로 옮기기/);
  assert.equal(exists(p, '.gitignore'), false);
  // 받은 적 없는 프로젝트는 update.notYet 과 같은 코드 2
  const q = gitDir(t, { '.ruler/ruler.toml': '' });
  const e2 = collect();
  assert.equal(await projectApply({ dir: q, out: () => {}, err: e2.out }), 2);
  assert.match(e2.text(), /guideline pick 먼저/);
  // 매니페스트는 있지만 잠금도 사본도 없는 프로젝트(layout none)도 같다
  const r = gitDir(t, {
    '.ruler/ruler.toml': '',
    [MANIFEST]: manifestText(checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://x', items: ['rules/base'], aliases: {} } } })),
  });
  const e3 = collect();
  assert.equal(await projectApply({ dir: r, out: () => {}, err: e3.out, runRuler: () => assert.fail('부르면 안 됨') }), 2);
  assert.match(e3.text(), /guideline pick 먼저/);
  assert.equal(exists(r, '.gitignore'), false);
});

// claude 가 에이전트가 아닌 설정: ruler 는 CLAUDE.md 를 만들지 않으므로 있던 CLAUDE.md 는 떠돌이다
const CODEX_ONLY = RULER_TOML_BASE(['codex']);

test('apply 는 ruler 가 남긴 CLAUDE.md 를 지운다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'], toml: CODEX_ONLY });
  write(p, 'CLAUDE.md', '<!-- Generated by Ruler -->\n\n<!-- Source: .ruler/AGENTS.md -->\n\n본문\n');
  const o = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.equal(exists(p, 'CLAUDE.md'), false);
  const r = JSON.parse(o.text());
  assert.ok(r.deleted.includes('CLAUDE.md'));
  assert.equal(r.todos.filter(x => x.kind === 'stray-ruler-output').length, 1);
  assert.match(r.todos.find(x => x.kind === 'stray-ruler-output').message, /^CLAUDE\.md: 지움/);

  // Source 줄만 있어도 ruler 생성물이다
  const q = gitDir(t);
  syncNew(q, { items: ['rules/base'], toml: CODEX_ONLY });
  write(q, 'CLAUDE.md', '# 머리\n<!-- Source: .ruler/base/00-a.md -->\n본문\n');
  assert.equal(await projectApply({ dir: q, out: () => {}, err: () => {}, env: { PATH: '' } }), 0);
  assert.equal(exists(q, 'CLAUDE.md'), false);
});

test('apply 는 표시 없는 CLAUDE.md 를 두고 알리며, ruler.toml 이 있었으면 보지 않는다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'], toml: CODEX_ONLY });
  write(p, 'CLAUDE.md', '# 손으로 쓴 지침\n');
  const o = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.equal(read(p, 'CLAUDE.md'), '# 손으로 쓴 지침\n');
  const todo = JSON.parse(o.text()).todos.find(x => x.kind === 'stray-ruler-output');
  assert.match(todo.message, /ruler 표시가 없어 그대로 둠/);

  // 이번엔 ruler.toml 이 이미 있다(조합이 끝난 프로젝트): 표시가 있어도 ruler 가 제대로 만든 것이다
  const q = gitDir(t);
  syncNew(q, { items: ['rules/base'], toml: CODEX_ONLY });
  assert.equal(await projectApply({ dir: q, out: () => {}, err: () => {}, env: { PATH: '' } }), 0);
  write(q, 'CLAUDE.md', '<!-- Generated by Ruler -->\n본문\n');
  const o2 = collect();
  assert.equal(await projectApply({ dir: q, json: true, out: o2.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.ok(exists(q, 'CLAUDE.md'));
  assert.equal(JSON.parse(o2.text()).todos.some(x => x.kind === 'stray-ruler-output'), false);
});

test('apply 는 ruler 가 claude 몫으로 CLAUDE.md 를 다시 만드는 설정이면 떠돌이로 보지 않고, output_path 를 바꿨으면 떠돌이로 본다', async t => {
  const MARKED = '<!-- Generated by Ruler -->\n본문\n';
  const run = async toml => {
    const p = gitDir(t);
    syncNew(p, { items: ['rules/base'], toml });
    write(p, 'CLAUDE.md', MARKED);
    const o = collect();
    assert.equal(await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
    return { kept: exists(p, 'CLAUDE.md'), todos: JSON.parse(o.text()).todos.filter(x => x.kind === 'stray-ruler-output') };
  };
  // default_agents 에 claude(기본 출력 CLAUDE.md)
  assert.deepEqual(await run(RULER_TOML_BASE(['claude', 'codex'])), { kept: true, todos: [] });
  // default_agents 가 없으면 ruler 는 모든 에이전트로 돈다
  assert.deepEqual(await run('nested = false\n'), { kept: true, todos: [] });
  // 이 저장소처럼 claude 의 출력 자리를 AGENTS.md 로 옮겼으면 CLAUDE.md 는 다시 생기지 않는다
  const moved = await run(`${RULER_TOML_BASE(['claude', 'codex'])}\n[agents.claude]\noutput_path = "AGENTS.md"\n`);
  assert.equal(moved.kept, false);
  assert.equal(moved.todos.length, 1);
  // [agents.claude] enabled = false 는 default_agents 보다 앞선다
  assert.equal((await run(`${RULER_TOML_BASE(['claude'])}\n[agents.claude]\nenabled = false\n`)).kept, false);
});

test('apply 는 중첩 단위에서 그 단위만 조합하고, 루트에 ruler.toml 이 없으면 ruler 를 돌지 않고 알린다', async t => {
  const root = gitDir(t, { [PROJECT_TOML]: 'default_agents = ["claude"]\nnested = false\n', 'root.txt': '루트\n' });
  const sub = path.join(root, 'packages', 'api');
  syncNew(sub, { items: ['rules/base', 'skills/s'], toml: null });
  const runRuler = rulerCalls();
  const o = collect();
  assert.equal(await projectApply({ dir: sub, json: true, out: o.out, err: () => {}, env: withRuler(root), runRuler }), 0);
  // 클론 직후처럼 루트에 조합한 ruler.toml 이 없다 — 설정 없이 ruler 를 돌면 모든 에이전트 몫이 생긴다
  assert.deepEqual(runRuler.calls, []);
  const r = JSON.parse(o.text());
  const rootTodo = r.todos.find(x => x.kind === 'root-apply');
  assert.match(rootTodo.message, /git 루트에서 먼저 guideline apply 를 돌리거나\(또는 거기에 nested = true 인 \.ruler\/ruler\.toml 을 직접 두고\) 여기서 다시 실행/);
  assert.ok(rootTodo.message.includes(root));
  assert.equal(r.todos.some(x => x.kind === 'ruler-apply'), false);
  // 쓴 것은 모두 단위 안(단위 기준 경로), 루트 전용 항목(스킬)은 조합하지 않는다
  assert.ok(exists(sub, '.ruler/base/00-a.md'));
  assert.equal(exists(sub, '.ruler/skills/s/SKILL.md'), false);
  assert.ok(r.written.every(x => exists(sub, x)), r.written.join(', '));
  assert.equal(exists(root, '.ruler/base'), false);
  assert.equal(exists(root, '.gitignore'), false);
  assert.equal(exists(root, RULER_TOML), false);
  assert.ok(exists(sub, '.gitignore'));
  // ruler.project.toml 이 없는 중첩 단위는 중첩 기본 설정
  assert.equal(read(sub, RULER_TOML), 'default_agents = ["claude"]\n');
  // 루트 설정에 nested = true 가 없으면 ruler.project.toml 을 가리켜 알린다
  const nested = r.todos.find(x => x.kind === 'nested-off');
  assert.match(nested.message, /의 \.ruler\/ruler\.project\.toml 에서 nested = true 켜기/);
  assert.equal(read(root, 'root.txt'), '루트\n');

  // 루트를 먼저 조합해 ruler.toml 이 생기면 루트에서 한 번 돈다
  write(root, RULER_TOML, 'default_agents = ["claude"]\nnested = true\n');
  const o2 = collect();
  assert.equal(await projectApply({ dir: sub, json: true, out: o2.out, err: () => {}, env: withRuler(root), runRuler }), 0);
  assert.deepEqual(runRuler.calls.map(c => c.cwd), [root]);
  assert.equal(JSON.parse(o2.text()).todos.some(x => x.kind === 'root-apply'), false);
});

test('apply 는 고른 스택의 바꿈만 옮기고 고르지 않은 스택의 바꿈은 알린다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  write(p, '.guideline/overrides/base/override.md', '## 바꿈\n');
  write(p, `.guideline/overrides/gone/override.d/a.md`, '## 안 고른 바꿈\n');
  const o = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.equal(read(p, '.ruler/base/override.md'), '## 바꿈\n');
  assert.equal(exists(p, '.ruler/gone'), false);
  const todos = JSON.parse(o.text()).todos.filter(x => x.kind === 'override-unchosen');
  assert.deepEqual(todos.map(x => x.message), ['.guideline/overrides/gone/: 고르지 않은 스택이라 바꿈을 조합하지 않음 — 스택을 고르거나 바꿈을 지우기']);
});

test('apply 글 출력: 쓴 파일과 할 일', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  const o = collect();
  assert.equal(await projectApply({ dir: p, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.match(o.text(), /반영 완료\(r4\)/);
  assert.match(o.text(), /쓰기 {2}\.ruler\/ruler\.toml/);
  assert.match(o.text(), /할 일\n {2}- ruler 를 찾을 수 없음/);
});

test('mergeTodos: 같은 할 일은 한 번, 동기화가 이유를 낸 항목(그 안 파일 포함)의 no-copy 는 뺀다', () => {
  const sync = [
    { kind: 'env', item: 'mcp/gl', message: 'e' },
    { kind: 'blocked', item: 'rules/web/00-a.md', message: 'b' },
    { kind: 'mcp-build', item: 'mcp/b', message: 'm' },
  ];
  const composed = [
    { kind: 'env', item: 'mcp/gl', message: 'e' },
    { kind: 'no-copy', item: 'rules/web', message: 'n1' },
    { kind: 'no-copy', item: 'mcp/b', message: 'n2' },
    { kind: 'no-copy', item: 'rules/webx', message: 'n3' },
    { kind: 'mcp-conflict', item: 'mcp/c7', message: 'c' },
  ];
  assert.deepEqual(mergeTodos(sync, composed).map(x => x.message), ['e', 'b', 'm', 'n3', 'c']);
});

test('apply 는 사본 폴더에 frontmatter 없는 파일이 있어도 죽지 않고 막힘 할 일을 낸다', async t => {
  noFetch(t);
  const p = gitDir(t);
  syncNew(p);
  write(p, '.guideline/rules/base/07-x.md', '# 프로젝트가 둔 파일\n');
  const o = collect();
  const code = await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: withRuler(p), runRuler: rulerCalls() });
  assert.equal(code, 0);
  const r = JSON.parse(o.text());
  assert.deepEqual(r.todos.filter(x => x.kind === 'blocked').map(x => x.item), ['rules/base/07-x.md']);
  assert.ok(exists(p, '.ruler/base/00-a.md'));
  assert.equal(exists(p, '.ruler/base/07-x.md'), false);
});

test('apply 는 default_agents 가 여러 줄이라 판정할 수 없으면 CLAUDE.md 를 두고 알린다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'], toml: 'default_agents = [\n  "codex",\n]\nnested = false\n' });
  write(p, 'CLAUDE.md', '<!-- Generated by Ruler -->\n본문\n');
  const o = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.ok(exists(p, 'CLAUDE.md'));
  const todos = JSON.parse(o.text()).todos.filter(x => x.kind === 'stray-ruler-output');
  assert.equal(todos.length, 1);
  assert.match(todos[0].message, /^CLAUDE\.md: .* default_agents 가 여러 줄이라 ruler 가 이 파일을 쓰는지 판정하지 못해 그대로 둠/);
  // [agents.claude] enabled 가 있으면 그것으로 판정한다(여러 줄이어도)
  const q = gitDir(t);
  syncNew(q, { items: ['rules/base'], toml: 'default_agents = [\n  "codex",\n]\n\n[agents.claude]\nenabled = false\n' });
  write(q, 'CLAUDE.md', '<!-- Generated by Ruler -->\n본문\n');
  assert.equal(await projectApply({ dir: q, out: () => {}, err: () => {}, env: { PATH: '' } }), 0);
  assert.equal(exists(q, 'CLAUDE.md'), false);
});

const commitAll = p => {
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
};

/** 커밋된 저장소를 클론한다(생성물 없이 커밋된 것만). */
function cloneOf(t, p) {
  const c = `${p}-clone`;
  t.after(() => fs.rmSync(c, { recursive: true, force: true }));
  runGit(['clone', '-q', p, c], path.dirname(p));
  return c;
}

const NESTED_ROOT_TOML = 'default_agents = ["claude"]\nnested = true\n\n[gitignore]\nenabled = true\n';

test('클론 뒤 루트 apply 한 번으로 하위 단위까지 조합하고 ruler 는 루트에서 한 번 돈다', async t => {
  const root = gitDir(t);
  syncNew(root, { items: ['rules/base'], toml: NESTED_ROOT_TOML });
  syncNew(path.join(root, 'packages/api'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  // 옛 배치 단위는 건너뛰고 그 단위에서 update 하라고 알린다
  write(root, 'packages/old/.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  write(root, 'packages/old/.ruler/base/00-a.md', '# 에이\n');
  write(root, `packages/old/${MANIFEST}`, manifestText(checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://x', items: ['rules/base'], aliases: {} } } })));
  write(root, `packages/old/${LOCK}`, lockText({ version: 2, revisions: { default: 1 }, sources: {}, outputs: [] }));
  commitAll(root);
  const c = cloneOf(t, root);
  assert.equal(exists(c, 'packages/api/.ruler/base/00-a.md'), false);

  const seen = [];
  const runRuler = (bin, cwd) => {
    // ruler 가 돌 때 하위 단위의 생성물이 이미 있어야 nested 로 그 AGENTS.md 가 채워진다
    seen.push({ cwd, sub: exists(cwd, 'packages/api/.ruler/base/00-a.md') && exists(cwd, 'packages/api/.ruler/ruler.toml') });
    return 0;
  };
  const o = collect();
  assert.equal(await projectApply({ dir: c, json: true, out: o.out, err: () => {}, env: withRuler(c), runRuler }), 0);
  assert.deepEqual(seen, [{ cwd: c, sub: true }]);
  const r = JSON.parse(o.text());
  assert.ok(r.written.includes('.ruler/base/00-a.md'));
  assert.ok(r.written.includes('packages/api/.ruler/base/00-a.md'));
  assert.ok(r.written.includes('packages/api/.gitignore'));
  assert.equal(read(c, 'packages/api/.ruler/ruler.toml'), 'default_agents = ["claude"]\n');
  // 단위의 할 일은 단위 경로를 앞에 붙인다. 루트 nested 가 켜져 있으니 nested-off 는 없다
  const old = r.todos.find(x => x.kind === 'unit-update');
  assert.equal(old.message, 'packages/old: 아직 예전 배치라 조합하지 않음 — 거기서 guideline update 를 한 번 실행(서버 필요)');
  assert.equal(exists(c, 'packages/old/.gitignore'), false);
  assert.ok(r.todos.filter(x => x.unit === 'packages/api').every(x => x.message.startsWith('packages/api: ')));
  assert.equal(r.todos.some(x => x.kind === 'nested-off'), false);
  // 두 번째는 쓸 것이 없다
  const again = collect();
  assert.equal(await projectApply({ dir: c, json: true, out: again.out, err: () => {}, env: withRuler(c), runRuler }), 0);
  assert.deepEqual(JSON.parse(again.text()).written, []);

  // 루트 nested 가 꺼져 있으면 하위 단위가 ruler 에 잡히지 않는다고 알린다
  const q = gitDir(t);
  syncNew(q, { items: ['rules/base'] });
  syncNew(path.join(q, 'sub'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  commitAll(q);
  const o2 = collect();
  assert.equal(await projectApply({ dir: cloneOf(t, q), json: true, out: o2.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.equal(JSON.parse(o2.text()).todos.filter(x => x.kind === 'nested-off').length, 1);
});

test('루트가 guideline 프로젝트가 아닌 모노레포에서도 루트 apply 가 하위 단위를 조합하고 루트의 ruler 설정으로 돈다', async t => {
  // 루트는 프로젝트가 둔 ruler 설정만 있다(guideline.json 없음)
  const root = gitDir(t, { [RULER_TOML]: NESTED_ROOT_TOML, '.ruler/AGENTS.md': '# 루트\n' });
  syncNew(path.join(root, 'apps/web'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  commitAll(root);
  const c = cloneOf(t, root);
  const runRuler = rulerCalls();
  const o = collect();
  assert.equal(await projectApply({ dir: c, json: true, out: o.out, err: () => {}, env: withRuler(c), runRuler }), 0);
  assert.deepEqual(runRuler.calls.map(x => x.cwd), [c]);
  const r = JSON.parse(o.text());
  assert.deepEqual(r.revision, { 'apps/web': 4 });
  assert.ok(r.written.includes('apps/web/.ruler/base/00-a.md'));
  // 루트에는 아무것도 쓰지 않는다
  assert.equal(read(c, RULER_TOML), NESTED_ROOT_TOML);
  assert.equal(exists(c, '.gitignore'), false);

  // 루트에 ruler.toml 이 없으면 조합만 하고 ruler 는 돌지 않는다 — 루트에서 apply 하라는 말 대신 설정을 두라고
  const q = gitDir(t, { 'README.md': '루트\n' });
  syncNew(path.join(q, 'apps/web'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  commitAll(q);
  const qc = cloneOf(t, q);
  const o2 = collect();
  assert.equal(await projectApply({ dir: qc, json: true, out: o2.out, err: () => {}, env: withRuler(qc), runRuler: () => assert.fail('부르면 안 됨') }), 0);
  assert.ok(exists(qc, 'apps/web/.ruler/base/00-a.md'));
  const todos = JSON.parse(o2.text()).todos;
  assert.equal(todos.some(x => x.kind === 'root-apply'), false);
  assert.match(todos.find(x => x.kind === 'root-ruler-toml').message, /는 guideline 프로젝트가 아니고 \.ruler\/ruler\.toml 도 없으며/);

  // 하위 단위가 없으면 지금처럼 받은 적 없다고 2
  const none = gitDir(t, { [RULER_TOML]: NESTED_ROOT_TOML });
  commitAll(none);
  const e = collect();
  assert.equal(await projectApply({ dir: none, out: () => {}, err: e.out }), 2);
  assert.match(e.text(), /guideline pick 먼저/);
});

test('N1 비-guideline 루트에 설정이 없으면 nested-off 대신 root-ruler-toml 만', async t => {
  const q = gitDir(t, { 'README.md': '루트\n' });
  syncNew(path.join(q, 'apps/web'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  commitAll(q);
  const o = collect();
  assert.equal(await projectApply({ dir: cloneOf(t, q), json: true, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
  assert.deepEqual(JSON.parse(o.text()).todos.filter(x => x.kind.startsWith('root-') || x.kind === 'nested-off').map(x => x.kind), ['root-ruler-toml']);

  // ruler.toml 이 있으면 nested 판정은 그것만 읽는다 — ruler 는 ruler.project.toml 을 읽지 않는다(이 루트는 guideline 이 조합하지 않는다)
  const r = gitDir(t, { [RULER_TOML]: 'default_agents = ["claude"]\nnested = false\n', [PROJECT_TOML]: NESTED_ROOT_TOML });
  syncNew(path.join(r, 'apps/web'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  commitAll(r);
  const rc = cloneOf(t, r);
  const o2 = collect();
  assert.equal(await projectApply({ dir: rc, json: true, out: o2.out, err: () => {}, env: { PATH: '' } }), 0);
  const off = JSON.parse(o2.text()).todos.filter(x => x.kind === 'nested-off');
  assert.equal(off.length, 1);
  assert.match(off[0].message, /의 \.ruler\/ruler\.toml 에서 nested = true 켜기/);
});

test('N3 하위 단위 쓰기 실패는 단위 경로와 할 일을 낸다', async t => {
  const root = gitDir(t, { [RULER_TOML]: NESTED_ROOT_TOML });
  syncNew(path.join(root, 'apps/web'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  syncNew(path.join(root, 'apps/ok'), { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  commitAll(root);
  const c = cloneOf(t, root);
  // 스택 폴더 자리에 파일이 있으면 그 단위의 생성물을 쓸 수 없다
  write(c, 'apps/web/.ruler/base', '막음\n');
  const o = collect();
  const e = collect();
  assert.equal(await projectApply({ dir: c, json: true, out: o.out, err: e.out, env: { PATH: '' } }), 1);
  assert.match(e.text(), /^apps\/web: 쓰기 실패: /m);
  const r = JSON.parse(o.text());
  const failed = r.todos.filter(x => x.kind === 'unit-write-failed');
  assert.deepEqual(failed.map(x => x.unit), ['apps/web']);
  assert.match(failed[0].message, /^apps\/web: 생성물을 다 쓰지 못함 — 이번 ruler 결과에서 이 단위의 AGENTS\.md 등을 믿지 말고/);
  // 다른 단위는 그대로 조합한다
  assert.ok(exists(c, 'apps/ok/.ruler/base/00-a.md'));
});

// ── 개인 겹 (실제 git 저장소: 이 저장소 자신의 .git 은 건드리지 않는다) ──

const EXTRA_COPY = { 'rules/extra/00-e.md': `---\nload: always\n---\n# 개인 더함\n` };

/** 단위의 개인 선택과 개인 사본(<store>/.guideline/)을 둔다. */
function setPersonal(dir, root, sources, copies = EXTRA_COPY) {
  const store = personalStore({ dir, root });
  writeLocal(store, { version: 1, sources });
  for (const [k, v] of Object.entries(copies)) write(store, `.guideline/${k}`, v);
  return store;
}
const porcelain = p => runGit(['status', '--porcelain', '--untracked-files=all'], p).stdout;
const excludeText = p => {
  try {
    return fs.readFileSync(path.join(p, '.git', 'info', 'exclude'), 'utf8');
  } catch {
    return '';
  }
};
const apply = async p => {
  const o = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: o.out, err: () => {}, env: { PATH: '' } }), 0);
  return JSON.parse(o.text());
};

test('개인 더함은 .gitignore 를 바꾸지 않고 info/exclude 에 간다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  await apply(p);
  commitAll(p);
  const gi = read(p, '.gitignore');
  assert.equal(porcelain(p), '');

  setPersonal(p, p, { default: { add: ['rules/extra'], remove: [] } });
  const r = await apply(p);
  assert.ok(r.written.includes('.ruler/extra/00-e.md'));
  assert.equal(read(p, '.ruler/extra/00-e.md'), '# 개인 더함\n');
  assert.equal(read(p, '.gitignore'), gi);
  assert.ok(excludeText(p).includes('# START guideline personal files . @.\n/.ruler/extra/00-e.md\n# END guideline personal files . @.\n'), excludeText(p));
  // 커밋되는 파일이 하나도 바뀌지 않고, 개인 생성물도 git 에 보이지 않는다
  assert.equal(porcelain(p), '');
  assert.match(read(p, '.ruler/guideline.md'), /더한 것: `rules\/extra`/);
});

test('개인 선택을 되돌리면 생성물과 exclude 블록이 따라온다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  write(p, '.git/info/exclude', '# 사용자 줄\n*.log\n');
  await apply(p);
  commitAll(p);
  const gi = read(p, '.gitignore');

  // 더했다가 되돌린다
  setPersonal(p, p, { default: { add: ['rules/extra'], remove: [] } });
  await apply(p);
  assert.ok(exists(p, '.ruler/extra/00-e.md'));
  setPersonal(p, p, {});
  const back = await apply(p);
  assert.ok(back.deleted.includes('.ruler/extra/00-e.md'));
  assert.equal(exists(p, '.ruler/extra/00-e.md'), false);
  assert.equal(excludeText(p), '# 사용자 줄\n*.log\n');
  assert.equal(read(p, '.gitignore'), gi);
  assert.equal(porcelain(p), '');

  // 뺐다가 되돌린다: 생성물은 지워졌다 돌아오고 .gitignore 는 내내 같다
  setPersonal(p, p, { default: { add: [], remove: ['rules/base'] } });
  const removed = await apply(p);
  assert.ok(removed.deleted.includes('.ruler/base/00-a.md'));
  assert.equal(exists(p, '.ruler/base/00-a.md'), false);
  assert.equal(read(p, '.gitignore'), gi);
  assert.equal(porcelain(p), '');
  setPersonal(p, p, {});
  await apply(p);
  assert.equal(read(p, '.ruler/base/00-a.md'), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  assert.equal(excludeText(p), '# 사용자 줄\n*.log\n');
  assert.equal(porcelain(p), '');
});

test('루트 apply 는 하위 단위의 개인 겹도 조합하고 exclude 패턴은 워크트리 루트 기준이다', async t => {
  const root = gitDir(t);
  syncNew(root, { items: ['rules/base'], toml: NESTED_ROOT_TOML });
  const api = path.join(root, 'packages/api');
  syncNew(api, { items: ['rules/base'], toml: 'default_agents = ["claude"]\n' });
  // 루트 apply 는 git 이 추적하는 하위 단위만 찾는다
  commitAll(root);
  await apply(root);
  commitAll(root);
  assert.ok(exists(api, '.ruler/base/00-a.md'));
  setPersonal(api, root, { default: { add: ['rules/extra'], remove: [] } });
  const r = await apply(root);
  assert.ok(r.written.includes('packages/api/.ruler/extra/00-e.md'));
  assert.equal(exists(root, '.ruler/extra/00-e.md'), false);
  assert.ok(excludeText(root).includes('# START guideline personal files packages/api @.\n/packages/api/.ruler/extra/00-e.md\n# END guideline personal files packages/api @.\n'));
  assert.equal(porcelain(root), '');
  // 단위에서 직접 apply 해도 같은 블록이다
  const before = excludeText(root);
  await apply(api);
  assert.equal(excludeText(root), before);
});

test('git 저장소가 아니면 개인 겹 없이 조합하고 exclude 를 쓰지 않는다, 개인 선택이 깨졌으면 알린다', async t => {
  const p = fs.realpathSync(tmpDir('guideline-apply-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  syncNew(p, { items: ['rules/base'] });
  const r = await apply(p);
  assert.ok(r.written.includes('.ruler/base/00-a.md'));
  assert.equal(r.todos.some(x => x.kind === 'local-bad'), false);

  const q = gitDir(t);
  syncNew(q, { items: ['rules/base'] });
  const store = setPersonal(q, q, { default: { add: ['rules/extra'], remove: [] } });
  await apply(q);
  write(store, 'local.json', '{ 깨짐');
  const broken = await apply(q);
  const bad = broken.todos.find(x => x.kind === 'local-bad');
  assert.match(bad.message, /local\.json 을\(를\) 읽을 수 없다 .* 그동안 개인 선택 없이 프로젝트 선택만으로 조합함$/);
  // 개인 생성물과 exclude 블록은 그대로 둔다
  assert.ok(exists(q, '.ruler/extra/00-e.md'));
  assert.match(excludeText(q), /\/\.ruler\/extra\/00-e\.md/);
});

/** 실제 git 워크트리를 하나 더 만든다(새 브랜치). */
function addWorktree(t, p, name) {
  const wt = `${p}-${name}`;
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  assert.equal(runGit(['worktree', 'add', '-q', '-b', name.replace(/ /g, '-'), wt], p).status, 0);
  return wt;
}
/** status 의 할 일 종류. 서버에는 닿지 않게 해 조합에서 나오는 할 일만 본다. */
const statusKinds = async p => {
  const o = collect();
  await projectStatus({ project: p, json: true, out: o.out, err: () => {}, env: {}, fetchImpl: () => Promise.reject(new Error('off')) });
  return o.text() ? JSON.parse(o.text()).todos.map(x => x.kind) : [];
};
const EXTRA_SOURCE = { ...SOURCE, 'rules/extra/00-e.md': EXTRA_COPY['rules/extra/00-e.md'] };

test('워크트리마다 info/exclude 블록이 따로라 한쪽의 apply 가 다른 쪽 개인 생성물을 드러내지 않는다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  await apply(p);
  commitAll(p);
  // 기능 브랜치 워크트리에서는 프로젝트가 extra 를 고른다(개인 스택을 팀으로 올리는 흐름)
  const wt = addWorktree(t, p, 'feat');
  syncNew(wt, { items: ['rules/base', 'rules/extra'], source: EXTRA_SOURCE });
  await apply(wt);
  commitAll(wt);
  // 개인 선택은 같은 클론의 워크트리가 함께 쓴다: 메인에서는 개인 더함, 기능 브랜치에서는 이미 고른 것
  setPersonal(p, p, { default: { add: ['rules/extra'], remove: [] } });
  for (const order of [[p, wt], [wt, p]]) {
    for (const d of order) await apply(d);
    assert.equal(porcelain(p), '', `메인: ${excludeText(p)}`);
    assert.equal(porcelain(wt), '', `기능: ${excludeText(p)}`);
    assert.equal((await statusKinds(p)).includes('apply'), false);
    assert.equal((await statusKinds(wt)).includes('apply'), false);
  }
  assert.ok(exists(p, '.ruler/extra/00-e.md'));
  assert.ok(excludeText(p).includes('# START guideline personal files . @.\n/.ruler/extra/00-e.md\n# END guideline personal files . @.\n'), excludeText(p));
  // 기능 브랜치의 블록은 비어 있어 쓰지 않는다
  assert.equal(excludeText(p).includes('@feat'), false, excludeText(p));
});

test('없어진 워크트리의 info/exclude 블록은 다음 쓰기에서 지운다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  await apply(p);
  commitAll(p);
  const wt = addWorktree(t, p, 'gone wt');
  setPersonal(p, p, { default: { add: ['rules/extra'], remove: [] } });
  await apply(wt);
  const id = worktreeId(wt, path.join(p, '.git'));
  assert.notEqual(id, MAIN_WORKTREE);
  assert.ok(excludeText(p).includes(`# START guideline personal files . @${id}\n/.ruler/extra/00-e.md\n`), excludeText(p));
  assert.equal(runGit(['worktree', 'remove', '--force', wt], p).status, 0);
  await apply(p);
  assert.equal(excludeText(p).includes(`@${id}`), false, excludeText(p));
  assert.ok(excludeText(p).includes('# START guideline personal files . @.\n'));
});

test('exclude 블록이 줄 때는 파일 쓰기가 성공한 뒤에 줄인다', t => {
  const p = gitDir(t);
  const ex = { common: path.join(p, '.git'), unitRel: '', worktree: '.' };
  writeExclude({ ...ex, paths: ['/.ruler/a.md', '/.ruler/b.md'] });
  write(p, '.ruler/b.md', 'b\n');
  const errs = [];
  // 쓰기가 실패하면(잘못된 경로로 주입) 지우지 못한 b 는 블록에 남는다
  const failed = writeComposedOrFail(p, { '.ruler/b.md': null, '../bad': 'x' }, m => errs.push(m), { ...ex, paths: ['/.ruler/a.md'] });
  assert.ok(failed.failed);
  assert.ok(exists(p, '.ruler/b.md'));
  assert.deepEqual(readExclude(ex), ['/.ruler/a.md', '/.ruler/b.md']);
  // 성공하면 줄인다
  const ok = writeComposedOrFail(p, { '.ruler/b.md': null }, m => errs.push(m), { ...ex, paths: ['/.ruler/a.md'] });
  assert.deepEqual(ok.deleted, ['.ruler/b.md']);
  assert.deepEqual(readExclude(ex), ['/.ruler/a.md']);
  // 늘 때는 파일보다 먼저 쓴다(쓰기가 실패해도 새 경로가 블록에 있다)
  assert.ok(writeComposedOrFail(p, { '../bad': 'x' }, m => errs.push(m), { ...ex, paths: ['/.ruler/a.md', '/.ruler/c.md'] }).failed);
  assert.deepEqual(readExclude(ex), ['/.ruler/a.md', '/.ruler/c.md']);
});

test('새 워크트리의 apply 에도 개인 범위가 들어간다', async t => {
  const p = gitDir(t);
  syncNew(p, { items: ['rules/base'] });
  await apply(p);
  commitAll(p);
  // 개인 선택·사본은 git 공용 디렉터리에 있다(앞서 update 가 받아 둔 것)
  setPersonal(p, p, { default: { add: ['rules/extra'], remove: [] } });
  const wt = addWorktree(t, p, 'fresh');
  assert.equal(exists(wt, '.ruler/extra/00-e.md'), false);
  const r = await apply(wt);
  assert.ok(r.written.includes('.ruler/extra/00-e.md'));
  assert.equal(read(wt, '.ruler/extra/00-e.md'), '# 개인 더함\n');
  assert.match(read(wt, '.ruler/guideline.md'), /더한 것: `rules\/extra`/);
  assert.equal(porcelain(wt), '');
});

test('필수가 된 블록의 개인 뺌은 무시하고 알린다', async t => {
  const p = gitDir(t);
  const { manifest } = syncNew(p, { items: ['rules/base', 'skills/s'] });
  await apply(p);
  commitAll(p);
  setPersonal(p, p, { default: { add: [], remove: ['rules/base'] } });
  const removed = await apply(p);
  assert.ok(removed.deleted.includes('.ruler/base/00-a.md'));
  assert.equal(removed.todos.some(x => x.kind === 'personal-ignored'), false);
  // 프로젝트가 rules/base 를 필수로 바꾼다 → 다음 apply 에서 돌아오고 개인 뺌은 무시된다는 할 일
  write(p, MANIFEST, manifestText({ ...manifest, sources: { default: { ...manifest.sources.default, required: ['rules/base'] } } }));
  const back = await apply(p);
  assert.ok(back.written.includes('.ruler/base/00-a.md'));
  const todo = back.todos.find(x => x.kind === 'personal-ignored');
  assert.equal(todo.item, 'rules/base');
  assert.equal(todo.message, 'rules/base: 필수가 된 블록이라 개인 뺌을 무시함 — guideline pick --local 에서 정리');
  // status 도 같은 할 일을 낸다(서버 없이)
  assert.ok((await statusKinds(p)).includes('personal-ignored'));
});
