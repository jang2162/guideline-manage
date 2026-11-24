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
    assert.match(e.text(), /필수 블록\(또는 필수를 품은 스택\)은 빼라고 추천할 수 없음/);
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
