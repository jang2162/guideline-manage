import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir } from './helpers.js';
import { gitCommonDir } from '../src/projects.js';
import { personalStore, readLocal, writeLocal, effectiveItems, LocalError } from '../src/personal.js';

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** 임시 git 저장소(커밋 하나) + 워크트리 하나. 이 저장소 자신의 .git 은 건드리지 않는다. */
function repoWithWorktree(t) {
  const base = fs.realpathSync(tmpDir('guideline-personal-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q');
  git(main, 'config', 'user.email', 't@example.com');
  git(main, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a');
  git(main, 'add', 'a.txt');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = path.join(base, 'wt');
  git(main, 'worktree', 'add', '-q', wt);
  return { base, main, wt };
}

test('gitCommonDir 은 워크트리에서도 주 저장소의 .git 을 돌려주고 git 이 아니면 null', t => {
  const { base, main, wt } = repoWithWorktree(t);
  assert.equal(gitCommonDir(main), path.join(main, '.git'));
  assert.equal(gitCommonDir(wt), path.join(main, '.git'));
  const plain = path.join(base, 'plain');
  fs.mkdirSync(plain);
  assert.equal(gitCommonDir(plain), null);
});

test('gitCommonDir 은 옛 git 처럼 한 줄이 아닌 출력이나 없는 경로면 던지지 않고 null', () => {
  const fake = stdout => () => ({ status: 0, stdout });
  assert.equal(gitCommonDir('.', fake('--path-format=absolute\n.git\n')), null);
  assert.equal(gitCommonDir('.', fake('/definitely/not/here/.git\n')), null);
  assert.equal(gitCommonDir('.', fake('\n')), null);
});

test('personalStore 는 워크트리마다 같은 공용 디렉터리를 쓴다', t => {
  const { main, wt } = repoWithWorktree(t);
  const common = path.join(main, '.git');
  assert.equal(personalStore({ dir: main, root: main }), path.join(common, 'guideline', 'units', '%root'));
  assert.equal(personalStore({ dir: wt, root: wt }), path.join(common, 'guideline', 'units', '%root'));
  fs.mkdirSync(path.join(main, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'a', 'b'), { recursive: true });
  assert.equal(personalStore({ dir: path.join(main, 'a', 'b'), root: main }), path.join(common, 'guideline', 'units', 'a%2Fb'));
  assert.equal(personalStore({ dir: path.join(wt, 'a', 'b'), root: wt }), path.join(common, 'guideline', 'units', 'a%2Fb'));
});

test('personalStore 는 서로 다른 단위에 서로 다른 저장소를 준다(a/b·a__b·_root 폴더·x_/_y·x/__y·루트)', t => {
  const { main } = repoWithWorktree(t);
  const dirs = ['a/b', 'a__b', '_root', 'x_/_y', 'x/__y', 'a%2Fb'];
  const stores = [personalStore({ dir: main, root: main })];
  for (const d of dirs) {
    fs.mkdirSync(path.join(main, d), { recursive: true });
    stores.push(personalStore({ dir: path.join(main, d), root: main }));
  }
  assert.equal(new Set(stores).size, 1 + dirs.length, stores.join('\n'));
});

test('personalStore 는 dir 과 root 를 모두 realpath 하고 root 밖이면 null', t => {
  const { base, main, wt } = repoWithWorktree(t);
  const link = path.join(base, 'link');
  fs.symlinkSync(main, link);
  const root = personalStore({ dir: main, root: main });
  assert.equal(personalStore({ dir: main, root: link }), root);
  assert.equal(personalStore({ dir: link, root: main }), root);
  assert.equal(personalStore({ dir: wt, root: main }), null);
});

test('personalStore 는 git 저장소가 아니면 null', t => {
  const dir = fs.realpathSync(tmpDir('guideline-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(personalStore({ dir, root: dir }), null);
});

test('readLocal 은 파일이 없으면 빈 개인 선택, writeLocal 은 정렬해 쓰고 되읽는다', t => {
  const store = path.join(tmpDir('guideline-local-'), 'units', '_root');
  t.after(() => fs.rmSync(path.dirname(path.dirname(store)), { recursive: true, force: true }));
  assert.deepEqual(readLocal(store), { version: 2, sources: {}, roles: {} });
  writeLocal(store, { version: 1, sources: { b: { add: ['skills/z', 'rules/a', 'rules/a'], remove: [] }, a: { add: [], remove: ['rules/x'] } } });
  const onDisk = JSON.parse(fs.readFileSync(path.join(store, 'local.json'), 'utf8'));
  assert.deepEqual(Object.keys(onDisk.sources), ['a', 'b']);
  assert.deepEqual(onDisk.sources.b.add, ['rules/a', 'skills/z']);
  assert.deepEqual(readLocal(store).sources.a, { add: [], remove: ['rules/x'] });
});

test('readLocal 은 깨진 파일을 LocalError 로 거절한다', t => {
  const store = tmpDir('guideline-local-');
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  for (const bad of ['{', '{"version":3,"sources":{}}', '{"version":1,"sources":{"a":{"add":["rules/a/00-x.md"],"remove":[]}}}', '{"version":1,"sources":{"a":{"add":"rules/a","remove":[]}}}']) {
    fs.writeFileSync(path.join(store, 'local.json'), bad);
    assert.throws(() => readLocal(store), LocalError, bad);
  }
});

const manifest = (src = {}) => ({
  version: 3, form: 'ruler', agents: ['claude'],
  sources: { default: { server: 'https://s', items: ['rules/base', 'rules/browser'], aliases: {}, required: [], ...src } },
});
const local = (name, v) => ({ version: 1, sources: { [name]: { add: [], remove: [], ...v } } });

test('effectiveItems: 브리프 시나리오 — 필수는 남기고 무시하며 더한 하위 스택과 조상이 들어간다', () => {
  const m = manifest({ required: ['rules/base'] });
  const r = effectiveItems(m, local('default', { add: ['rules/browser/neo'], remove: ['rules/base'] }));
  assert.deepEqual(r.sources.default, {
    items: ['rules/base', 'rules/browser', 'rules/browser/neo'],
    added: ['rules/browser/neo'], removed: [], ignored: ['rules/base'], ignoredWhy: { 'rules/base': 'required' },
  });
});

test('effectiveItems 는 뺀 것이 더한 것을 상쇄하면 added 에 넣지 않고 ignored 에 둔다', () => {
  const r = effectiveItems(manifest(), local('default', { add: ['rules/browser/neo', 'skills/x'], remove: ['rules/browser', 'skills/x'] }));
  assert.deepEqual(r.sources.default, {
    items: ['rules/base'],
    added: [], removed: ['rules/browser'],
    ignored: ['rules/browser/neo', 'skills/x'], ignoredWhy: { 'rules/browser/neo': 'canceled', 'skills/x': 'canceled' },
  });
});

test('effectiveItems 의 added 는 개인이 고른 키만이고 자동으로 채운 조상은 넣지 않는다', () => {
  const r = effectiveItems(manifest(), local('default', { add: ['rules/browser/neo', 'rules/other/sub', 'skills/x'] }));
  assert.deepEqual(r.sources.default.items, ['rules/base', 'rules/browser', 'rules/browser/neo', 'rules/other', 'rules/other/sub', 'skills/x']);
  assert.deepEqual(r.sources.default.added, ['rules/browser/neo', 'rules/other/sub', 'skills/x']);
});

test('effectiveItems 는 이미 프로젝트가 가진 add 와 아무것도 못 뺀 remove 를 ignored 로 알린다', () => {
  const r = effectiveItems(manifest(), local('default', { add: ['rules/base'], remove: ['skills/none'] }));
  assert.deepEqual(r.sources.default, {
    items: ['rules/base', 'rules/browser'],
    added: [], removed: [],
    ignored: ['rules/base', 'skills/none'], ignoredWhy: { 'rules/base': 'already-chosen', 'skills/none': 'no-effect' },
  });
});

test('effectiveItems 는 뺀 스택의 자손도 빼고 removed 에는 실제로 빠진 프로젝트 항목을 담는다', () => {
  const m = manifest({ items: ['rules/browser', 'rules/browser/neo', 'rules/browserx'] });
  const r = effectiveItems(m, local('default', { remove: ['rules/browser'] }));
  assert.deepEqual(r.sources.default.items, ['rules/browserx']);
  assert.deepEqual(r.sources.default.removed, ['rules/browser', 'rules/browser/neo']);
  assert.deepEqual(r.sources.default.ignored, []);
});

test('effectiveItems 는 필수의 조상을 빼려는 것도 무시한다', () => {
  const m = manifest({ items: ['rules/a', 'rules/a/b'], required: ['rules/a/b'] });
  const r = effectiveItems(m, local('default', { remove: ['rules/a'] }));
  assert.deepEqual(r.sources.default.items, ['rules/a', 'rules/a/b']);
  assert.deepEqual(r.sources.default.ignored, ['rules/a']);
  assert.deepEqual(r.sources.default.removed, []);
});

test('effectiveItems 는 매니페스트에 없는 출처의 개인 항목을 sources 가 아닌 orphans 에 둔다', () => {
  const l = { version: 1, sources: { gone: { add: ['rules/x'], remove: ['skills/y'] } } };
  const r = effectiveItems(manifest(), l);
  assert.deepEqual(Object.keys(r.sources), ['default']);
  assert.deepEqual(r.orphans, { gone: { add: ['rules/x'], remove: ['skills/y'] } });
  assert.deepEqual(r.sources.default.items, ['rules/base', 'rules/browser']);
  assert.deepEqual(effectiveItems(manifest(), { version: 1, sources: {} }).orphans, {});
  const both = effectiveItems(manifest(), { version: 1, sources: { default: { add: ['skills/x'], remove: [] }, ...l.sources } });
  assert.deepEqual(Object.keys(both.orphans), ['gone']);
});

test('readLocal 은 v1 을 roles 없는 v2 로 읽는다', t => {
  const store = tmpDir('guideline-local-');
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  fs.writeFileSync(path.join(store, 'local.json'), JSON.stringify({ version: 1, sources: { a: { add: ['rules/b', 'rules/a'], remove: [] } } }));
  assert.deepEqual(readLocal(store), { version: 2, sources: { a: { add: ['rules/a', 'rules/b'], remove: [] } }, roles: {} });
});

test('writeLocal 은 역할을 정렬해 v2 로 쓴다', t => {
  const store = tmpDir('guideline-local-');
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  writeLocal(store, {
    version: 2,
    sources: {},
    roles: {
      ui: { sources: { z: { add: ['rules/b', 'rules/a'], remove: [] }, a: { add: [], remove: ['rules/x'] } } },
      api: { sources: {} },
    },
  });
  const raw = JSON.parse(fs.readFileSync(path.join(store, 'local.json'), 'utf8'));
  assert.equal(raw.version, 2);
  assert.deepEqual(Object.keys(raw.roles), ['api', 'ui']);
  assert.deepEqual(Object.keys(raw.roles.ui.sources), ['a', 'z']);
  assert.deepEqual(raw.roles.ui.sources.z.add, ['rules/a', 'rules/b']);
  assert.deepEqual(readLocal(store).roles.api, { sources: {} });
});

test('readLocal 은 규칙에 맞지 않는 역할 이름을 LocalError 로 거절한다', t => {
  const store = tmpDir('guideline-local-');
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  fs.writeFileSync(path.join(store, 'local.json'), JSON.stringify({ version: 2, sources: {}, roles: { UI: { sources: {} } } }));
  assert.throws(() => readLocal(store), LocalError);
  fs.writeFileSync(path.join(store, 'local.json'), JSON.stringify({ version: 2, sources: {}, roles: { ui: { sources: { a: { add: 'x', remove: [] } } } } }));
  assert.throws(() => readLocal(store), LocalError);
});
