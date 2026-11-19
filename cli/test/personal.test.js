import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir } from './helpers.js';
import { gitCommonDir } from '../src/projects.js';
import { personalStore, readLocal, writeLocal, effectiveItems, layeredLocal, LocalError } from '../src/personal.js';

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

const twoSources = () => ({
  version: 3, form: 'ruler', agents: ['claude'],
  sources: {
    a: { server: 'https://s', items: ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x'], aliases: {}, required: ['rules/base/sec'] },
    b: { server: 'https://t', items: ['rules/tool'], aliases: {}, required: [] },
  },
});
const v2 = (sources, roles = {}) => ({ version: 2, sources, roles });
const ls = (add = [], remove = []) => ({ add, remove });

test('펼친 선택은 세 겹 결과와 같다', () => {
  const m = twoSources();
  const cases = [
    {
      why: '공통 더함 + 역할 뺌',
      local: v2({ a: ls(['rules/web/ui', 'skills/y']) }, { dev: { sources: { a: ls([], ['skills/y', 'skills/x']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/web', 'rules/web/ui'], b: ['rules/tool'] },
    },
    {
      why: '공통 뺌 + 역할 다시 더함',
      local: v2({ a: ls([], ['rules/web']), b: ls([], ['rules/tool']) }, { dev: { sources: { a: ls(['rules/web']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x'], b: [] },
    },
    {
      why: '역할이 하위 스택만 더함',
      local: v2({}, { dev: { sources: { a: ls(['rules/new/deep/er']), b: ls(['rules/tool/sub']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/new', 'rules/new/deep', 'rules/new/deep/er', 'rules/web', 'skills/x'], b: ['rules/tool', 'rules/tool/sub'] },
    },
    {
      why: '역할이 필수를 빼려 함',
      local: v2({}, { dev: { sources: { a: ls([], ['rules/base', 'rules/base/sec', 'rules/web']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'skills/x'], b: ['rules/tool'] },
    },
    {
      why: '공통이 뺀 부모 아래를 역할이 더함',
      local: v2({ a: ls([], ['rules/web']) }, { dev: { sources: { a: ls(['rules/web/ui']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/web', 'rules/web/ui', 'skills/x'], b: ['rules/tool'] },
    },
    {
      why: '역할이 공통 더함의 부모를 뺌',
      local: v2({ a: ls(['rules/web/ui/x', 'rules/new/a']) }, { dev: { sources: { a: ls(['rules/new/b'], ['rules/web/ui', 'rules/new']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x'], b: ['rules/tool'] },
    },
    {
      why: '역할이 공통 하위 스택만 뺌(자동 조상은 남음)',
      local: v2({ a: ls(['rules/web/ui', 'rules/new/ui']) }, { dev: { sources: { a: ls([], ['rules/web/ui', 'rules/new/ui']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/new', 'rules/web', 'skills/x'], b: ['rules/tool'] },
    },
    {
      why: '역할이 공통 하위 스택과 그 부모를 뺌',
      local: v2({ a: ls(['rules/new/ui/deep']) }, { dev: { sources: { a: ls([], ['rules/new/ui']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/new', 'rules/web', 'skills/x'], b: ['rules/tool'] },
    },
    {
      why: '매니페스트에 없는 출처(고아)',
      local: v2({ gone: ls(['rules/z']) }, { dev: { sources: { gone: ls(['rules/q']), a: ls(['skills/z']) } } }),
      want: { a: ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x', 'skills/z'], b: ['rules/tool'] },
    },
  ];
  for (const c of cases) {
    const r = layeredLocal(m, c.local, 'dev');
    assert.equal(r.roleDefined, true, c.why);
    assert.deepEqual(r.flat.roles, {}, c.why);
    const flat = effectiveItems(m, r.flat);
    for (const name of Object.keys(m.sources)) {
      assert.deepEqual(r.role.sources[name].items, c.want[name], `${c.why}: 세 겹 ${name}`);
      assert.deepEqual(flat.sources[name].items, c.want[name], `${c.why}: 펼침 ${name}`);
      // 펼친 더함은 겹이 명시한 키뿐이다(자동으로 채운 조상은 넣지 않는다)
      assert.deepEqual(flat.sources[name].added, r.flat.sources[name].add, `${c.why}: 펼친 added ${name}`);
    }
    assert.deepEqual(flat.orphans, r.common.orphans, `${c.why}: 고아`);
  }
});

test('펼친 더함에는 자동으로 채운 조상을 넣지 않는다', () => {
  const r = layeredLocal(twoSources(), v2({}, { dev: { sources: { a: ls(['rules/new/deep']) } } }), 'dev');
  assert.deepEqual(r.flat.sources.a, { add: ['rules/new/deep'], remove: [] });
  assert.deepEqual(r.role.sources.a.added, ['rules/new/deep']);
});

test('역할이 공통의 하위 스택만 빼면 공통이 채운 조상은 남는다', () => {
  const m = twoSources();
  const r = layeredLocal(m, v2({ a: ls(['rules/web/ui', 'rules/new/ui']) }, { dev: { sources: { a: ls([], ['rules/web/ui', 'rules/new/ui']) } } }), 'dev');
  assert.deepEqual(r.common.sources.a.items, ['rules/base', 'rules/base/sec', 'rules/new', 'rules/new/ui', 'rules/web', 'rules/web/ui', 'skills/x']);
  // 역할 겹의 기준은 공통 결과 그대로(자동 조상 포함)라 rules/new 는 남는다 — 역할 폼이 「받음」 으로 보인 그대로
  assert.deepEqual(r.role.sources.a.items, ['rules/base', 'rules/base/sec', 'rules/new', 'rules/web', 'skills/x']);
  assert.deepEqual(effectiveItems(m, r.flat).sources.a.items, r.role.sources.a.items);
  // 펼친 선택은 하위가 빠져 다시 채워지지 않는 조상을 명시 더함으로 싣는다
  assert.deepEqual(r.flat.sources.a, { add: ['rules/new'], remove: [] });
  // 부모도 빼려면 역할이 부모를 뺀다
  const both = layeredLocal(m, v2({ a: ls(['rules/new/ui']) }, { dev: { sources: { a: ls([], ['rules/new']) } } }), 'dev');
  assert.deepEqual(both.role.sources.a.items, ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x']);
  assert.deepEqual(both.flat.sources.a, { add: [], remove: [] });
});

test('역할 정의는 공통 선택이 바뀌면 따라간다(고르지 않은 조상을 적지 않는다)', () => {
  // 리뷰 반례: 공통이 rules/extra/sub 를 더하고 역할이 그 하위만 뺀다. 나중에 공통에서 더함을 지우면 역할 워크트리에서도 rules/extra 가 사라진다
  const m = twoSources();
  const roles = { dev: { sources: { a: ls([], ['rules/extra/sub']) } } };
  const before = layeredLocal(m, v2({ a: ls(['rules/extra/sub']) }, roles), 'dev');
  assert.ok(before.role.sources.a.items.includes('rules/extra'));
  assert.ok(!before.role.sources.a.items.includes('rules/extra/sub'));
  const after = layeredLocal(m, v2({}, roles), 'dev');
  assert.deepEqual(after.role.sources.a.items, ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x']);
  assert.deepEqual(effectiveItems(m, after.flat).sources.a.items, after.role.sources.a.items);
});

test('역할은 필수와 그 조상을 못 뺀다', () => {
  const m = twoSources();
  const r = layeredLocal(m, v2({}, { dev: { sources: { a: ls([], ['rules/base', 'rules/base/sec']) } } }), 'dev');
  assert.equal(r.role.sources.a.ignoredWhy['rules/base'], 'required');
  assert.equal(r.role.sources.a.ignoredWhy['rules/base/sec'], 'required');
  assert.deepEqual(r.role.sources.a.items, ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x']);
  assert.deepEqual(effectiveItems(m, r.flat).sources.a.items, r.role.sources.a.items);
});

test('정의 없는 역할과 역할 없음은 공통만 쓴다', () => {
  const m = twoSources();
  const l = v2({ a: ls(['rules/web/ui'], ['skills/x']), gone: ls(['rules/z']) }, { other: { sources: { a: ls(['skills/q']) } } });
  for (const role of ['dev', null]) {
    const r = layeredLocal(m, l, role);
    assert.equal(r.roleDefined, false);
    assert.equal(r.role, null);
    assert.deepEqual(r.flat, { version: 2, sources: l.sources, roles: {} });
    assert.deepEqual(r.common, effectiveItems(m, l));
    assert.deepEqual(effectiveItems(m, r.flat), r.common);
  }
  // 프로토타입 이름은 정의된 역할이 아니다
  assert.equal(layeredLocal(m, l, 'constructor').roleDefined, false);
});

test('역할 겹은 공통 결과를 기준으로 계산한다', () => {
  const m = twoSources();
  const r = layeredLocal(m, v2({ a: ls(['skills/y'], ['skills/x']) }, { dev: { sources: { a: ls(['skills/x']) } } }), 'dev');
  // 공통이 뺀 skills/x 를 역할이 다시 더하면 역할 겹의 added 다(기준에 없다)
  assert.deepEqual(r.role.sources.a.added, ['skills/x']);
  assert.deepEqual(r.role.sources.a.items, ['rules/base', 'rules/base/sec', 'rules/web', 'skills/x', 'skills/y']);
  // 프로젝트가 고른 것으로 되돌아오므로 펼친 선택에서는 더함도 뺌도 아니다
  assert.deepEqual(r.flat.sources.a, { add: ['skills/y'], remove: [] });
});
