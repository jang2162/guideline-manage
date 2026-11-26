import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { syncedProject } from './synced.js';
import { MANIFEST, manifestText, readManifest } from '../src/manifest.js';
import { runGit } from '../src/projects.js';
import { personalStore, readLocal } from '../src/personal.js';
import { projectPick } from '../src/commands/project-pick.js';
import { initialChoices } from '../src/selection.js';
import { writeOldLayout } from './old-layout.js';

// pick --recommend … --yes: 폼을 만들지 않고 추천을 폼의 처음 체크 그대로 반영한다.

const FILES = {
  ...SOURCE,
  'rules/extra/00-e.md': `${ALWAYS}# 더함\n`,
  'rules/extra/sub/00-s.md': `${ALWAYS}# 하위\n`,
  'mcp/c7/README.md': '---\nrequires: [rules/extra]\n---\n# c7\n',
};

const commitAll = p => {
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
};

/** 서버와, 그 서버에서 받아 커밋한 git 프로젝트. 폼 요청(POST /api/v1/forms)은 log 에 남는다. */
async function setup(t, { items = ['rules/base', 'skills/s'], required, change } = {}) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: FILES });
  if (change) s.store.commit({ ...META, source: 'import', changes: change });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'read' }).token;
  const p = fs.realpathSync(tmpDir('guideline-pick-yes-'));
  const config = tmpDir('guideline-pick-yes-config-');
  const recDir = tmpDir('guideline-pick-yes-rec-');
  t.after(() => {
    for (const d of [p, config, recDir]) fs.rmSync(d, { recursive: true, force: true });
  });
  runGit(['init', '-q'], p);
  const { manifest } = syncedProject(p, { server: s.base, items, source: FILES });
  if (required) {
    manifest.sources.default.required = required;
    write(p, MANIFEST, manifestText(manifest));
  }
  commitAll(p);
  const log = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if ((init.method ?? 'GET') === 'POST' && u.pathname.startsWith('/api/v1/forms')) log.push(u.pathname);
    return fetch(url, init);
  };
  let n = 0;
  const rec = obj => {
    const f = path.join(recDir, `rec-${n++}.json`);
    fs.writeFileSync(f, JSON.stringify(obj));
    return f;
  };
  const env = { PATH: '', XDG_CONFIG_HOME: config, GUIDELINE_TOKEN: token };
  const forms = () => s.app.store.db.prepare('SELECT COUNT(*) AS n FROM forms').get().n;
  return { s, p, env, fetchImpl, log, rec, forms };
}

const quiet = { pollWait: 1, runRuler: () => 0 };
const noForm = () => assert.fail('--yes 는 폼을 열지 않는다');

test('--yes 는 폼 없이 추천한 블록을 더해 반영한다(의존성과 조상도 폼처럼)', async t => {
  const { p, env, fetchImpl, log, rec, forms } = await setup(t);
  const e = collect();
  const o = collect();
  const code = await projectPick({
    project: p, env, ...quiet, err: e.out, out: o.out, fetchImpl, open: noForm, yes: true, json: true,
    recommend: rec({ 'rules/extra/sub': '하위가 필요', 'mcp/c7': '문서' }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(log, [], '폼 요청을 보내지 않는다');
  assert.equal(forms(), 0);
  const m = readManifest(p);
  assert.deepEqual(m.sources.default.items, ['mcp/c7', 'rules/base', 'rules/extra', 'rules/extra/sub', 'skills/s']);
  assert.ok(exists(p, '.guideline/rules/extra/sub/00-s.md'));
  assert.ok(exists(p, '.guideline/mcp/c7/README.md'));
  const result = JSON.parse(o.text());
  assert.ok(result.written.includes('.guideline/rules/extra/00-e.md'), o.text());
});

test('--yes 는 추천한 블록이 필요로 하는(requires) 블록도 폼처럼 켠다', async t => {
  const { p, env, fetchImpl, rec } = await setup(t);
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/c7': '' }) }), 0, e.text());
  assert.deepEqual(readManifest(p).sources.default.items, ['mcp/c7', 'rules/base', 'rules/extra', 'skills/s']);
});

test('--yes 는 빼라고 추천한 블록과 그 자손을 빼고 사본을 지운다', async t => {
  const { p, env, fetchImpl, log, rec } = await setup(t, { items: ['rules/base', 'rules/extra', 'rules/extra/sub', 'skills/s'] });
  const e = collect();
  const code = await projectPick({
    project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true,
    recommend: rec({ add: {}, remove: { 'rules/extra': '안 씀', 'skills/s': '' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(log, []);
  assert.deepEqual(readManifest(p).sources.default.items, ['rules/base']);
  assert.ok(!exists(p, '.guideline/rules/extra/00-e.md'));
  assert.ok(!exists(p, '.guideline/rules/extra/sub/00-s.md'));
  assert.ok(!exists(p, '.guideline/skills/s/SKILL.md'));
  assert.ok(exists(p, '.guideline/rules/base/00-a.md'));
});

test('--yes 로 뺀 블록의 사본을 프로젝트에서 고쳤으면 지우지 않고 leftover 할 일', async t => {
  const { p, env, fetchImpl, rec } = await setup(t);
  write(p, '.guideline/skills/s/SKILL.md', '---\nname: s\ndescription: 스\n---\n\n고친 본문\n');
  commitAll(p);
  const o = collect();
  const e = collect();
  const code = await projectPick({
    project: p, env, ...quiet, err: e.out, out: o.out, fetchImpl, open: noForm, yes: true, json: true, recommend: rec({ remove: { 'skills/s': '' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(readManifest(p).sources.default.items, ['rules/base']);
  assert.match(read(p, '.guideline/skills/s/SKILL.md'), /고친 본문/);
  assert.ok(JSON.parse(o.text()).todos.some(x => x.kind === 'leftover' && /skills\/s\/SKILL\.md/.test(x.message)), o.text());
});

test('--yes 는 프로젝트에서 고친 사본을 덮어쓰지 않고 update 처럼 skipped 할 일로 알린다', async t => {
  const changed = `${ALWAYS}# 에이\n\n## 절 하나\n\n원본이 바꾼 본문\n`;
  const { p, env, fetchImpl, rec } = await setup(t, { change: { 'rules/base/00-a.md': changed } });
  write(p, '.guideline/rules/base/00-a.md', `${ALWAYS}# 에이\n\n프로젝트가 고친 본문\n`);
  commitAll(p);
  const o = collect();
  const e = collect();
  const code = await projectPick({
    project: p, env, ...quiet, err: e.out, out: o.out, fetchImpl, open: noForm, yes: true, json: true, recommend: rec({ 'mcp/gl': '' }),
  });
  assert.equal(code, 0, e.text());
  assert.match(read(p, '.guideline/rules/base/00-a.md'), /프로젝트가 고친 본문/);
  const todos = JSON.parse(o.text()).todos;
  assert.ok(todos.some(x => x.kind === 'skipped' && x.item === 'rules/base/00-a.md'), JSON.stringify(todos));
  assert.ok(readManifest(p).sources.default.items.includes('mcp/gl'));
});

test('--yes 로 필수 블록(또는 그것을 품은 스택)을 빼라고 하면 코드 2, 아무것도 쓰지 않는다', async t => {
  const { p, env, fetchImpl, log, rec } = await setup(t, { items: ['rules/extra', 'rules/extra/sub', 'skills/s'], required: ['rules/extra/sub'] });
  commitAll(p);
  const before = read(p, MANIFEST);
  for (const key of ['rules/extra/sub', 'rules/extra']) {
    const e = collect();
    const code = await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ remove: { [key]: '' } }) });
    assert.equal(code, 2, key);
    assert.match(e.text(), /고정 블록\(또는 고정 블록을 품은 스택\)은 빼라고 추천할 수 없음/);
  }
  assert.deepEqual(log, []);
  assert.equal(read(p, MANIFEST), before);
});

test('--yes 는 --recommend 없이, 또는 --new 와 함께면 코드 2', async t => {
  const { p, env, fetchImpl, log, rec } = await setup(t);
  for (const local of [false, true]) {
    const e = collect();
    assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, fetchImpl, open: noForm, yes: true, local }), 2);
    assert.match(e.text(), /--yes 는 추천을 폼 없이 반영하므로 --recommend/);
  }
  const e = collect();
  assert.equal(await projectPick({ newTarget: path.join(p, 'new-one'), env, ...quiet, err: e.out, fetchImpl, open: noForm, yes: true, recommend: rec({ 'skills/s': '' }) }), 2);
  assert.match(e.text(), /--yes 는 --new 와 함께 쓸 수 없음/);
  assert.ok(!fs.existsSync(path.join(p, 'new-one')));
  assert.deepEqual(log, []);
});

test('--yes 는 커밋하지 않은 변경이 있거나 git 밖이면 코드 2, 아무것도 쓰지 않는다', async t => {
  const { p, env, fetchImpl, log, rec } = await setup(t);
  write(p, 'notes.txt', '커밋 안 함\n');
  const before = read(p, MANIFEST);
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/gl': '' }) }), 2);
  assert.match(e.text(), /커밋하지 않은 변경이 있음 — 먼저 커밋한 뒤/);
  assert.equal(read(p, MANIFEST), before);
  assert.ok(!exists(p, '.guideline/mcp/gl/server.json'));
  assert.equal(runGit(['status', '--porcelain'], p).stdout, '?? notes.txt\n');
  // git 밖
  fs.rmSync(path.join(p, '.git'), { recursive: true, force: true });
  const e2 = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e2.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/gl': '' }) }), 2);
  assert.match(e2.text(), /git 저장소 안에 있지 않음/);
  assert.equal(read(p, MANIFEST), before);
  assert.deepEqual(log, []);
});

test('--yes 없는 --recommend 는 빼라는 추천을 폼의 recommendRemove 로 싣고, 더하고 빼는 같은 키는 코드 2', async t => {
  const { s, p, env, fetchImpl, rec } = await setup(t);
  const seen = {};
  const peek = async url => {
    const u = new URL(url);
    const r = await s.req(u.pathname + u.search);
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    seen.data = (await s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json();
    await s.req(`${u.pathname}/cancel`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: s.config.publicUrl.origin, Cookie: cookie } });
  };
  const code = await projectPick({ project: p, env, ...quiet, err: () => {}, out: () => {}, fetchImpl, open: peek, recommend: rec({ add: { 'mcp/gl': '씀' }, remove: { 'skills/s': '안 씀' } }) });
  assert.equal(code, 3);
  assert.deepEqual(seen.data.recommend, { 'mcp/gl': '씀' });
  assert.deepEqual(seen.data.recommendRemove, { 'skills/s': '안 씀' });
  // 폼 화면이 쓰는 처음 체크도 뺀 블록을 끈다
  const init = initialChoices({ items: seen.data.items, catalog: seen.data.catalog, recommend: Object.keys(seen.data.recommend), remove: Object.keys(seen.data.recommendRemove) });
  assert.equal(init.choices['skill:skills/s'].checked, false);
  assert.equal(init.choices['rule:rules/base/00-a.md'].checked, true);
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, fetchImpl, open: noForm, recommend: rec({ add: { 'skills/s': '' }, remove: { 'skills/s': '' } }) }), 2);
  assert.match(e.text(), /더하라고도 빼라고도 추천한 블록: skills\/s/);
});

test('pick --local --yes 는 폼 없이 미리 체크한 개인 선택을 local.json 에 저장하고 기본값은 쓰지 않는다', async t => {
  const { p, env, fetchImpl, log, rec, forms } = await setup(t);
  const store = personalStore({ dir: p, root: p });
  const e = collect();
  const code = await projectPick({
    project: p, local: true, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true,
    recommend: rec({ add: { 'rules/extra/sub': '' }, remove: { 'skills/s': '' } }),
  });
  assert.equal(code, 0, e.text());
  assert.deepEqual(log, []);
  assert.equal(forms(), 0);
  assert.deepEqual(readLocal(store).sources.default, { add: ['rules/extra', 'rules/extra/sub'], remove: ['skills/s'] });
  assert.ok(!fs.existsSync(path.join(env.XDG_CONFIG_HOME, 'guideline', 'defaults.json')), '기본값은 저장하지 않는다');
  assert.equal(runGit(['status', '--porcelain'], p).stdout, '', '커밋되는 파일은 그대로');
  // 역할 겹
  const e2 = collect();
  assert.equal(await projectPick({
    project: p, local: true, role: 'dev', env, ...quiet, err: e2.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/gl': '' }),
  }), 0, e2.text());
  const local = readLocal(store);
  assert.deepEqual(local.roles.dev.sources.default, { add: ['mcp/gl'], remove: [] });
  assert.deepEqual(local.sources.default, { add: ['rules/extra', 'rules/extra/sub'], remove: ['skills/s'] });
  assert.deepEqual(log, []);
});

/** 디렉터리의 모든 파일(.git 빼고) → 내용. */
function snapshot(dir) {
  const out = {};
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === '.git') continue;
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(dir, r)).toString('base64');
    }
  };
  walk('');
  return out;
}

/** 서버와, 그 서버에서 받은 옛 배치(.ruler/<스택>/) 프로젝트(모두 커밋됨). */
async function oldSetup(t) {
  const base = await setup(t);
  const p = fs.realpathSync(tmpDir('guideline-pick-yes-old-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  writeOldLayout(p, { server: base.s.base, source: FILES, items: ['rules/base/00-a.md', 'rules/base/01-b.md', 'rules/base/SETUP.md', 'skills/s'] });
  commitAll(p);
  return { ...base, p };
}

test('옛 배치 프로젝트에서 거절되는 추천은 배치를 옮기기 전에 코드 2, 프로젝트는 그대로(--yes 든 아니든)', async t => {
  const { p, env, fetchImpl, log, rec } = await oldSetup(t);
  const before = snapshot(p);
  const bad = [
    [{ 'rules/nope': '' }, /원본에 없는 추천 블록: rules\/nope/],
    [{ add: { 'rules/extra/sub': '' }, remove: { 'rules/extra': '' } }, /rules\/extra\/sub 를 더하라고 추천했지만 빼라고 추천한 rules\/extra 안에 있음/],
    [{ add: { 'skills/s': '' }, remove: { 'skills/s': '' } }, /더하라고도 빼라고도 추천한 블록: skills\/s/],
  ];
  for (const yes of [false, true]) {
    for (const [obj, msg] of bad) {
      const e = collect();
      assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes, recommend: rec(obj) }), 2, JSON.stringify(obj));
      assert.match(e.text(), msg);
      assert.deepEqual(snapshot(p), before, `옮기지 않는다: ${JSON.stringify(obj)} yes=${yes}`);
    }
  }
  assert.equal(runGit(['status', '--porcelain'], p).stdout, '');
  assert.deepEqual(log, []);
});

test('옛 배치 프로젝트에서 --yes 는 배치를 옮기고 추천을 반영한다', async t => {
  const { p, env, fetchImpl, log, rec } = await oldSetup(t);
  const e = collect();
  const code = await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/gl': '' }) });
  assert.equal(code, 0, e.text());
  assert.deepEqual(log, []);
  assert.deepEqual(readManifest(p).sources.default.items, ['mcp/gl', 'rules/base', 'skills/s']);
  assert.ok(exists(p, '.guideline/rules/base/00-a.md'));
  assert.ok(exists(p, '.guideline/mcp/gl/server.json'));
});

test('별칭이 걸린 출처: --yes 는 실제 이름으로 받은 추천을 별칭 자리에 반영하고 매니페스트에는 실제 이름을 쓴다', async t => {
  const { p, env, fetchImpl, rec } = await setup(t, { items: ['rules/base', 'skills/s'] });
  const m = readManifest(p);
  m.sources.default.aliases = { 'rules/extra': 'my-extra' };
  write(p, MANIFEST, manifestText(m));
  commitAll(p);
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'rules/extra/sub': '' }) }), 0, e.text());
  assert.deepEqual(readManifest(p).sources.default.items, ['rules/base', 'rules/extra', 'rules/extra/sub', 'skills/s']);
  assert.ok(exists(p, '.guideline/rules/my-extra/00-e.md'));
  assert.ok(exists(p, '.guideline/rules/my-extra/sub/00-s.md'));
  assert.ok(!exists(p, '.guideline/rules/extra/00-e.md'));
  commitAll(p);
  const e2 = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e2.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ remove: { 'rules/extra': '' } }) }), 0, e2.text());
  assert.deepEqual(readManifest(p).sources.default.items, ['rules/base', 'skills/s']);
  assert.ok(!exists(p, '.guideline/rules/my-extra/00-e.md'));
  // 별칭 이름(가상 이름)은 원본의 키가 아니다
  commitAll(p);
  const e3 = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e3.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'rules/my-extra': '' }) }), 2);
  assert.match(e3.text(), /원본에 없는 추천 블록: rules\/my-extra/);
});

test('출처가 여럿이면 --yes --source 는 그 출처만 바꾸고 다른 출처는 그대로 둔다', async t => {
  const { s, p, env, fetchImpl, log, rec } = await setup(t);
  const { manifest } = syncedProject(p, {
    sources: {
      a: { server: s.base, items: ['rules/base'], tree: FILES },
      b: { server: s.base, items: ['skills/s'], aliases: { 'skills/s': 'b-s' }, tree: FILES },
    },
  });
  write(p, MANIFEST, manifestText(manifest));
  fs.rmSync(path.join(p, '.guideline/skills/s'), { recursive: true, force: true });
  commitAll(p);
  const noSource = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: noSource.out, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/gl': '' }) }), 2);
  assert.match(noSource.text(), /--source <이름>/);
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true, source: 'b', recommend: rec({ 'mcp/gl': '' }) }), 0, e.text());
  const m = readManifest(p);
  assert.deepEqual(m.sources.a.items, ['rules/base']);
  assert.deepEqual(m.sources.b.items, ['mcp/gl', 'skills/s']);
  assert.ok(exists(p, '.guideline/skills/b-s/SKILL.md'));
  assert.ok(exists(p, '.guideline/rules/base/00-a.md'));
  assert.deepEqual(log, []);
});

test('--yes 는 원본에 없는 .guideline/ 의 파일(고아)을 지우지 않는다', async t => {
  const { p, env, fetchImpl, rec } = await setup(t);
  write(p, '.guideline/skills/mine/SKILL.md', '---\nname: mine\ndescription: 내 것\n---\n\n본문\n');
  commitAll(p);
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/gl': '' }) }), 0, e.text());
  assert.ok(exists(p, '.guideline/skills/mine/SKILL.md'));
  assert.ok(readManifest(p).sources.default.items.includes('mcp/gl'));
});

test('--yes 에서 반영할 수 없는(blocked) 원본 파일은 그대로 반영하지 않고 할 일로 남는다', async t => {
  const { p, env, fetchImpl, rec } = await setup(t, { change: { 'rules/base/07-x.md': '# 틀 없는 지침\n' } });
  const o = collect();
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: o.out, json: true, fetchImpl, open: noForm, yes: true, recommend: rec({ 'mcp/gl': '' }) }), 0, e.text());
  assert.ok(!exists(p, '.guideline/rules/base/07-x.md'));
  assert.ok(exists(p, '.guideline/rules/base/00-a.md'));
  assert.ok(readManifest(p).sources.default.items.includes('rules/base'));
  assert.ok(JSON.parse(o.text()).todos.some(x => x.kind === 'blocked' && x.item === 'rules/base/07-x.md'), o.text());
});

test('--local 도 더하고 빼는 같은 키, 빼라는 스택 안을 더하라는 키는 폼을 만들지 않고 코드 2(--yes 든 아니든)', async t => {
  const { p, env, fetchImpl, log, rec, forms } = await setup(t);
  const store = personalStore({ dir: p, root: p });
  for (const yes of [false, true]) {
    const both = collect();
    assert.equal(await projectPick({ project: p, local: true, env, ...quiet, err: both.out, fetchImpl, open: noForm, yes, recommend: rec({ add: { 'mcp/gl': '' }, remove: { 'mcp/gl': '' } }) }), 2);
    assert.match(both.text(), /더하라고도 빼라고도 추천한 블록: mcp\/gl/);
    const inside = collect();
    assert.equal(await projectPick({ project: p, local: true, env, ...quiet, err: inside.out, fetchImpl, open: noForm, yes, recommend: rec({ add: { 'rules/extra/sub': '' }, remove: { 'rules/extra': '' } }) }), 2);
    assert.match(inside.text(), /rules\/extra\/sub 를 더하라고 추천했지만 빼라고 추천한 rules\/extra 안에 있음/);
  }
  assert.ok(!fs.existsSync(path.join(store, 'local.json')));
  assert.equal(forms(), 0);
  assert.deepEqual(log, []);
});

test('프로젝트 모드도 빼라는 스택 안을 더하라는 키는 폼을 만들지 않고 코드 2', async t => {
  const { p, env, fetchImpl, log, rec, forms } = await setup(t);
  for (const yes of [false, true]) {
    const e = collect();
    assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, fetchImpl, open: noForm, yes, recommend: rec({ add: { 'rules/extra/sub': '' }, remove: { 'rules/extra': '' } }) }), 2);
    assert.match(e.text(), /rules\/extra\/sub 를 더하라고 추천했지만 빼라고 추천한 rules\/extra 안에 있음/);
  }
  assert.equal(forms(), 0);
  assert.deepEqual(log, []);
});
