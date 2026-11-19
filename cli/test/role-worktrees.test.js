import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, exists, read, collect, filesOf, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { syncedProject } from './synced.js';
import { readManifest, readLock } from '../src/manifest.js';
import { runGit } from '../src/projects.js';
import { memoryTree } from '../src/tree.js';
import { personalStore, readLocal, writeLocal } from '../src/personal.js';
import { writePersonal } from '../src/personal-sync.js';
import { writeRole, roleFile } from '../src/role.js';
import { projectApply } from '../src/commands/project-apply.js';
import { projectStatus } from '../src/commands/project-status.js';
import { finishPersonal } from '../src/commands/sync-common.js';

// 역할이 다른 워크트리(git worktree add)를 실제 git 으로 본다. 프로젝트·개인 저장소는 임시 git 저장소의 것이라 이 저장소의 .git 은
// 건드리지 않는다. ruler 는 돌지 않는다(진짜 ruler 는 ruler-personal.test.js).

const FILES = {
  ...SOURCE,
  'rules/web/00-w.md': `${ALWAYS}# 웹\n`,
  'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n`,
  'rules/other/00-o.md': `${ALWAYS}# 다른 역할\n`,
};
const env = { PATH: '' };
const runRuler = () => 0;
const porcelain = p => runGit(['status', '--porcelain', '--untracked-files=all'], p).stdout;
const commit = p => {
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
};

async function apply(p) {
  const o = collect();
  const errs = [];
  assert.equal(await projectApply({ dir: p, json: true, env, runRuler, out: o.out, err: m => errs.push(m) }), 0, errs.join('\n'));
  return JSON.parse(o.text()).todos;
}

/** 받아서 커밋한 프로젝트(git 루트). sub 를 주면 그 아래 하위 단위도. */
function project(t, { items = ['rules/base', 'rules/web'], sub = null, server } = {}) {
  const p = fs.realpathSync(tmpDir('guideline-role-wt-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  syncedProject(p, { items, source: FILES, server });
  if (sub) {
    fs.mkdirSync(path.join(p, sub), { recursive: true });
    syncedProject(path.join(p, sub), { items, source: FILES, server, nested: true });
  }
  commit(p);
  return p;
}

/** 링크 워크트리(분리된 HEAD). */
function worktree(t, p) {
  const w = path.join(fs.realpathSync(tmpDir('guideline-role-wt-link-')), 'w');
  t.after(() => fs.rmSync(path.dirname(w), { recursive: true, force: true }));
  const r = runGit(['worktree', 'add', '-q', '--detach', w], p);
  assert.equal(r.status, 0, r.stderr);
  return w;
}

const storeOf = (p, rel = '') => personalStore({ dir: path.join(p, rel), root: p });
/** update 처럼 개인 사본(과 개인 잠금)을 받는다 — 대상은 local.json 의 공통·모든 역할의 더함. */
const fetchCopies = p => {
  const store = storeOf(p);
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(FILES) }]]);
  assert.deepEqual(writePersonal({ personal: { store, local: readLocal(store) }, manifest: readManifest(p), trees, revisions: { default: 1 } }), []);
};
const ROLES = {
  ui: { sources: { default: { add: ['rules/extra'], remove: [] } } },
  doc: { sources: { default: { add: [], remove: ['rules/web'] } } },
};
const generated = w => Object.fromEntries(Object.entries(filesOf(w)).filter(([k]) => k !== '.git' && !k.startsWith('.git/')));

test('역할이 다른 두 워크트리는 생성물이 다르고 둘 다 깨끗하며 커밋 파일이 같다', async t => {
  const p = project(t);
  const gitignore = read(p, '.gitignore');
  const store = storeOf(p);
  writeLocal(store, { version: 2, sources: {}, roles: ROLES });
  fetchCopies(p);
  const ui = worktree(t, p);
  const doc = worktree(t, p);
  writeRole(ui, 'ui');
  writeRole(doc, 'doc');
  await apply(ui);
  await apply(doc);
  await apply(p);

  assert.equal(exists(ui, '.ruler/extra/00-e.md'), true);
  assert.equal(exists(ui, '.ruler/web/00-w.md'), true);
  assert.equal(exists(doc, '.ruler/extra/00-e.md'), false);
  assert.equal(exists(doc, '.ruler/web/00-w.md'), false);
  // 역할 없는 메인 워크트리는 프로젝트 선택 그대로
  assert.equal(exists(p, '.ruler/extra/00-e.md'), false);
  assert.equal(exists(p, '.ruler/web/00-w.md'), true);
  for (const w of [ui, doc, p]) {
    assert.equal(porcelain(w), '', w);
    assert.equal(runGit(['diff', 'HEAD'], w).stdout, '', w);
    assert.equal(read(w, '.gitignore'), gitignore, w);
  }
  // status 도 같은 입력으로 조합해 거짓 apply 할 일을 내지 않는다(서버 없이 하는 판정)
  for (const w of [ui, doc]) {
    const o = collect();
    await projectStatus({ project: w, json: true, env: {}, out: o.out, err: () => {}, fetchImpl: async () => { throw new Error('없음'); } });
    assert.equal(JSON.parse(o.text() || '{"todos":[]}').todos.some(x => x.kind === 'apply'), false, w);
  }
});

test('역할 a 워크트리에서 개인 사본을 받아도 역할 b 의 사본·잠금이 남는다', t => {
  const p = project(t);
  const store = storeOf(p);
  writeLocal(store, { version: 2, sources: {}, roles: { ui: ROLES.ui, doc: { sources: { default: { add: ['rules/other'], remove: [] } } } } });
  const ui = worktree(t, p);
  writeRole(ui, 'ui');
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(FILES) }]]);
  const r = finishPersonal({ project: ui, manifest: readManifest(ui), sync: { trees, revisions: { default: 1 } }, env, runRuler, err: () => {} });
  assert.equal(r.code, 0);
  assert.equal(exists(store, '.guideline/rules/extra/00-e.md'), true);
  assert.equal(exists(store, '.guideline/rules/other/00-o.md'), true);
  assert.match(JSON.stringify(readLock(store)), /rules\/other/);
  // 이 워크트리의 조합에는 역할 ui 만
  assert.equal(exists(ui, '.ruler/extra/00-e.md'), true);
  assert.equal(exists(ui, '.ruler/other/00-o.md'), false);
});

test('역할 없는 워크트리는 0.24 와 바이트 같다', async t => {
  const p = project(t);
  const store = storeOf(p);
  // 다른 워크트리가 쓰는 역할이 정의돼 있어도
  writeLocal(store, { version: 2, sources: { default: { add: ['rules/extra'], remove: [] } }, roles: ROLES });
  fetchCopies(p);
  const w1 = worktree(t, p);
  const todos = (await apply(w1)).filter(x => x.kind !== 'ruler-apply');
  const withRoles = generated(w1);
  // 역할 기능 이전의 local.json(v1)
  fs.writeFileSync(path.join(store, 'local.json'), `${JSON.stringify({ version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } }, null, 2)}\n`);
  const w2 = worktree(t, p);
  assert.deepEqual((await apply(w2)).filter(x => x.kind !== 'ruler-apply'), todos);
  assert.deepEqual(todos, []);
  assert.deepEqual(generated(w2), withRoles);
  assert.equal(exists(w1, '.ruler/extra/00-e.md'), true);
  assert.equal(porcelain(w1), '');
});

test('정의가 어느 단위에도 없는 역할은 role-missing, 일부 단위에만 없으면 status 줄만', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: FILES });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = project(t, { sub: 'pkg/a', server: s.base });
  writeRole(p, 'ui');
  const missing = (await apply(p)).filter(x => x.kind === 'role-missing');
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.equal(missing[0].scope, 'personal');
  assert.equal(missing[0].message,
    '이 워크트리의 역할 ui 이(가) 어느 단위에도 정의돼 있지 않아 공통 개인 선택만 썼음 — guideline pick --local --role ui 로 만들거나 guideline role use --none');
  // 하위 단위에서 쳐도 하나
  assert.equal((await apply(path.join(p, 'pkg/a'))).filter(x => x.kind === 'role-missing').length, 1);

  // 하위 단위에만 정의 → 할 일은 없고, 루트의 status 에 줄
  const sub = storeOf(p, 'pkg/a');
  writeLocal(sub, { version: 2, sources: {}, roles: { ui: { sources: { default: { add: [], remove: ['rules/web'] } } } } });
  const todos = await apply(p);
  assert.equal(todos.some(x => x.kind === 'role-missing'), false, JSON.stringify(todos));
  assert.equal(exists(p, 'pkg/a/.ruler/web/00-w.md'), false);
  assert.equal(exists(p, '.ruler/web/00-w.md'), true);
  const o = collect();
  await projectStatus({ project: p, env: { GUIDELINE_TOKEN: token }, out: o.out, err: () => {} });
  assert.match(o.text(), /^ {2}역할 ui — 이 단위에는 정의돼 있지 않아 공통 개인 선택만 씀$/m);
  assert.doesNotMatch(o.text(), /role-missing|어느 단위에도/);
  const j = collect();
  await projectStatus({ project: path.join(p, 'pkg/a'), json: true, env: { GUIDELINE_TOKEN: token }, out: j.out, err: () => {} });
  assert.deepEqual(JSON.parse(j.text()).personal.role, { name: 'ui', defined: true, added: [], removed: ['rules/web'], ignored: [] });
});

test('깨진 역할 파일은 role-bad 하나와 역할 없는 조합', async t => {
  const p = project(t, { sub: 'pkg/a' });
  writeLocal(storeOf(p), { version: 2, sources: {}, roles: ROLES });
  fetchCopies(p);
  await apply(p);
  const plain = generated(p);
  for (const bad of ['UI\n', '']) {
    const file = roleFile(p);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bad);
    const todos = await apply(p);
    const roleBad = todos.filter(x => x.kind === 'role-bad');
    assert.equal(roleBad.length, 1, JSON.stringify(todos));
    assert.equal(roleBad[0].scope, 'personal');
    assert.ok(roleBad[0].message.includes(file), roleBad[0].message);
    assert.equal(todos.some(x => x.kind === 'role-missing'), false);
    assert.deepEqual(generated(p), plain);
  }
});
