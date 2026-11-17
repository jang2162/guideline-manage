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
import { mergeTodos } from '../src/commands/sync-common.js';

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
