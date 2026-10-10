import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { projectPick } from '../src/commands/project-pick.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { readManifest, readLock, manifestText } from '../src/manifest.js';
import { runGit } from '../src/projects.js';

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
    version: 2, form: 'ruler', agents: ['claude'],
    sources: { default: { server: s.base, items: ['rules/base/00-a.md', 'rules/base/01-b.md', 'rules/base/SETUP.md', 'skills/s'], aliases: {} } },
  });
  assert.equal(readLock(p).revisions.default, 1);
  const r = JSON.parse(o.text());
  assert.equal(r.revision, 1);
  assert.ok(r.written.includes('guideline.json') === false, '매니페스트는 written 에 넣지 않는다');
  assert.deepEqual([...new Set(r.todos.map(x => x.kind))].sort(), ['ruler-apply', 'setup']);
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
  assert.match(e.text(), /폼이 서버에서 없어졌다/);
  assert.equal(exists(p, 'guideline.json'), false);
});

test('사용법 오류: --project 와 --new 를 함께, 디렉터리가 아님, 서버 주소 없음', async t => {
  const e = collect();
  assert.equal(await projectPick({ project: '/tmp', newTarget: 'x', env: {}, err: e.out }), 2);
  assert.equal(await projectPick({ project: '/no/such/dir', env: {}, err: e.out }), 2);
  const p = gitProject(t, { '.ruler/ruler.toml': '' });
  assert.equal(await projectPick({ project: p, env: {}, err: e.out }), 2);
  assert.match(e.text(), /함께 쓸 수 없다[\s\S]*디렉터리가 아닙니다[\s\S]*서버 주소가 없다/);
});

test('update: 원본 새로 나옴은 쓰고, 프로젝트에서 고친 파일은 건너뛰고, --force 면 덮어쓴다', async t => {
  const { s, env } = await server(t);
  const p = gitProject(t, { '.ruler/ruler.toml': '' });
  await projectPick({ project: p, env, ...quiet, out: () => {}, open: driver(s, { choose: checkOnly(i => i.id.startsWith('rules/base/')) }) });
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n`, 'rules/base/02-new.md': `${ALWAYS}# 새\n` } });
  write(p, 'docs/guideline/base/01-b.md', '# 고침\n');
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  const r = JSON.parse(o.text());
  assert.equal(r.revision, 2);
  assert.equal(read(p, '.ruler/base/00-a.md'), '# 에이\n\n새 본문\n');
  assert.equal(read(p, 'docs/guideline/base/01-b.md'), '# 고침\n');
  assert.deepEqual(r.todos.map(x => x.kind).filter(k => k !== 'ruler-apply').sort(), ['new-file', 'skipped']);
  assert.equal(readLock(p).revisions.default, 2);
  assert.equal(await projectUpdate({ project: p, env, ...quiet, force: true, out: () => {} }), 0);
  assert.equal(read(p, 'docs/guideline/base/01-b.md'), '# 비\n\n본문 B\n');
});

test('update 는 매니페스트가 없으면 2', async t => {
  const p = gitProject(t);
  const e = collect();
  assert.equal(await projectUpdate({ project: p, env: {}, err: e.out }), 2);
  assert.match(e.text(), /guideline pick 을 먼저/);
});

test('ruler 가 아닌 프로젝트와 CLAUDE.md 형 매니페스트는 2', async t => {
  const { env } = await server(t);
  const errs = [];
  const p = gitProject(t, { 'CLAUDE.md': '# p\n' });
  assert.equal(await projectPick({ project: p, env, ...quiet, err: m => errs.push(m) }), 2);
  assert.match(errs.at(-1), /ruler 프로젝트가 아니다/);
  const q = gitProject(t, { '.ruler/ruler.toml': '', 'guideline.json': manifestText({
    version: 1, server: 'http://x', form: 'instructions', instructionFiles: ['CLAUDE.md'], agents: ['claude'], items: [],
  }) });
  assert.equal(await projectUpdate({ project: q, env, ...quiet, err: m => errs.push(m) }), 2);
  assert.match(errs.at(-1), /CLAUDE\.md 형은 더 쓰지 않는다/);
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
  assert.deepEqual(readManifest(sub).sources.default.items, ['rules/base/00-a.md']);
});
