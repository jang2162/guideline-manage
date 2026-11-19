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
import { personalStore, writeLocal, readLocal } from '../src/personal.js';
import { syncPersonal, personalTargets } from '../src/personal-sync.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { projectPick } from '../src/commands/project-pick.js';
import { propose } from '../src/commands/propose.js';
import { projectApply } from '../src/commands/project-apply.js';
import { projectStatus } from '../src/commands/project-status.js';
import { saveToken } from '../src/credentials.js';

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
  // 조상을 이 워크트리의 프로젝트가 이미 골라도 받는다 — 개인 저장소는 프로젝트 선택이 다른 브랜치의 워크트리와 함께 쓴다
  // (이 워크트리의 조합은 그 조상을 프로젝트 사본에서 읽는다)
  const withExtra = checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://x', items: ['rules/extra'] } } });
  assert.deepEqual(personalTargets(withExtra, { version: 1, sources: { default: { add: ['rules/extra/sub'], remove: [] } } }),
    { default: ['rules/extra', 'rules/extra/sub'] });
  const r = await update(p, env);
  assert.equal(r.code, 0);
  assert.deepEqual(lockIds(store), ['default:rules/extra/00-e.md', 'default:rules/extra/sub/00-s.md']);
  // 조상 스택의 규칙도 조합에 들어간다(그 사본은 개인 저장소에만 있다)
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.match(read(p, '.ruler/extra/sub/00-s.md'), /# 하위/);
  assert.equal(porcelain(p), '');
});

test('프로젝트가 같은 블록을 고르면 조합은 프로젝트 사본을 쓰고, 개인 사본은 local.json 에서 빠질 때만 지운다', async t => {
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
  // 개인 사본·잠금 항목은 남는다(그 블록을 고르지 않은 브랜치의 워크트리가 쓴다). 조합은 프로젝트 사본이 이긴다
  assert.ok(exists(store, '.guideline/rules/extra/00-e.md'));
  assert.deepEqual(lockIds(store), ['default:rules/extra/00-e.md']);
  assert.equal(read(p, '.guideline/rules/extra/00-e.md'), EXTRA['rules/extra/00-e.md']);
  // 조합 결과는 하나: 프로젝트 생성물이라 .gitignore 블록에 있고 개인 exclude 블록에는 없다
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.match(read(p, '.gitignore'), /^\/\.ruler\/extra\/00-e\.md$/m);
  assert.doesNotMatch(excludeText(p), /extra/);
  assert.equal(r.todos.some(x => x.kind === 'no-copy'), false);
  // local.json 에서 더함이 빠지면 개인 사본·잠금 항목을 지운다
  writeLocal(store, { version: 1, sources: { default: { add: [], remove: [] } } });
  assert.equal((await update(p, env)).code, 0);
  assert.equal(exists(store, '.guideline/rules/extra/00-e.md'), false);
  assert.deepEqual(lockIds(store), []);
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
  // 실패 뒤에도 조합까지 돈다(생성물이 새 원본을 따른다)
  assert.match(read(p, '.ruler/base/00-a.md'), /새 본문/);
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

test('syncPersonal 은 받지 못한 출처·매니페스트에 없는 출처의 개인 사본·잠금을 local.json 에 남은 한 그대로 둔다', t => {
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
  // b 가 이 매니페스트에 없음(다른 브랜치의 매니페스트에만 있는 출처): local.json 에 남아 있으면 그 개인 사본·잠금은 그대로다
  const noB = { ...manifest, sources: { a: manifest.sources.a } };
  const kept = syncPersonal({ store, manifest: noB, local, trees: onlyA, revisions: { a: 4 } });
  assert.equal(Object.keys(kept.files).some(f => f.startsWith('.guideline/skills/')), false);
  assert.ok(Object.keys(kept.lock.sources).includes('b:skills/s'));
  assert.equal(kept.lock.revisions.b, 5);
  // local.json 에서 b 가 빠지면 지운다
  const gone = syncPersonal({ store, manifest: noB, local: { version: 1, sources: { a: local.sources.a } }, trees: onlyA, revisions: { a: 4 } });
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

test('개인 스택의 세팅 할 일은 커밋되는 파일을 바꾸지 말라는 개인 문구로 낸다', async t => {
  const { s, p, store, env } = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/extra/SETUP.md': '# extra 세팅\n' } });
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  const r = await update(p, env);
  assert.equal(r.code, 0);
  const mine = r.todos.filter(x => x.item === 'rules/extra/SETUP.md');
  assert.deepEqual(mine.map(x => [x.kind, x.scope]), [['setup-personal', 'personal']], JSON.stringify(r.todos));
  assert.equal(mine[0].message,
    'extra: 개인 범위로 받은 스택 — 세팅 문서를 따르되 커밋되는 파일은 바꾸지 않고, 바꿔야 하는 단계는 사용자에게 알리기 — docs/guideline/extra/SETUP.md');
  // 일반 세팅 문구(프로젝트에 세팅하라는 지시)는 없다
  assert.equal(r.todos.some(x => x.kind === 'setup' || /세팅 문서대로 세팅/.test(x.message)), false, JSON.stringify(r.todos));
  // 세팅 문서는 개인 생성물이다 — 바뀐 커밋 파일은 원본 리비전이 오른 잠금뿐
  assert.ok(exists(p, 'docs/guideline/extra/SETUP.md'));
  assert.equal(porcelain(p), ' M guideline-lock.json\n');
});

test('개인 사본의 다른 render 할 일도 개인임이 드러난다', async t => {
  const { s, p, store, env } = await setup(t);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  await update(p, env);
  // 개인으로 더한 스택이 원본에서 사라짐 — 해제는 개인 범위 폼에서
  s.store.commit({ ...META, changes: { 'rules/extra/00-e.md': null, 'rules/extra/sub/00-s.md': null } });
  const gone = await update(p, env);
  const up = gone.todos.filter(x => x.kind === 'removed-upstream');
  assert.ok(up.length > 0, JSON.stringify(gone.todos));
  for (const x of up) {
    assert.equal(x.scope, 'personal');
    assert.match(x.message, /: 원본에서 사라짐\(개인으로 더한 블록\) — guideline pick --local 에서 해제$/);
  }
});

test('개인 잠금이 깨졌으면 그 파일을 지우고 update 하라고 알린다', async t => {
  const { p, store, env } = await setup(t);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  write(store, LOCK, '{ broken');
  const r = await update(p, env);
  assert.equal(r.code, 0);
  const todo = r.todos.find(x => x.kind === 'personal-sync');
  assert.ok(todo, JSON.stringify(r.todos));
  assert.match(todo.message, /^개인 잠금\(.+guideline-lock\.json\)을 읽을 수 없음: .+ — 그 파일을 지우고 guideline update$/);
  assert.ok(todo.message.includes(path.join(store, LOCK)));
  // status 도 같은 할 일을 한 번 낸다
  const o = collect();
  await projectStatus({ project: p, env, json: true, out: o.out, err: () => {} });
  const st = JSON.parse(o.text()).todos.filter(x => x.kind === 'personal-sync');
  assert.deepEqual(st.map(x => x.message), [todo.message]);
});

const OVERRIDE = '## 바꿈\n\n바꾸는 절: `extra/00-e.md` 「절 하나」\n\n바꾼 본문\n';
const applyIn = async dir => {
  const o = collect();
  assert.equal(await projectApply({ project: dir, json: true, out: o.out, err: () => {}, env: { PATH: '' }, runRuler: () => 0 }), 0);
  return JSON.parse(o.text());
};
const statusIn = async (dir, env) => {
  const o = collect();
  await projectStatus({ project: dir, env, json: true, out: o.out, err: () => {} });
  return JSON.parse(o.text());
};

test('다른 브랜치 워크트리의 update 는 그 프로젝트가 고른 블록이어도 공용 개인 사본을 지우지 않는다', async t => {
  const { p, store, env } = await setup(t);
  // main: 프로젝트 rules/base, 개인으로 rules/extra·rules/extra/sub(폼이 조상도 더한다)
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra', 'rules/extra/sub'], remove: [] } } });
  assert.equal((await update(p, env)).code, 0);
  commitAll(p);
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  // wt2: 다른 브랜치에서 프로젝트가 rules/extra 와 그 하위 스택을 고른다
  const wt2 = `${p}-wt2`;
  t.after(() => fs.rmSync(wt2, { recursive: true, force: true }));
  assert.equal(runGit(['worktree', 'add', '-q', '-b', 'other', wt2], p).status, 0);
  const m = readManifest(wt2);
  m.sources.default.items = [...m.sources.default.items, 'rules/extra', 'rules/extra/sub'];
  write(wt2, MANIFEST, manifestText(m));
  assert.equal((await update(wt2, env)).code, 0);
  commitAll(wt2);
  assert.match(read(wt2, '.guideline/rules/extra/00-e.md'), /# 개인 더함/);
  // 공용 개인 사본·잠금은 그대로다
  assert.deepEqual(lockIds(store), ['default:rules/extra/00-e.md', 'default:rules/extra/sub/00-s.md']);
  // main: 개인 블록이 조합에 남고, 할 일도 없다
  const applied = await applyIn(p);
  assert.deepEqual(applied.todos.filter(x => x.kind === 'no-copy'), []);
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
  assert.match(read(p, '.ruler/extra/sub/00-s.md'), /# 하위/);
  assert.equal(porcelain(p), '');
  assert.deepEqual((await statusIn(p, env)).todos, []);
  // wt2 는 프로젝트 사본으로 조합한다(개인 블록 표시 없음, 리비전 차이 할 일 없음)
  assert.deepEqual((await applyIn(wt2)).todos.filter(x => x.kind === 'personal-revision' || x.kind === 'no-copy'), []);
  assert.equal(porcelain(wt2), '');
});

test('개인 사본이 없는 개인 블록은 조용히 빠지지 않고 개인 no-copy 할 일이 된다', async t => {
  const { p, store, env } = await setup(t);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra', 'rules/extra/sub'], remove: [] } } });
  assert.equal((await update(p, env)).code, 0);
  // 조상 스택의 사본만 사라진다(하위 스택 폴더가 남아 그 자리는 폴더로 보인다)
  fs.rmSync(path.join(store, '.guideline/rules/extra/00-e.md'));
  const applied = await applyIn(p);
  const todo = applied.todos.filter(x => x.kind === 'no-copy');
  assert.deepEqual(todo, [{
    kind: 'no-copy', item: 'rules/extra', scope: 'personal', message: 'rules/extra: 개인으로 더했지만 개인 사본이 없어 조합하지 않음 — guideline update 로 받기',
  }]);
  assert.equal(exists(p, '.ruler/extra/00-e.md'), false);
  assert.match(read(p, '.ruler/extra/sub/00-s.md'), /# 하위/);
  // 받은 적 없는 개인 더함도 같다(local.json 만 고친 경우)
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra', 'rules/extra/sub', 'skills/s'], remove: [] } } });
  assert.ok((await applyIn(p)).todos.some(x => x.kind === 'no-copy' && x.item === 'skills/s' && x.scope === 'personal'));
  // update 가 받으면 사라진다
  const r = await update(p, env);
  assert.deepEqual(r.todos.filter(x => x.kind === 'no-copy'), []);
  assert.match(read(p, '.ruler/extra/00-e.md'), /# 개인 더함/);
});

test('다른 워크트리의 update 가 개인 사본만 올리면 apply·status 가 리비전 차이와 사라진 바꿈 대상을 알린다', async t => {
  const { s, p, store, env } = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n\n## 절 하나\n\n본문\n` } });
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  // 프로젝트 바꿈이 개인으로 더한 스택의 절을 가리킨다
  write(p, '.guideline/overrides/extra/override.md', OVERRIDE);
  await update(p, env);
  commitAll(p);
  const kinds = r => r.todos.map(x => x.kind);
  assert.equal(kinds(await applyIn(p)).includes('override-target'), false);
  assert.equal(kinds(await applyIn(p)).includes('personal-revision'), false);
  // 워크트리 B 는 지금 커밋(프로젝트 r2)에서 갈라진다
  const b = `${p}-b`;
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  assert.equal(runGit(['worktree', 'add', '-q', '-b', 'b', b], p).status, 0);
  const projectRev = JSON.parse(read(b, LOCK)).revisions.default;
  // 원본에서 절 제목이 바뀌고, 워크트리 A 의 update 가 개인 사본(공용 디렉터리)을 올린다
  s.store.commit({ ...META, changes: { 'rules/extra/00-e.md': `${ALWAYS}# 개인 더함\n\n## 새 제목\n\n본문\n` } });
  await update(p, env);
  const personalRev = readLock(store).revisions.default;
  assert.equal(personalRev, projectRev + 1);
  // B: 서버 없이 apply 와 status 가 둘 다 알린다
  const applied = await applyIn(b);
  const rev = applied.todos.find(x => x.kind === 'personal-revision');
  assert.ok(rev, JSON.stringify(applied.todos));
  assert.equal(rev.message,
    `default: 개인 사본은 r${personalRev}, 프로젝트는 r${projectRev} — 바꿈이 가리키는 절이 어긋날 수 있음, 맞추려면 guideline update`);
  const target = applied.todos.find(x => x.kind === 'override-target');
  assert.ok(target, JSON.stringify(applied.todos));
  assert.equal(target.message,
    '.guideline/overrides/extra/override.md 「바꿈」: 바꿈 대상이 조합한 사본에 없음(extra/00-e.md 에 「절 하나」 절이 없음) — 바꿈을 고치거나, 리비전이 어긋났으면 guideline update');
  const st = await statusIn(b, env);
  assert.ok(kinds(st).includes('personal-revision'), JSON.stringify(st.todos));
  assert.ok(kinds(st).includes('override-target'), JSON.stringify(st.todos));
  // 개인 더함을 거두면(아직 update 전이라 개인 잠금은 남음) 조합이 개인 사본을 쓰지 않으므로 리비전 차이는 알리지 않는다
  writeLocal(store, { version: 1, sources: { default: { add: [], remove: [] } } });
  assert.equal(kinds(await applyIn(b)).includes('personal-revision'), false);
  writeLocal(store, { version: 1, sources: { default: { add: ['rules/extra'], remove: [] } } });
  // B 에서 update 하면 두 범위의 리비전이 같아져 리비전 차이는 사라진다(바꿈은 프로젝트가 고칠 것이라 남는다)
  await update(b, env);
  const after = await applyIn(b);
  assert.equal(kinds(after).includes('personal-revision'), false, JSON.stringify(after.todos));
  assert.ok(kinds(after).includes('override-target'));
  // 바꿈을 새 제목으로 고치면 할 일이 없다
  write(b, '.guideline/overrides/extra/override.md', OVERRIDE.replace('절 하나', '새 제목'));
  assert.equal(kinds(await applyIn(b)).includes('override-target'), false);
});

test('다른 출처의 같은 이름을 프로젝트가 골라 가려진 개인 더함은 조합에 쓰지 않고 알린다', async t => {
  const config = tmpDir('guideline-cfg-');
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: config, PATH: '' };
  const server = async body => {
    const s = await startApp(t);
    s.store.commit({ ...META, source: 'import', changes: { ...SOURCE, 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n${body}\n` } });
    saveToken(s.base, { token: s.tokens.issue({ name: 'cli-t', scope: 'read' }).token, name: 'cli-t' }, { env });
    return s;
  };
  const a = await server('에이 본문');
  const b = await server('비 본문');
  const p = fs.realpathSync(tmpDir('guideline-personal-shadow-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  // 별칭 없이 a 는 rules/base, b 는 skills/s 를 프로젝트로 고른다
  write(p, MANIFEST, manifestText({ version: 3, form: 'ruler', agents: ['claude'], sources: {
    a: { server: a.base, items: ['rules/base'] }, b: { server: b.base, items: ['skills/s'] },
  } }));
  assert.equal((await update(p, env)).code, 0);
  const store = personalStore({ dir: p, root: p });
  writeLocal(store, { version: 1, sources: { b: { add: ['rules/base'], remove: [] } } });
  // 개인 사본 대상은 local.json 의 더함 전부다 — 가려짐은 워크트리마다 조합이 판정한다
  assert.deepEqual(personalTargets(readManifest(p), readLocal(store)), { a: [], b: ['rules/base'] });
  const r = await update(p, env);
  assert.equal(r.code, 0);
  const todo = r.todos.find(x => x.kind === 'personal-shadowed');
  assert.ok(todo, JSON.stringify(r.todos));
  assert.equal(todo.item, 'b:rules/base');
  assert.equal(todo.message, 'b:rules/base: 개인으로 더했지만 출처 a 의 같은 이름 블록(rules/base)을 프로젝트가 골라 가려짐 — 쓰지 않음, guideline pick --local 에서 정리');
  // 조합은 a 의 것이다(b 의 개인 사본은 쓰지 않는다). 관리 지침도 더한 것으로 적지 않는다
  assert.match(read(p, '.ruler/base/00-a.md'), /에이 본문/);
  assert.doesNotMatch(read(p, '.ruler/guideline.md'), /더한 것/);
  // apply(서버 없이)도 알린다
  assert.ok((await applyIn(p)).todos.some(x => x.kind === 'personal-shadowed'));
  // status: 더함 목록에 가려졌음이 보인다
  const st = await statusIn(p, env);
  assert.deepEqual(st.personal.added, ['b:rules/base']);
  assert.deepEqual(st.personal.shadowed, [{ id: 'b:rules/base', by: 'a' }]);
  assert.ok(st.todos.some(x => x.kind === 'personal-shadowed'));
  const text = collect();
  await projectStatus({ project: p, env, out: text.out, err: () => {} });
  assert.match(text.text(), /^ {2}개인 범위 — 더함 1: b:rules\/base \(가려짐: a\)$/m);
});

test('가려진 개인 더함 아래의 하위 스택도 쓰지 않는다 — 다른 출처의 스택에 섞이지 않고 세팅 표 출처도 프로젝트 것이다', async t => {
  const files = { ...SOURCE, ...EXTRA, 'rules/base/sub/00-bs.md': `${ALWAYS}# b 의 하위\n` };
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: files });
  const config = tmpDir('guideline-cfg-');
  const p = fs.realpathSync(tmpDir('guideline-personal-mix-'));
  t.after(() => {
    fs.rmSync(p, { recursive: true, force: true });
    fs.rmSync(config, { recursive: true, force: true });
  });
  const env = { XDG_CONFIG_HOME: config, PATH: '' };
  saveToken(s.base, { token: s.tokens.issue({ name: 'cli-t', scope: 'read' }).token, name: 'cli-t' }, { env });
  runGit(['init', '-q'], p);
  // 같은 서버의 두 출처: a 는 서브에이전트, b 는 스킬. b 에서 개인으로 rules/base·rules/base/sub(폼이 낸 모양)
  syncedProject(p, { server: s.base, source: files, sources: { a: { items: ['agents/rev.md'] }, b: { items: ['skills/s'] } } });
  commitAll(p);
  const store = personalStore({ dir: p, root: p });
  writeLocal(store, { version: 1, sources: { b: { add: ['rules/base', 'rules/base/sub'], remove: [] } } });
  assert.equal((await update(p, env)).code, 0);
  assert.match(read(p, '.ruler/base/sub/00-bs.md'), /# b 의 하위/);
  // 팀이 a 의 rules/base 를 고른다
  const m = readManifest(p);
  m.sources.a.items = [...m.sources.a.items, 'rules/base'];
  write(p, MANIFEST, manifestText(m));
  const r = await update(p, env);
  assert.equal(r.code, 0);
  assert.deepEqual(r.todos.filter(x => x.kind === 'personal-shadowed').map(x => x.message),
    ['b:rules/base: 개인으로 더했지만 출처 a 의 같은 이름 블록(rules/base)을 프로젝트가 골라 가려짐 — 그것과 아래의 rules/base/sub 도 쓰지 않음, guideline pick --local 에서 정리']);
  // a 의 base 에 b 의 하위 스택이 섞이지 않는다. 관리 지침은 그것을 더한 것으로 적지 않고, 세팅 표의 base 출처는 a 다
  assert.equal(exists(p, '.ruler/base/sub/00-bs.md'), false);
  assert.doesNotMatch(excludeText(p), /base\/sub/);
  const mgmt = read(p, '.ruler/guideline.md');
  assert.doesNotMatch(mgmt, /base\/sub/);
  assert.match(mgmt, /^\| base \| a \| `docs\/guideline\/base\/SETUP\.md` \|$/m);
  // 팀의 바뀐 선택을 커밋한 뒤에도 개인 생성물이 드러나지 않는다
  commitAll(p);
  await applyIn(p);
  assert.equal(porcelain(p), '');
  // status 도 둘 다 가려졌다고 보인다
  const st = await statusIn(p, env);
  assert.deepEqual(st.personal.shadowed, [{ id: 'b:rules/base', by: 'a' }, { id: 'b:rules/base/sub', by: 'a' }]);
});

test('personalTargets 는 모든 역할의 더함을 합친다', () => {
  const m = checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: {
    a: { server: 'http://x', items: ['rules/base'] }, b: { server: 'http://y', items: [] },
  } });
  const local = {
    version: 2,
    sources: { a: { add: ['rules/c'], remove: [] } },
    roles: {
      dev: { sources: { a: { add: ['rules/d/sub', 'rules/c'], remove: ['rules/c'] }, gone: { add: ['rules/z'], remove: [] } } },
      ops: { sources: { b: { add: ['skills/o'], remove: [] } } },
    },
  };
  assert.deepEqual(personalTargets(m, local), { a: ['rules/c', 'rules/d', 'rules/d/sub'], b: ['skills/o'] });
  // 역할이 없으면 공통 더함만(0.24 와 같다)
  assert.deepEqual(personalTargets(m, { version: 2, sources: local.sources, roles: {} }), { a: ['rules/c'], b: [] });
});
