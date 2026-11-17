import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, testConfig, META } from '../../server/test/helpers.js';
import { tmpDir, write, collect, ALWAYS } from './helpers.js';
import { SOURCE, manifestOf } from './render-fixture.js';
import { render } from '../src/render/index.js';
import { applyFiles } from '../src/apply.js';
import { diskReader } from '../src/project-state.js';
import { MANIFEST, LOCK, manifestText, lockText } from '../src/manifest.js';
import { projectStatus } from '../src/commands/project-status.js';
import { memoryTree } from '../src/tree.js';
import { checkManifest } from '../src/manifest.js';
import { virtualize, toRealLock } from '../src/workspace.js';
import { PROJECT_TOML } from '../src/layout.js';
import { RULER_TOML_BASE } from '../src/render/outputs.js';
import { projectApply } from '../src/commands/project-apply.js';

async function setup(t, opts) {
  const s = await startApp(t, opts);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = tmpDir('guideline-status-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  const manifest = manifestOf('ruler', ['rules/base', 'skills/s'], { server: s.base });
  const r = render({ tree: memoryTree(SOURCE), revision: 1, manifest, lock: null, project: diskReader(p) });
  applyFiles(p, r.files);
  write(p, MANIFEST, manifestText(manifest));
  write(p, LOCK, lockText(r.lock));
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
  write(p, 'docs/guideline/base/01-b.md', '# 고침\n');
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
  assert.deepEqual(data.todos, []);
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
  write(p, 'docs/guideline/base/01-b.md', '# 고침\n');
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

/** 새 배치 프로젝트: .guideline/ 사본·잠금 v3·ruler.project.toml 을 쓰고 apply 로 생성물까지 맞춘다. */
async function setupNew(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = fs.realpathSync(tmpDir('guideline-status-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  fs.mkdirSync(path.join(p, '.ruler'));
  const manifest = checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: s.base, items: ['rules/base'], aliases: {} } } });
  const trees = new Map([['default', { server: s.base, revision: 1, tree: memoryTree(SOURCE) }]]);
  const v = virtualize({ manifest, lock: null, trees });
  const r = render({ tree: v.tree, revision: 0, manifest: v.view, lock: null, project: diskReader(p), management: v.management, layout: 'guideline' });
  applyFiles(p, r.files);
  write(p, MANIFEST, manifestText(manifest));
  write(p, LOCK, lockText(toRealLock({ viewLock: r.lock, sources: v.sources, revisions: { default: 1 } })));
  write(p, PROJECT_TOML, RULER_TOML_BASE(['claude']));
  assert.equal(await projectApply({ dir: p, out: () => {}, err: () => {}, env: { PATH: '' }, git: () => ({ status: 1, stdout: '' }) }), 0);
  return { p, env: { GUIDELINE_TOKEN: token } };
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
