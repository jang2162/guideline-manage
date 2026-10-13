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

async function setup(t, opts) {
  const s = await startApp(t, opts);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = tmpDir('guideline-status-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  const manifest = manifestOf('ruler', ['rules/base/00-a.md', 'rules/base/01-b.md', 'skills/s'], { server: s.base });
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

test('status --json 은 원본 새로 나옴·프로젝트에서 고침·새 파일을 낸다', async t => {
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
    { id: 'skills/s', state: 'current' },
  ]);
  assert.deepEqual(data.newFiles, ['rules/base/02-new.md', 'rules/base/SETUP.md']);
  assert.deepEqual(data.todos.map(x => x.kind), ['new-file', 'new-file']);
});

test('status 글 출력', async t => {
  const { p, env } = await setup(t);
  write(p, 'docs/guideline/base/01-b.md', '# 고침\n');
  const o = collect();
  await projectStatus({ project: p, env, out: o.out });
  assert.match(o.text(), new RegExp(`^지침 상태 — ${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(반영 r1, 서버 최신 r1\\)$`, 'm'));
  assert.match(o.text(), /^ {2}최신 2 · 프로젝트에서 고침 1$/m);
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
