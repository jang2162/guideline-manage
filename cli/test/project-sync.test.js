import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, testConfig, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect, ALWAYS, reference } from './helpers.js';
import { SOURCE, manifestOf } from './render-fixture.js';
import { render } from '../src/render/index.js';
import { applyFiles } from '../src/apply.js';
import { diskReader } from '../src/project-state.js';
import { memoryTree } from '../src/tree.js';
import { projectPick } from '../src/commands/project-pick.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { readManifest, readLock, manifestText, lockText } from '../src/manifest.js';
import { runGit } from '../src/projects.js';
import { PROJECT_TOML, RULER_TOML } from '../src/layout.js';
import { RULER_TOML_BASE } from '../src/render/outputs.js';
import { readBlock } from '../src/gitignore-block.js';

async function server(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  return { s, env: { GUIDELINE_TOKEN: token, GUIDELINE_SERVER: s.base } };
}

function gitProject(t, files = {}) {
  const p = tmpDir('guideline-proj-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  for (const [k, v] of Object.entries(files)) write(p, k, v);
  runGit(['init', '-q'], p);
  return p;
}

/** 브라우저 대신 폼을 열고, choose(항목) 가 돌려준 체크로 제출하거나 취소한다. */
function driver(s, { choose = () => ({}), chosen, cancel = false, before } = {}) {
  return async url => {
    const u = new URL(url);
    const r = await s.req(u.pathname + u.search);
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    const data = (await s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json();
    await before?.();
    const body = cancel ? {} : { choices: choose(data.items, data), force: true, ...(chosen ? { chosen } : {}) };
    await s.req(`${u.pathname}/${cancel ? 'cancel' : 'submit'}`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Origin: s.config.publicUrl.origin, Cookie: cookie },
    });
  };
}
const checkOnly = pred => items => Object.fromEntries(items.map(i => [`${i.kind}:${i.id}`, { checked: pred(i), update: false }]));
const quiet = { err: () => {}, pollWait: 1, runRuler: () => 0 };

test('ruler 프로젝트: 고른 것을 쓰고 매니페스트·잠금을 남긴다', async t => {
  const { s, env } = await server(t);
  const p = gitProject(t, { '.ruler/ruler.toml': 'default_agents = ["claude"]\n' });
  const o = collect();
  const code = await projectPick({
    project: p, env, ...quiet, json: true, out: o.out,
    open: driver(s, { choose: checkOnly(i => i.id.startsWith('rules/base/') || i.id === 'skills/s') }),
  });
  assert.equal(code, 0);
  assert.equal(read(p, '.ruler/base/00-a.md'), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  assert.ok(exists(p, 'docs/guideline/base/01-b.md'));
  assert.ok(exists(p, 'docs/guideline/base/SETUP.md'));
  assert.ok(exists(p, '.ruler/skills/s/img/a.png'));
  assert.deepEqual(readManifest(p), {
    version: 3, form: 'ruler', agents: ['claude'],
    sources: { default: { server: s.base, items: ['rules/base', 'skills/s'], aliases: {} } },
  });
  assert.equal(readLock(p).revisions.default, 1);
  // 매니페스트가 없던 첫 pick 은 새 배치: 사본은 .guideline/, 프로젝트의 ruler.toml 설정은 ruler.project.toml 로 옮긴다
  assert.equal(readLock(p).version, 3);
  assert.equal(read(p, '.guideline/rules/base/00-a.md'), SOURCE['rules/base/00-a.md']);
  assert.equal(read(p, PROJECT_TOML), 'default_agents = ["claude"]\n');
  assert.equal(read(p, RULER_TOML), 'default_agents = ["claude"]\n');
  const r = JSON.parse(o.text());
  assert.equal(r.revision, 1);
  assert.ok(r.written.includes('guideline.json') === false, '매니페스트는 written 에 넣지 않는다');
  assert.deepEqual([...new Set(r.todos.map(x => x.kind))].sort(), ['ruler-apply', 'setup']);
});

test('공개 서버는 토큰 없이 고르고 받는다. 비공개면 로그인 안내로 1', async t => {
  const { s } = await server(t);
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { GUIDELINE_SERVER: s.base };
  const p = gitProject(t, { '.ruler/ruler.toml': 'default_agents = ["claude"]\n' });
  const code = await projectPick({
    project: p, env, home, ...quiet,
    open: driver(s, { choose: checkOnly(i => i.id === 'rules/base/00-a.md') }),
  });
  assert.equal(code, 0);
  assert.ok(exists(p, '.ruler/base/00-a.md'));
  assert.equal(await projectUpdate({ project: p, env, home, ...quiet, out: () => {} }), 0);

  const closed = await startApp(t, { config: testConfig({ publicRead: false }) });
  closed.store.commit({ ...META, source: 'import', changes: SOURCE });
  const q = gitProject(t, { '.ruler/ruler.toml': 'default_agents = ["claude"]\n' });
  const e = collect();
  assert.equal(await projectPick({ project: q, env: { GUIDELINE_SERVER: closed.base }, home, ...quiet, err: e.out, open: () => {} }), 1);
  assert.match(e.text(), /로그인 필요: guideline login --server/);
});

test('--new: 제출하면 폴더를 만들고 git init 한 뒤 ruler 형으로 쓴다', async t => {
  const { s, env } = await server(t);
  const projects = tmpDir('guideline-projects-');
  t.after(() => fs.rmSync(projects, { recursive: true, force: true }));
  const code = await projectPick({
    newTarget: '새 앱', env: { ...env, GUIDELINE_PROJECTS_DIR: projects }, ...quiet, out: () => {},
    open: driver(s, { choose: checkOnly(i => i.id === 'rules/base/00-a.md'), chosen: { form: 'ruler', agents: ['claude', 'codex'] } }),
  });
  assert.equal(code, 0);
  const p = path.join(projects, '새 앱');
  assert.ok(exists(p, '.git'));
  assert.equal(read(p, '.ruler/base/00-a.md'), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  assert.equal(readManifest(p).form, 'ruler');
  assert.equal(exists(p, 'CLAUDE.md'), false);
});

test('pick --new 는 새 배치로 만든다', async t => {
  const { s, env } = await server(t);
  const projects = tmpDir('guideline-projects-');
  t.after(() => fs.rmSync(projects, { recursive: true, force: true }));
  const o = collect();
  const code = await projectPick({
    newTarget: 'app', env: { ...env, GUIDELINE_PROJECTS_DIR: projects }, ...quiet, json: true, out: o.out,
    open: driver(s, {
      choose: checkOnly(i => i.id.startsWith('rules/base/') || i.id.startsWith('mcp/') || i.id === 'agents/rev.md'),
      chosen: { form: 'ruler', agents: ['claude', 'codex'] },
    }),
  });
  assert.equal(code, 0);
  const p = path.join(projects, 'app');
  // .guideline/ 에 원본 모양 사본(frontmatter 그대로)
  assert.equal(read(p, '.guideline/rules/base/00-a.md'), SOURCE['rules/base/00-a.md']);
  assert.equal(read(p, '.guideline/agents/rev.md'), SOURCE['agents/rev.md']);
  assert.ok(exists(p, '.guideline/mcp/gl/server.json'));
  // ruler.project.toml 은 기본 설정, ruler.toml 은 그 위에 고른 MCP
  assert.equal(read(p, PROJECT_TOML), RULER_TOML_BASE(['claude', 'codex']));
  assert.ok(read(p, RULER_TOML).startsWith(RULER_TOML_BASE(['claude', 'codex'])));
  assert.match(read(p, RULER_TOML), /mcp_servers\.c7/);
  const lock = readLock(p);
  assert.equal(lock.version, 3);
  assert.ok(lock.outputs.every(x => x.path.startsWith('.guideline/')), JSON.stringify(lock.outputs.map(x => x.path)));
  // 조합한 생성물과 .gitignore 블록
  assert.equal(read(p, '.ruler/base/00-a.md'), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  const block = readBlock(read(p, '.gitignore'));
  for (const x of ['/.ruler/ruler.toml', '/.ruler/base/00-a.md', '/.ruler/guideline.md', '/docs/guideline/base/01-b.md']) assert.ok(block.includes(x), x);
  assert.equal(block.some(x => x.startsWith('/.guideline/') || x === `/${PROJECT_TOML}`), false);
  // 동기화와 조합이 함께 낸 할 일은 한 번만. 사본을 쓰지 않은 build MCP 는 동기화의 이유(mcp-build)만 남는다
  const r = JSON.parse(o.text());
  const kinds = r.todos.map(x => x.kind);
  for (const k of ['env', 'mcp-build', 'subagents-off']) assert.equal(kinds.filter(x => x === k).length, 1, `${k}: ${kinds.join(', ')}`);
  assert.equal(kinds.includes('no-copy'), false, kinds.join(', '));
  assert.match(r.todos.find(x => x.kind === 'subagents-off').message, /\.guideline\/ 에 사본은 있지만/);
  assert.ok(r.written.includes('.guideline/rules/base/00-a.md') && r.written.includes('.ruler/base/00-a.md'));
});

test('첫 pick 은 git 이 추적하던 ruler.toml 을 ruler.project.toml 로 옮기고 인덱스에서 뺀다', async t => {
  const { s, env } = await server(t);
  const p = gitProject(t, { '.ruler/ruler.toml': 'default_agents = ["claude"]\n' });
  runGit(['add', '.ruler/ruler.toml'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init'], p);
  const o = collect();
  assert.equal(await projectPick({
    project: p, env, ...quiet, json: true, out: o.out, open: driver(s, { choose: checkOnly(i => i.id === 'rules/base/00-a.md') }),
  }), 0);
  // 파일은 조합 결과로 남고, 추적만 빠진다(삭제가 스테이지됨)
  assert.equal(read(p, RULER_TOML), 'default_agents = ["claude"]\n');
  assert.equal(runGit(['ls-files', '--', RULER_TOML], p).stdout, '');
  assert.match(runGit(['status', '--porcelain', '--', RULER_TOML], p).stdout, /^D {2}\.ruler\/ruler\.toml$/m);
  const todo = JSON.parse(o.text()).todos.find(x => x.kind === 'untracked');
  assert.match(todo.message, /^\.ruler\/ruler\.toml: 설정을 \.ruler\/ruler\.project\.toml 로 옮겨 이제 생성물이라 git 인덱스에서 뺌/);

  // 추적하지 않던 ruler.toml 이면 할 일이 없다
  const q = gitProject(t, { '.ruler/ruler.toml': 'default_agents = ["claude"]\n' });
  const o2 = collect();
  assert.equal(await projectPick({
    project: q, env, ...quiet, json: true, out: o2.out, open: driver(s, { choose: checkOnly(i => i.id === 'rules/base/00-a.md') }),
  }), 0);
  assert.equal(JSON.parse(o2.text()).todos.some(x => x.kind === 'untracked'), false);
});

test('첫 pick(새 배치)도 조합 전에 ruler.toml 이 없었으면 ruler 가 남긴 CLAUDE.md 를 다룬다', async t => {
  const { s, env } = await server(t);
  // ruler.toml 없이 ruler 가 먼저 돌아 CLAUDE.md 가 생긴 프로젝트. 에이전트는 codex 만이라 ruler 가 CLAUDE.md 를 다시 만들지 않는다
  const p = gitProject(t, { '.ruler/ruler.project.toml': 'default_agents = ["codex"]\n', 'CLAUDE.md': '<!-- Generated by Ruler -->\n본문\n' });
  const o = collect();
  assert.equal(await projectPick({
    project: p, env, ...quiet, json: true, out: o.out, open: driver(s, { choose: checkOnly(i => i.id === 'rules/base/00-a.md') }),
  }), 0);
  assert.equal(exists(p, 'CLAUDE.md'), false);
  const r = JSON.parse(o.text());
  assert.ok(r.deleted.includes('CLAUDE.md'));
  assert.equal(r.todos.filter(x => x.kind === 'stray-ruler-output').length, 1);
});

test('취소하면 3 이고 아무것도 쓰지 않는다. 새 프로젝트면 폴더도 만들지 않는다', async t => {
  const { s, env } = await server(t);
  const p = gitProject(t, { '.ruler/ruler.toml': '' });
  assert.equal(await projectPick({ project: p, env, ...quiet, out: () => {}, open: driver(s, { cancel: true }) }), 3);
  assert.equal(exists(p, 'guideline.json'), false);
  const projects = tmpDir('guideline-projects-');
  t.after(() => fs.rmSync(projects, { recursive: true, force: true }));
  assert.equal(await projectPick({ newTarget: 'x', env: { ...env, GUIDELINE_PROJECTS_DIR: projects }, ...quiet, out: () => {}, open: driver(s, { cancel: true }) }), 3);
  assert.equal(exists(projects, 'x'), false);
});

test('기다리는 사이 폼이 서버에서 없어지면 1 이고 아무것도 쓰지 않는다', async t => {
  const { s, env } = await server(t);
  const p = gitProject(t, { '.ruler/ruler.toml': '' });
  const e = collect();
  const code = await projectPick({
    project: p, env, ...quiet, err: e.out, out: () => {},
    open: driver(s, { before: () => s.app.store.db.exec('DELETE FROM forms') }),
  });
  assert.equal(code, 1);
  assert.match(e.text(), /서버에서 폼이 사라짐/);
  assert.equal(exists(p, 'guideline.json'), false);
});

test('사용법 오류: --project 와 --new 를 함께, 디렉터리가 아님, 서버 주소 없음', async t => {
  const e = collect();
  assert.equal(await projectPick({ project: '/tmp', newTarget: 'x', env: {}, err: e.out }), 2);
  assert.equal(await projectPick({ project: '/no/such/dir', env: {}, err: e.out }), 2);
  const p = gitProject(t, { '.ruler/ruler.toml': '' });
  assert.equal(await projectPick({ project: p, env: {}, err: e.out }), 2);
  assert.match(e.text(), /함께 쓸 수 없음[\s\S]*디렉터리 아님[\s\S]*서버 주소 없음/);
});

test('update: 원본 새로 나옴은 쓰고, 프로젝트에서 고친 사본은 건너뛰고(조합은 고친 사본으로), --force 면 덮어쓴다', async t => {
  const { s, env } = await server(t);
  const p = gitProject(t, { '.ruler/ruler.toml': '' });
  await projectPick({ project: p, env, ...quiet, out: () => {}, open: driver(s, { choose: checkOnly(i => i.id.startsWith('rules/base/')) }) });
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n`, 'rules/base/02-new.md': `${ALWAYS}# 새\n` } });
  // 새 배치에서 프로젝트가 고치는 것은 .guideline/ 의 원본 모양 사본이다
  write(p, '.guideline/rules/base/01-b.md', `${reference('비 작업을 할 때')}# 고침\n`);
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  const r = JSON.parse(o.text());
  assert.equal(r.revision, 2);
  assert.equal(read(p, '.ruler/base/00-a.md'), '# 에이\n\n새 본문\n');
  assert.match(read(p, '.guideline/rules/base/01-b.md'), /# 고침/);
  assert.equal(read(p, 'docs/guideline/base/01-b.md'), '# 고침\n');
  assert.equal(read(p, '.ruler/base/02-new.md'), '# 새\n');
  assert.ok(r.written.includes('.ruler/base/02-new.md'));
  assert.deepEqual(r.todos.map(x => x.kind).filter(k => k !== 'ruler-apply').sort(), ['skipped']);
  assert.equal(readLock(p).revisions.default, 2);
  assert.equal(await projectUpdate({ project: p, env, ...quiet, force: true, out: () => {} }), 0);
  assert.equal(read(p, 'docs/guideline/base/01-b.md'), '# 비\n\n본문 B\n');
});

test('update 는 매니페스트가 없으면 2', async t => {
  const p = gitProject(t);
  const e = collect();
  assert.equal(await projectUpdate({ project: p, env: {}, err: e.out }), 2);
  assert.match(e.text(), /guideline pick 먼저/);
});

test('ruler 가 아닌 프로젝트와 CLAUDE.md 형 매니페스트는 2', async t => {
  const { env } = await server(t);
  const errs = [];
  const p = gitProject(t, { 'CLAUDE.md': '# p\n' });
  assert.equal(await projectPick({ project: p, env, ...quiet, err: m => errs.push(m) }), 2);
  assert.match(errs.at(-1), /ruler 프로젝트가 아님/);
  const q = gitProject(t, { '.ruler/ruler.toml': '', 'guideline.json': manifestText({
    version: 1, server: 'http://x', form: 'instructions', instructionFiles: ['CLAUDE.md'], agents: ['claude'], items: [],
  }) });
  assert.equal(await projectUpdate({ project: q, env, ...quiet, err: m => errs.push(m) }), 2);
  assert.match(errs.at(-1), /CLAUDE\.md 형은 더 이상 지원하지 않음/);
});

test('중첩 디렉터리: 그 안에만 쓰고, 루트 전용 항목은 막히고, ruler apply 는 git 루트에서, nested-off 를 알린다', async t => {
  const { s, env } = await server(t);
  const root = fs.realpathSync(gitProject(t, {
    '.ruler/ruler.toml': 'default_agents = ["claude"]\nnested = false\n',
    'node_modules/.bin/ruler': '',
    'guideline.json': manifestText({ version: 1, server: s.base, form: 'ruler', instructionFiles: [], agents: ['claude'], items: ['rules/base/01-b.md'] }),
    'packages/api/.ruler/.keep': '',
  }));
  const sub = path.join(root, 'packages', 'api');
  const calls = [];
  let seen;
  const o = collect();
  const code = await projectPick({
    project: sub, env, ...quiet, json: true, out: o.out, runRuler: (bin, cwd) => { calls.push(cwd); return 0; },
    open: driver(s, {
      choose: (items, data) => {
        seen = data;
        return checkOnly(i => i.id === 'rules/base/00-a.md' || i.id === 'skills/s')(items);
      },
    }),
  });
  assert.equal(code, 0);
  assert.equal(seen.project.nested, true);
  assert.deepEqual(seen.project.rootStacks, ['base']);
  assert.equal(seen.items.find(i => i.id === 'skills/s').state, 'blocked');
  assert.equal(read(sub, '.ruler/base/00-a.md'), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  assert.equal(read(sub, '.ruler/ruler.toml'), 'default_agents = ["claude"]\n');
  assert.equal(exists(sub, '.ruler/skills/s/SKILL.md'), false);
  assert.equal(exists(root, '.ruler/base/00-a.md'), false);
  assert.equal(read(root, '.ruler/ruler.toml'), 'default_agents = ["claude"]\nnested = false\n');
  assert.deepEqual(calls, [root]);
  const out = JSON.parse(o.text());
  assert.ok(out.todos.some(x => x.kind === 'nested-off'));
  assert.deepEqual(readManifest(sub).sources.default.items, ['rules/base']);
});

test('v2 일부 선택은 update 에서 스택 전체가 된다', async t => {
  const { s, env } = await server(t);
  const p = gitProject(t, { '.ruler/ruler.toml': 'default_agents = ["claude"]\n' });
  const first = render({
    tree: memoryTree(SOURCE), revision: 1, manifest: manifestOf('ruler', ['rules/base/00-a.md'], { agents: ['claude'] }), lock: null, project: diskReader(p),
  });
  applyFiles(p, first.files);
  write(p, 'guideline.json', `${JSON.stringify({
    version: 2, form: 'ruler', agents: ['claude'], sources: { default: { server: s.base, items: ['rules/base/00-a.md'] } },
  }, null, 2)}\n`);
  write(p, 'guideline-lock.json', lockText(first.lock));
  assert.equal(exists(p, 'docs/guideline/base/01-b.md'), false);

  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  const r = JSON.parse(o.text());
  for (const f of ['docs/guideline/base/01-b.md', 'docs/guideline/base/SETUP.md', '.ruler/base/99-reference.md']) {
    assert.ok(r.written.includes(f), f);
    assert.ok(exists(p, f), f);
  }
  assert.equal(r.todos.some(x => x.kind === 'new-file'), false);
  const saved = JSON.parse(read(p, 'guideline.json'));
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.sources.default.items, ['rules/base']);
  assert.deepEqual(Object.keys(readLock(p).sources).sort(), ['default:rules/base/00-a.md', 'default:rules/base/01-b.md', 'default:rules/base/SETUP.md']);
});
