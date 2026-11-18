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

test('personalStore 는 워크트리마다 같은 공용 디렉터리를 쓴다', t => {
  const { main, wt } = repoWithWorktree(t);
  const common = path.join(main, '.git');
  assert.equal(personalStore({ dir: main, root: main }), path.join(common, 'guideline', 'units', '_root'));
  assert.equal(personalStore({ dir: wt, root: wt }), path.join(common, 'guideline', 'units', '_root'));
  fs.mkdirSync(path.join(main, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(wt, 'a', 'b'), { recursive: true });
  assert.equal(personalStore({ dir: path.join(main, 'a', 'b'), root: main }), path.join(common, 'guideline', 'units', 'a__b'));
  assert.equal(personalStore({ dir: path.join(wt, 'a', 'b'), root: wt }), path.join(common, 'guideline', 'units', 'a__b'));
});

test('personalStore 는 git 저장소가 아니면 null', t => {
  const dir = fs.realpathSync(tmpDir('guideline-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(personalStore({ dir, root: dir }), null);
});

test('readLocal 은 파일이 없으면 빈 개인 선택, writeLocal 은 정렬해 쓰고 되읽는다', t => {
  const store = path.join(tmpDir('guideline-local-'), 'units', '_root');
  t.after(() => fs.rmSync(path.dirname(path.dirname(store)), { recursive: true, force: true }));
  assert.deepEqual(readLocal(store), { version: 1, sources: {} });
  writeLocal(store, { version: 1, sources: { b: { add: ['skills/z', 'rules/a', 'rules/a'], remove: [] }, a: { add: [], remove: ['rules/x'] } } });
  const onDisk = JSON.parse(fs.readFileSync(path.join(store, 'local.json'), 'utf8'));
  assert.deepEqual(Object.keys(onDisk.sources), ['a', 'b']);
  assert.deepEqual(onDisk.sources.b.add, ['rules/a', 'skills/z']);
  assert.deepEqual(readLocal(store).sources.a, { add: [], remove: ['rules/x'] });
});

test('readLocal 은 깨진 파일을 LocalError 로 거절한다', t => {
  const store = tmpDir('guideline-local-');
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  for (const bad of ['{', '{"version":2,"sources":{}}', '{"version":1,"sources":{"a":{"add":["rules/a/00-x.md"],"remove":[]}}}', '{"version":1,"sources":{"a":{"add":"rules/a","remove":[]}}}']) {
    fs.writeFileSync(path.join(store, 'local.json'), bad);
    assert.throws(() => readLocal(store), LocalError, bad);
  }
});

const manifest = (src = {}) => ({
  version: 3, form: 'ruler', agents: ['claude'],
  sources: { default: { server: 'https://s', items: ['rules/base', 'rules/browser'], aliases: {}, required: [], ...src } },
});
const local = (name, v) => ({ version: 1, sources: { [name]: { add: [], remove: [], ...v } } });

test('effectiveItems 는 더함·뺌·필수를 적용하고 더한 하위 스택의 조상을 채운다', () => {
  const m = manifest({ required: ['rules/base'] });
  const r = effectiveItems(m, local('default', { add: ['rules/browser/neo'], remove: ['rules/base', 'rules/browser'] }));
  assert.deepEqual(r.sources.default, {
    items: ['rules/base'],
    added: ['rules/browser/neo'],
    removed: ['rules/browser'],
    ignored: ['rules/base'],
  });
});

test('effectiveItems 는 더한 것이 있으면 조상 스택을 함께 남긴다', () => {
  const r = effectiveItems(manifest(), local('default', { add: ['rules/browser/neo', 'rules/other/sub', 'skills/x'] }));
  assert.deepEqual(r.sources.default.items, ['rules/base', 'rules/browser', 'rules/browser/neo', 'rules/other', 'rules/other/sub', 'skills/x']);
  assert.deepEqual(r.sources.default.added, ['rules/browser/neo', 'rules/other/sub', 'skills/x']);
});

test('effectiveItems 는 뺀 스택의 자손도 뺀다', () => {
  const m = manifest({ items: ['rules/browser', 'rules/browser/neo', 'rules/browserx'] });
  const r = effectiveItems(m, local('default', { remove: ['rules/browser'] }));
  assert.deepEqual(r.sources.default.items, ['rules/browserx']);
  assert.deepEqual(r.sources.default.removed, ['rules/browser']);
});

test('effectiveItems 는 필수의 조상을 빼려는 것도 무시한다', () => {
  const m = manifest({ items: ['rules/a', 'rules/a/b'], required: ['rules/a/b'] });
  const r = effectiveItems(m, local('default', { remove: ['rules/a'] }));
  assert.deepEqual(r.sources.default.items, ['rules/a', 'rules/a/b']);
  assert.deepEqual(r.sources.default.ignored, ['rules/a']);
  assert.deepEqual(r.sources.default.removed, []);
});

test('effectiveItems 는 매니페스트에 없는 출처의 개인 항목을 버리고 ignored 에 둔다', () => {
  const l = { version: 1, sources: { gone: { add: ['rules/x'], remove: ['skills/y'] } } };
  const r = effectiveItems(manifest(), l);
  assert.deepEqual(r.sources.gone, { items: [], added: [], removed: [], ignored: ['rules/x', 'skills/y'] });
  assert.deepEqual(r.sources.default.items, ['rules/base', 'rules/browser']);
});
