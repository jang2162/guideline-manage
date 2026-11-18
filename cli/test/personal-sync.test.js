import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect, ALWAYS } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { syncedProject } from './synced.js';
import { memoryTree } from '../src/tree.js';
import { MANIFEST, LOCK, manifestText, readLock, readManifest, checkManifest } from '../src/manifest.js';
import { runGit } from '../src/projects.js';
import { personalStore, writeLocal } from '../src/personal.js';
import { syncPersonal, personalTargets } from '../src/personal-sync.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { projectPick } from '../src/commands/project-pick.js';
import { propose } from '../src/commands/propose.js';

// 개인 저장소는 임시 git 저장소의 공용 디렉터리에 둔다(이 저장소 자신의 .git 은 건드리지 않는다)

const EXTRA = {
  'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n`,
  'rules/extra/sub/00-s.md': `${ALWAYS}# 하위\n`,
};

const commitAll = p => {
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
};
const porcelain = p => runGit(['status', '--porcelain', '--untracked-files=all'], p).stdout;
const excludeText = p => {
  try {
    return fs.readFileSync(path.join(p, '.git', 'info', 'exclude'), 'utf8');
  } catch {
    return '';
  }
};

/** 서버(원본에 rules/extra 와 그 하위 스택)와, 그 서버에서 rules/base 를 받아 커밋한 git 프로젝트. */
async function setup(t, scope = 'read') {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: { ...SOURCE, ...EXTRA } });
  const token = s.tokens.issue({ name: 'cli-t', scope }).token;
  const p = fs.realpathSync(tmpDir('guideline-personal-sync-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  syncedProject(p, { server: s.base, items: ['rules/base'], source: { ...SOURCE, ...EXTRA } });
  commitAll(p);
  const store = personalStore({ dir: p, root: p });
  return { s, p, store, env: { GUIDELINE_TOKEN: token, PATH: '' } };
}

async function update(p, env) {
  const o = collect();
  const code = await projectUpdate({ project: p, env, json: true, out: o.out, err: () => {}, runRuler: () => 0 });
  return { code, ...JSON.parse(o.text()) };
}

const lockIds = store => Object.keys(readLock(store)?.sources ?? {}).sort();

test('update 는 개인 더함의 사본을 공용 저장소에 받는다', async t => {
  const { p, store, env } = await setup(t);
  const gi = read(p, '.gitignore');
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  const r = await update(p, env);
  assert.equal(r.code, 0);
  // 개인 사본과 개인 잠금은 공용 저장소에, 프로젝트 .guideline/ 에는 없다
  assert.equal(read(store, '.guideline/rules/extra/00-e.md'), EXTRA['rules/extra/00-e.md']);
  assert.equal(exists(store, '.guideline/rules/extra/sub/00-s.md'), false);
  assert.deepEqual(lockIds(store), ['default:rules/extra/00-e.md']);
  assert.equal(readLock(store).revisions.default, 1);
  assert.equal(exists(p, '.guideline/rules/extra'), false);
  // 그다음 조합이 개인 사본으로 생성물을 만든다. 커밋되는 파일은 그대로다
  assert.ok(r.written.includes('.ruler/extra/00-e.md'));
  assert.equal(read(p, '.gitignore'), gi);
  assert.match(excludeText(p), /^\/\.ruler\/extra\/00-e\.md$/m);
  assert.equal(porcelain(p), '');
  // 개인 사본은 고치는 자리가 아니다 — 고쳐 두어도 다음 update 가 원본으로 덮는다
  write(store, '.guideline/rules/extra/00-e.md', `${ALWAYS}# 손댐\n`);
  const again = await update(p, env);
  assert.equal(read(store, '.guideline/rules/extra/00-e.md'), EXTRA['rules/extra/00-e.md']);
  assert.equal(again.todos.some(x => x.kind === 'skipped'), false);
});

test('프로젝트 모드 pick 도 반영 뒤 개인 사본을 받는다', async t => {
  const { s, p, store, env } = await setup(t);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  const code = await projectPick({
    project: p, env, err: () => {}, out: () => {}, pollWait: 1, runRuler: () => 0,
    open: async url => {
      const u = new URL(url);
      const r = await s.req(u.pathname + u.search);
      const cookie = r.headers['set-cookie'][0].split(';')[0];
      const data = (await s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json();
      const choices = Object.fromEntries(data.items.map(i => [`${i.kind}:${i.id}`, { checked: i.id.startsWith('rules/base/'), update: false }]));
      await s.req(`${u.pathname}/submit`, {
        method: 'POST', body: JSON.stringify({ choices, force: true }),
        headers: { 'Content-Type': 'application/json', Origin: s.config.publicUrl.origin, Cookie: cookie },
      });
    },
  });
  assert.equal(code, 0);
  assert.equal(read(store, '.guideline/rules/extra/00-e.md'), EXTRA['rules/extra/00-e.md']);
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.equal(porcelain(p), '');
});

test('개인으로 더한 하위 스택만 있어도 프로젝트에 없는 조상 스택의 사본을 받고 조합에 넣는다', async t => {
  const { p, store, env } = await setup(t);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra/sub'], remove: [] } } });
  assert.deepEqual(personalTargets(readManifest(p), { version: 1, sources: { default: { add: ['rules/extra/sub'], remove: [] } } }),
    { default: ['rules/extra', 'rules/extra/sub'] });
  // 조상을 프로젝트가 이미 골랐으면 그 사본은 프로젝트 .guideline/ 에 있다 — 개인으로 받지 않는다
  const withExtra = checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://x', items: ['rules/extra'] } } });
  assert.deepEqual(personalTargets(withExtra, { version: 1, sources: { default: { add: ['rules/extra/sub'], remove: [] } } }),
    { default: ['rules/extra/sub'] });
  const r = await update(p, env);
  assert.equal(r.code, 0);
  assert.deepEqual(lockIds(store), ['default:rules/extra/00-e.md', 'default:rules/extra/sub/00-s.md']);
  // 조상 스택의 규칙도 조합에 들어간다(그 사본은 개인 저장소에만 있다)
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.match(read(p, '.ruler/extra/sub/00-s.md'), /# 하위/);
  assert.equal(porcelain(p), '');
});

test('프로젝트가 같은 블록을 고르면 개인 사본은 물러난다', async t => {
  const { p, store, env } = await setup(t);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  await update(p, env);
  assert.ok(exists(store, '.guideline/rules/extra/00-e.md'));
  // 프로젝트도 extra 를 고른다(개인 선택은 그대로 남아 있다)
  const m = readManifest(p);
  m.sources.default.items = [...m.sources.default.items, 'rules/extra'];
  write(p, MANIFEST, manifestText(m));
  const r = await update(p, env);
  assert.equal(r.code, 0);
  // 개인 사본·잠금 항목은 지워지고 프로젝트 사본이 이긴다
  assert.equal(exists(store, '.guideline/rules/extra/00-e.md'), false);
  assert.deepEqual(lockIds(store), []);
  assert.equal(read(p, '.guideline/rules/extra/00-e.md'), EXTRA['rules/extra/00-e.md']);
  // 조합 결과는 하나: 프로젝트 생성물이라 .gitignore 블록에 있고 개인 exclude 블록에는 없다
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.match(read(p, '.gitignore'), /^\/\.ruler\/extra\/00-e\.md$/m);
  assert.doesNotMatch(excludeText(p), /extra/);
});

test('update 는 개인 사본 쓰기에 실패해도 프로젝트 반영을 마치고 할 일로 알린다', async t => {
  const { s, p, store, env } = await setup(t);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  // .guideline 자리에 파일이 있어 사본을 쓸 수 없다
  write(store, '.guideline', 'x');
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n` } });
  const r = await update(p, env);
  assert.equal(r.code, 0);
  assert.match(read(p, '.guideline/rules/base/00-a.md'), /새 본문/);
  assert.equal(JSON.parse(read(p, LOCK)).revisions.default, 2);
  const todo = r.todos.find(x => x.kind === 'personal-sync');
  assert.ok(todo, JSON.stringify(r.todos));
  assert.match(todo.message, /^개인 사본\(.+\)을 받지 못함: .+ — 프로젝트 반영은 끝남, guideline update 다시 실행$/);
});

test('개인 선택이 비어 있고 개인 잠금도 없으면 update 는 개인 저장소를 만들지 않는다', async t => {
  const { p, store, env } = await setup(t);
  const r = await update(p, env);
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(store), false);
});

test('syncPersonal 은 받지 못한 출처의 개인 사본·잠금을 그대로 두고, 매니페스트에서 빠진 출처의 것은 지운다', t => {
  const store = tmpDir('guideline-personal-store-');
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  const manifest = checkManifest({
    version: 3, form: 'ruler', agents: ['claude'],
    sources: { a: { server: 'http://a', items: ['rules/base'] }, b: { server: 'http://b', items: ['rules/base'], aliases: { 'rules/base': 'bb' } } },
  });
  const tree = memoryTree({ ...SOURCE, ...EXTRA });
  const both = new Map([['a', { server: 'http://a', revision: 3, tree }], ['b', { server: 'http://b', revision: 5, tree }]]);
  const local = { version: 1, sources: { a: { add: ['rules/extra'], remove: [] }, b: { add: ['skills/s'], remove: [] } } };
  const write1 = r => {
    for (const [k, v] of Object.entries(r.files)) {
      if (v === null) fs.rmSync(path.join(store, k));
      else write(store, k, v);
    }
    write(store, LOCK, JSON.stringify(r.lock));
  };
  write1(syncPersonal({ store, manifest, local, trees: both, revisions: { a: 3, b: 5 } }));
  assert.ok(exists(store, '.guideline/rules/extra/00-e.md'));
  assert.ok(exists(store, '.guideline/skills/s/SKILL.md'));
  // b 를 받지 못함: b 의 사본은 지우지 않고 잠금 항목·리비전을 옮긴다
  const onlyA = new Map([['a', both.get('a')]]);
  const r = syncPersonal({ store, manifest, local, trees: onlyA, revisions: { a: 4 } });
  assert.equal(Object.keys(r.files).some(f => f.startsWith('.guideline/skills/')), false);
  assert.deepEqual(r.lock.revisions, { a: 4, b: 5 });
  assert.ok(Object.keys(r.lock.sources).includes('b:skills/s'));
  // b 가 매니페스트에서 빠짐: 그 개인 사본은 지운다
  const noB = { ...manifest, sources: { a: manifest.sources.a } };
  const gone = syncPersonal({ store, manifest: noB, local, trees: onlyA, revisions: { a: 4 } });
  assert.equal(gone.files['.guideline/skills/s/SKILL.md'], null);
  assert.equal(Object.keys(gone.lock.sources).some(q => q.startsWith('b:')), false);
});

test('propose 는 개인 사본을 보내지 않는다', async t => {
  const { s, p, store, env } = await setup(t, 'propose');
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  await update(p, env);
  // 개인 사본을 고쳐도(고치지 않는 자리지만) propose 는 단위의 .guideline/ 만 본다
  write(store, '.guideline/rules/extra/00-e.md', `${ALWAYS}# 개인 더함\n\n고침\n`);
  const o = collect();
  assert.equal(await propose({ project: p, env, json: true, out: o.out, err: () => {} }), 0);
  assert.deepEqual(JSON.parse(o.text()).changes, []);
  assert.equal(s.proposals.list({}).length, 0);
  // 프로젝트 사본을 고치면 그것만 보낸다
  write(p, '.guideline/rules/base/00-a.md', `${ALWAYS}# 에이\n\n고침\n`);
  const d = collect();
  assert.equal(await propose({ project: p, env, json: true, dryRun: true, out: d.out, err: () => {} }), 0);
  assert.deepEqual(JSON.parse(d.text()).changes.map(c => c.path), ['rules/base/00-a.md']);
});
