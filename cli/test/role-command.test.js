import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, exists, read, collect, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { syncedProject } from './synced.js';
import { readManifest } from '../src/manifest.js';
import { runGit } from '../src/projects.js';
import { memoryTree } from '../src/tree.js';
import { personalStore, readLocal, writeLocal } from '../src/personal.js';
import { writePersonal } from '../src/personal-sync.js';
import { readRole, writeRole, roleFile } from '../src/role.js';
import { projectApply } from '../src/commands/project-apply.js';
import { role } from '../src/commands/role.js';

// guideline role 명령. 프로젝트·개인 저장소는 임시 git 저장소의 것이라 이 저장소의 .git 은 건드리지 않는다. ruler 는 돌지 않는다
// (진짜 ruler 로 역할을 바꿀 때의 MCP·스킬 정리는 ruler-personal.test.js).

const FILES = {
  ...SOURCE,
  'rules/web/00-w.md': `${ALWAYS}# 웹\n`,
  'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n`,
};
const env = { PATH: '' };
const runRuler = () => 0;
const porcelain = p => runGit(['status', '--porcelain', '--untracked-files=all'], p).stdout;
const UI = { sources: { default: { add: ['rules/extra'], remove: [] } } };
const DOC = { sources: { default: { add: [], remove: ['rules/web'] } } };

/** 받아서 커밋하고 apply 한 프로젝트(git 루트). sub 를 주면 그 아래 하위 단위도. */
async function project(t, { sub = null } = {}) {
  const p = fs.realpathSync(tmpDir('guideline-role-cmd-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  const items = ['rules/base', 'rules/web'];
  syncedProject(p, { items, source: FILES });
  if (sub) {
    fs.mkdirSync(path.join(p, sub), { recursive: true });
    syncedProject(path.join(p, sub), { items, source: FILES, nested: true });
  }
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
  assert.equal(await projectApply({ dir: p, env, runRuler, out: () => {}, err: () => {} }), 0);
  return p;
}

const storeOf = (p, rel = '') => personalStore({ dir: path.join(p, rel), root: p });
/** local.json 을 쓰고 update 처럼 개인 사본을 받는다. */
function setLocal(p, rel, local) {
  const store = storeOf(p, rel);
  writeLocal(store, local);
  const trees = new Map([['default', { server: 'http://x', revision: 1, tree: memoryTree(FILES) }]]);
  writePersonal({ personal: { store, local: readLocal(store) }, manifest: readManifest(path.join(p, rel)), trees, revisions: { default: 1 } });
}

/** role 명령을 cwd 에서 돈다. */
async function run(cwd, opts) {
  const o = collect();
  const e = collect();
  const code = await role({ cwd, env, runRuler, out: o.out, err: e.out, ...opts });
  return { code, out: o.text(), err: e.text() };
}

test('role use 는 역할을 정하고 git 루트부터 반영한다(하위 단위에서 쳐도 루트·하위 생성물 모두 그 역할)', async t => {
  const p = await project(t, { sub: 'pkg/a' });
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI } });
  setLocal(p, 'pkg/a', { version: 2, sources: {}, roles: { ui: UI } });
  assert.equal(exists(p, '.ruler/extra/00-e.md'), false);
  const gitignore = read(p, '.gitignore');

  const r = await run(path.join(p, 'pkg/a'), { action: 'use', name: 'ui', json: true });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readRole(p), { name: 'ui', bad: false });
  assert.equal(exists(p, '.ruler/extra/00-e.md'), true);
  assert.equal(exists(p, 'pkg/a/.ruler/extra/00-e.md'), true);
  assert.deepEqual(JSON.parse(r.out).todos.filter(x => x.kind === 'role-missing' || x.kind === 'role-bad'), []);
  assert.equal(porcelain(p), '');
  assert.equal(read(p, '.gitignore'), gitignore);
});

test('역할이 한 단위에만 있어도 role use 는 받아들이고 role-missing 은 없다', async t => {
  const p = await project(t, { sub: 'pkg/a' });
  setLocal(p, 'pkg/a', { version: 2, sources: {}, roles: { doc: DOC } });
  const r = await run(p, { action: 'use', name: 'doc', json: true });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).todos.some(x => x.kind === 'role-missing'), false, r.out);
  assert.equal(exists(p, 'pkg/a/.ruler/web/00-w.md'), false);
  assert.equal(exists(p, '.ruler/web/00-w.md'), true);
});

test('어느 단위에도 없는 역할이나 규칙에 맞지 않는 이름이면 코드 2 이고 역할 파일을 쓰지 않는다', async t => {
  const p = await project(t, { sub: 'pkg/a' });
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI } });
  const missing = await run(p, { action: 'use', name: 'doc' });
  assert.equal(missing.code, 2);
  assert.match(missing.err, /역할 doc 이\(가\) 어느 단위에도 정의돼 있지 않음 — guideline pick --local --role doc 로 만들기/);
  for (const name of ['UI', '1x', 'a'.repeat(33)]) {
    const bad = await run(p, { action: 'use', name });
    assert.equal(bad.code, 2, name);
    assert.match(bad.err, /역할 이름은 영소문자로 시작/);
  }
  const none = await run(p, { action: 'use' });
  assert.equal(none.code, 2);
  assert.equal(fs.existsSync(roleFile(p)), false);
});

test('role use --none 은 역할을 지우고 반영한다', async t => {
  const p = await project(t);
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI } });
  assert.equal((await run(p, { action: 'use', name: 'ui' })).code, 0);
  assert.equal(exists(p, '.ruler/extra/00-e.md'), true);
  const r = await run(p, { action: 'use', none: true });
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.existsSync(roleFile(p)), false);
  assert.equal(exists(p, '.ruler/extra/00-e.md'), false);
  assert.equal(porcelain(p), '');
  // 이름과 --none 을 함께 주면 2
  assert.equal((await run(p, { action: 'use', name: 'ui', none: true })).code, 2);
});

test('role remove 는 이 단위의 정의만 지우고, 이 워크트리가 그 역할이면 apply 할 일 하나', async t => {
  const p = await project(t, { sub: 'pkg/a' });
  setLocal(p, '', { version: 2, sources: { default: { add: ['rules/extra'], remove: [] } }, roles: { ui: UI, doc: DOC } });
  setLocal(p, 'pkg/a', { version: 2, sources: {}, roles: { ui: UI } });
  writeRole(p, 'doc');

  const r = await run(path.join(p, 'pkg/a'), { action: 'remove', name: 'ui', json: true });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { removed: 'ui', todos: [] });
  assert.deepEqual(readLocal(storeOf(p, 'pkg/a')).roles, {});
  assert.deepEqual(Object.keys(readLocal(storeOf(p)).roles), ['doc', 'ui']);

  const before = readLocal(storeOf(p));
  const d = await run(p, { action: 'remove', name: 'doc' });
  assert.equal(d.code, 0, d.err);
  assert.match(d.out, /^ {2}- 이 워크트리의 역할 doc 의 정의를 지웠음 — guideline apply 로 반영$/m);
  const after = readLocal(storeOf(p));
  assert.deepEqual(after, { ...before, roles: { ui: UI } });
  // 반영은 하지 않는다 — 역할 파일도 그대로
  assert.deepEqual(readRole(p), { name: 'doc', bad: false });

  const gone = await run(path.join(p, 'pkg/a'), { action: 'remove', name: 'ui' });
  assert.equal(gone.code, 2);
  assert.match(gone.err, /이 단위\(pkg\/a\)에는 역할 ui 이\(가\) 정의돼 있지 않음/);
});

test('role --json 은 이 워크트리의 역할과 단위별 정의된 역할', async t => {
  const p = await project(t, { sub: 'pkg/a' });
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI, doc: DOC } });
  const plain = await run(p, { json: true });
  assert.equal(plain.code, 0);
  assert.deepEqual(JSON.parse(plain.out), { role: null, bad: false, units: [{ unit: '.', roles: ['doc', 'ui'] }, { unit: 'pkg/a', roles: [] }] });

  writeRole(p, 'ui');
  assert.deepEqual(JSON.parse((await run(path.join(p, 'pkg/a'), { json: true })).out).role, 'ui');
  const text = await run(p, {});
  assert.equal(text.code, 0);
  assert.match(text.out, /^이 워크트리의 역할 — ui$/m);
  assert.match(text.out, /^ {2}\. — doc, ui$/m);
  assert.match(text.out, /^ {2}pkg\/a — 없음$/m);

  fs.writeFileSync(roleFile(p), 'UI\n');
  assert.deepEqual(JSON.parse((await run(p, { json: true })).out).role, null);
  assert.equal(JSON.parse((await run(p, { json: true })).out).bad, true);
  assert.match((await run(p, {})).out, /역할 파일이 깨졌음/);
});

test('git 저장소가 아니면 role 명령은 코드 2', async t => {
  const d = fs.realpathSync(tmpDir('guideline-role-nogit-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const opts of [{}, { action: 'use', name: 'ui' }, { action: 'remove', name: 'ui' }]) {
    const r = await run(d, opts);
    assert.equal(r.code, 2, JSON.stringify(opts));
    assert.match(r.err, /git 저장소/);
  }
  const bad = await run(d, { action: 'nope' });
  assert.equal(bad.code, 2);
});

test('role use 의 반영이 실패하면 역할 파일을 지난 역할로 되돌리고 그것을 알린다', async t => {
  const p = await project(t);
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI, doc: DOC } });
  writeRole(p, 'doc');
  fs.writeFileSync(path.join(p, 'guideline.json'), '{'); // 반영(apply)이 매니페스트를 못 읽어 실패한다
  const r = await run(p, { action: 'use', name: 'ui' });
  assert.notEqual(r.code, 0);
  assert.deepEqual(readRole(p), { name: 'doc', bad: false });
  assert.match(r.err, /^반영에 실패해 역할을 되돌렸음 — doc$/m);
  // 역할이 없던 워크트리는 없음으로 돌아간다
  writeRole(p, null);
  const n = await run(p, { action: 'use', name: 'ui' });
  assert.notEqual(n.code, 0);
  assert.equal(fs.existsSync(roleFile(p)), false);
  assert.match(n.err, /^반영에 실패해 역할을 되돌렸음 — 없음$/m);
});

test('role use 의 반영이 쓰기 전에 실패하면 깨진 역할 파일도 그 바이트 그대로 되돌리고 그렇게 알린다', async t => {
  const p = await project(t);
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI } });
  fs.mkdirSync(path.dirname(roleFile(p)), { recursive: true });
  fs.writeFileSync(roleFile(p), '{broken');
  fs.writeFileSync(path.join(p, 'guideline.json'), '{');
  const r = await run(p, { action: 'use', name: 'ui' });
  assert.notEqual(r.code, 0);
  assert.equal(fs.readFileSync(roleFile(p), 'utf8'), '{broken');
  assert.match(r.err, /^반영에 실패해 역할을 되돌렸음 — 깨진 역할 파일$/m);
});

test('role use 의 반영이 무언가 쓴 뒤 일부만 실패하면 역할은 새 역할로 두고 고친 뒤 apply 하라고 알린다', async t => {
  const p = await project(t, { sub: 'pkg/a' });
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI, doc: DOC } });
  setLocal(p, 'pkg/a', { version: 2, sources: {}, roles: { ui: UI } });
  writeRole(p, 'doc');
  // 루트는 쓰고 하위 단위 쓰기만 실패한다: 하위 단위가 새 역할로 쓸 디렉터리 자리에 파일이 있다
  fs.writeFileSync(path.join(p, 'pkg/a/.ruler/extra'), 'x');
  const r = await run(p, { action: 'use', name: 'ui' });
  assert.equal(r.code, 1, r.err);
  // 루트 생성물은 새 역할(ui)로 조합됐다 — 역할 파일도 그것과 맞게 ui 로 남는다
  assert.equal(exists(p, '.ruler/extra/00-e.md'), true);
  assert.deepEqual(readRole(p), { name: 'ui', bad: false });
  assert.match(r.err, /^역할은 ui\(으\)로 바꿨고 반영 일부가 실패함 — 고친 뒤 guideline apply$/m);
  assert.doesNotMatch(r.err, /되돌렸음/);
  // --none 이면 이름 대신 없음(이번에는 하위 단위가 지난 역할로 쓸 것이 없으므로 다른 자리를 막는다)
  fs.rmSync(path.join(p, 'pkg/a/.ruler/extra'));
  writeRole(p, 'ui');
  fs.rmSync(path.join(p, 'pkg/a/.ruler/base'), { recursive: true, force: true });
  fs.writeFileSync(path.join(p, 'pkg/a/.ruler/base'), 'x');
  const n = await run(p, { action: 'use', none: true });
  assert.equal(n.code, 1, n.err);
  assert.equal(fs.existsSync(roleFile(p)), false);
  assert.match(n.err, /^역할은 없음\(으\)로 바꿨고 반영 일부가 실패함 — 고친 뒤 guideline apply$/m);
});

test('role remove 를 guideline 단위가 아닌 폴더에서 치면 그 문구로 코드 2', async t => {
  const p = await project(t);
  setLocal(p, '', { version: 2, sources: {}, roles: { ui: UI } });
  fs.mkdirSync(path.join(p, 'src'));
  const r = await run(path.join(p, 'src'), { action: 'remove', name: 'ui' });
  assert.equal(r.code, 2);
  assert.match(r.err, /guideline 단위가 아님/);
  assert.doesNotMatch(r.err, /이 단위\(src\)/);
  assert.deepEqual(Object.keys(readLocal(storeOf(p)).roles), ['ui']);
});

test('role --none 은 use 에서만 쓴다는 문구로 코드 2', async t => {
  const p = await project(t);
  for (const opts of [{ none: true }, { action: 'remove', name: 'ui', none: true }]) {
    const r = await run(p, opts);
    assert.equal(r.code, 2);
    assert.match(r.err, /--none 은 guideline role use 에서만/);
  }
});
