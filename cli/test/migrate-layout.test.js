import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { writeOldLayout } from './old-layout.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { projectPick } from '../src/commands/project-pick.js';
import { projectStatus } from '../src/commands/project-status.js';
import { projectApply } from '../src/commands/project-apply.js';
import { propose } from '../src/commands/propose.js';
import { readManifest, readLock } from '../src/manifest.js';
import { readBlock } from '../src/gitignore-block.js';
import { runGit } from '../src/projects.js';
import { memoryTree } from '../src/tree.js';
import { migrateLayout, preparePackage, sourceOf } from '../src/migrate-layout.js';
import { PROJECT_TOML, RULER_TOML } from '../src/layout.js';
import { sha256 } from '../src/hashes.js';

const BODY_A = '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n';
const FRONT_A = SOURCE['rules/base/00-a.md'].slice(0, SOURCE['rules/base/00-a.md'].length - BODY_A.length);
const quiet = { err: () => {}, pollWait: 1, runRuler: () => 0 };
const git = (args, cwd) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], cwd);
const commitAll = p => {
  git(['add', '-A'], p);
  git(['commit', '-q', '-m', 'c'], p);
};

async function server(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-t', scope: 'propose' }).token;
  return { s, env: { GUIDELINE_TOKEN: token, GUIDELINE_SERVER: s.base } };
}

/** 옛 배치 프로젝트(git 저장소, 모두 커밋됨). files 는 옛 배치를 쓴 뒤 얹는다. */
function oldProject(t, s, { files = {}, ...opts } = {}) {
  const p = fs.realpathSync(tmpDir('guideline-migrate-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  const made = writeOldLayout(p, { server: s.base, ...opts });
  for (const [k, v] of Object.entries(files)) write(p, k, v);
  commitAll(p);
  return { p, ...made };
}

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

test('이전은 고친 사본을 원본 모양으로 옮긴다', async t => {
  const { s, env } = await server(t);
  const { p } = oldProject(t, s, { files: { '.ruler/base/00-a.md': `${BODY_A}\n고친 줄\n` } });
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  // frontmatter 를 다시 붙인 원본 모양 + 고친 본문
  assert.equal(read(p, '.guideline/rules/base/00-a.md'), `${FRONT_A}${BODY_A}\n고친 줄\n`);
  // 손대지 않은 사본은 원본 바이트 그대로
  assert.equal(read(p, '.guideline/rules/base/01-b.md'), SOURCE['rules/base/01-b.md']);
  assert.equal(read(p, '.guideline/rules/base/SETUP.md'), SOURCE['rules/base/SETUP.md']);
  assert.equal(fs.readFileSync(path.join(p, '.guideline/skills/s/img/a.png')).equals(SOURCE['skills/s/img/a.png']), true);
  // 잠금 v3: 해시는 원본 바이트의 해시라 고친 사본은 local 이다
  const lock = readLock(p);
  assert.equal(lock.version, 3);
  assert.ok(lock.outputs.every(x => x.path.startsWith('.guideline/') && !x.key), JSON.stringify(lock.outputs));
  assert.equal(lock.outputs.find(x => x.path === '.guideline/rules/base/00-a.md').hash, sha256(SOURCE['rules/base/00-a.md']));
  // update 는 고친 사본을 건너뛰고, 조합은 고친 사본으로 만든다
  assert.equal(read(p, '.ruler/base/00-a.md'), `${BODY_A}\n고친 줄\n`);
  const r = JSON.parse(o.text());
  assert.equal(r.todos[0].kind, 'migrated');
  assert.equal(r.todos[0].message, '이 프로젝트를 새 배치로 옮김: 사본은 .guideline/ 에, 생성물은 .gitignore 에 적힘. git status 로 확인하고 커밋');
  assert.ok(r.todos.some(x => x.kind === 'skipped' && x.item === 'rules/base/00-a.md'), JSON.stringify(r.todos));

  const st = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: st.out, err: () => {} }), 0);
  const items = Object.fromEntries(JSON.parse(st.text()).items.map(x => [x.id, x.state]));
  assert.equal(items['rules/base/00-a.md'], 'local');
  assert.equal(items['rules/base/01-b.md'], 'current');
  assert.equal(items['skills/s'], 'current');

  const pr = collect();
  assert.equal(await propose({ project: p, env, dryRun: true, json: true, out: pr.out, err: () => {} }), 0);
  assert.deepEqual(JSON.parse(pr.text()).changes, [{ path: 'rules/base/00-a.md', kind: 'modify' }]);
});

test('이전은 프로젝트 MCP 표를 ruler.project.toml 에 남긴다', async t => {
  const { s, env } = await server(t);
  const mine = '\n[mcp_servers.mine]\ncommand = "my-mcp"\n';
  const { p } = oldProject(t, s, { items: ['rules/base/00-a.md', 'mcp/c7', 'mcp/gl'] });
  write(p, RULER_TOML, read(p, RULER_TOML) + mine);
  // 받은 표를 프로젝트에서 고친 것(gl)은 프로젝트 것으로 남는다
  write(p, RULER_TOML, read(p, RULER_TOML).replace('url = "https://g/mcp"', 'url = "https://mine/mcp"'));
  commitAll(p);
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  const project = read(p, PROJECT_TOML);
  assert.match(project, /\[mcp_servers\.mine\]\ncommand = "my-mcp"/);
  assert.doesNotMatch(project, /mcp_servers\.c7/);
  assert.match(project, /https:\/\/mine\/mcp/);
  assert.ok(project.startsWith('default_agents = ["claude"]\nnested = false\n'));
  // 받은 MCP 는 사본으로, ruler.toml 은 조합이 다시 만든다(프로젝트 표 + 고른 MCP)
  assert.equal(read(p, '.guideline/mcp/c7/server.json'), SOURCE['mcp/c7/server.json']);
  assert.equal(read(p, '.guideline/mcp/gl/server.json'), SOURCE['mcp/gl/server.json']);
  const toml = read(p, RULER_TOML);
  assert.match(toml, /mcp_servers\.c7/);
  assert.match(toml, /mcp_servers\.mine/);
  assert.match(toml, /https:\/\/mine\/mcp/);
  // 프로젝트 표가 이긴 gl 은 할 일로 알린다
  const r = JSON.parse(o.text());
  assert.ok(r.todos.some(x => x.kind === 'mcp-conflict' && x.item === 'mcp/gl'), JSON.stringify(r.todos));
  assert.equal(readLock(p).outputs.some(x => x.key), false);
});

test('이전은 바꿈 파일을 .guideline/overrides 로 옮긴다', async t => {
  const { s, env } = await server(t);
  const over = '## 바꿈\n\nOverrides: `base/00-a.md` "절 하나"\n\n다르게\n';
  const extra = '## 더\n\nOverrides: `base/00-a.md`\n\n전체\n';
  const { p } = oldProject(t, s, { files: { '.ruler/base/override.md': over, '.ruler/base/override.d/x.md': extra } });
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  assert.equal(read(p, '.guideline/overrides/base/override.md'), over);
  assert.equal(read(p, '.guideline/overrides/base/override.d/x.md'), extra);
  // .ruler/ 쪽은 조합이 다시 만든 생성물이고 git 은 더 이상 추적하지 않는다
  assert.equal(read(p, '.ruler/base/override.md'), over);
  assert.equal(runGit(['ls-files', '--', '.ruler/base/override.md', '.ruler/base/override.d/x.md'], p).stdout, '');
  const block = readBlock(read(p, '.gitignore'));
  assert.ok(block.includes('/.ruler/base/override.md') && block.includes('/.ruler/base/override.d/x.md'), block.join(' '));
});

test('이전은 커밋 안 된 변경이 있으면 멈춘다', async t => {
  const { s, env } = await server(t);
  const { p } = oldProject(t, s);
  write(p, '.ruler/base/00-a.md', '# 커밋 안 함\n');
  const before = snapshot(p);
  const e = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, err: e.out, out: () => {} }), 1);
  assert.match(e.text(), /먼저 변경을 커밋하거나 치우기/);
  assert.deepEqual(snapshot(p), before);
  // pick 도 폼을 열기 전에 멈춘다
  let opened = false;
  assert.equal(await projectPick({ project: p, env, ...quiet, err: () => {}, out: () => {}, open: () => { opened = true; } }), 1);
  assert.equal(opened, false);
  assert.deepEqual(snapshot(p), before);
});

test('이전은 옛 사본을 git 추적에서 빼고 .gitignore 블록에 올린다', async t => {
  const { s, env } = await server(t);
  const { p } = oldProject(t, s);
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  const tracked = runGit(['ls-files'], p).stdout.split('\n').filter(Boolean);
  for (const x of ['.ruler/base/00-a.md', 'docs/guideline/base/01-b.md', 'docs/guideline/base/SETUP.md', '.ruler/base/99-reference.md',
    '.ruler/guideline.md', 'docs/guideline/README.md', '.ruler/skills/s/SKILL.md', RULER_TOML]) {
    assert.equal(tracked.includes(x), false, x);
    assert.ok(exists(p, x), `${x} 는 조합이 다시 썼다`);
  }
  const block = readBlock(read(p, '.gitignore'));
  for (const x of ['/.ruler/base/00-a.md', '/.ruler/base/99-reference.md', '/docs/guideline/base/01-b.md', '/.ruler/ruler.toml']) assert.ok(block.includes(x), x);
  // 커밋할 것: 매니페스트·잠금·.guideline/·ruler.project.toml·.gitignore. 추적에서 뺀 생성물은 git status 에 다시 나오지 않는다
  git(['add', '-A'], p);
  const staged = runGit(['diff', '--cached', '--no-renames', '--name-status'], p).stdout;
  assert.match(staged, /^A\t\.guideline\/rules\/base\/00-a\.md$/m);
  assert.match(staged, /^A\t\.ruler\/ruler\.project\.toml$/m);
  assert.match(staged, /^D\t\.ruler\/base\/00-a\.md$/m);
  assert.doesNotMatch(staged, /^A\t\.ruler\/base\//m);
});

test('prepare 는 guideline-manage 가 있을 때만 guideline apply 로 바뀐다', async t => {
  const { s, env } = await server(t);
  const pkg = deps => `{\n  "name": "x",\n  "scripts": {\n    "prepare": "husky && ruler apply"\n  }${deps ? `,\n  "devDependencies": {\n    "guideline-manage": "^0.24.0"\n  }` : ''}\n}\n`;
  // 없으면: 바꾸지 않고, 잠금 파일로 고른 명령을 할 일로 낸다
  const { p } = oldProject(t, s, { files: { 'package.json': pkg(false), 'pnpm-lock.yaml': '' } });
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  assert.equal(read(p, 'package.json'), pkg(false));
  const todo = JSON.parse(o.text()).todos.find(x => x.kind === 'dev-dependency');
  assert.equal(todo.message, 'prepare 가 에이전트 파일을 조합하게 이 프로젝트에 guideline CLI 를 더하기: pnpm add -D guideline-manage 한 뒤 guideline apply 실행');
  // 설치한 뒤의 apply 가 바꾼다(글자 그대로, 다른 줄은 그대로)
  write(p, 'package.json', pkg(true));
  const a = collect();
  assert.equal(await projectApply({ dir: p, json: true, out: a.out, err: () => {}, runRuler: () => 0 }), 0);
  assert.equal(read(p, 'package.json'), pkg(true).replace('ruler apply', 'guideline apply'));
  assert.ok(JSON.parse(a.text()).todos.some(x => x.kind === 'prepare'));

  // 있으면 이전이 바로 바꾼다
  const { p: q } = oldProject(t, s, { files: { 'package.json': pkg(true) } });
  assert.equal(await projectUpdate({ project: q, env, ...quiet, out: () => {} }), 0);
  assert.match(read(q, 'package.json'), /"prepare": "husky && guideline apply"/);

  // 잠금 파일에 따라 명령이 다르고, package.json 이 없으면 apply-hook
  const dir = tmpDir('guideline-prep-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, 'package.json', pkg(false));
  write(dir, 'yarn.lock', '');
  assert.match(preparePackage({ project: dir }).todos[0].message, /yarn add -D guideline-manage/);
  fs.rmSync(path.join(dir, 'yarn.lock'));
  assert.match(preparePackage({ project: dir }).todos[0].message, /npm install -D guideline-manage/);
  fs.rmSync(path.join(dir, 'package.json'));
  assert.deepEqual(preparePackage({ project: dir }).todos, []);
  assert.equal(preparePackage({ project: dir, hook: true }).todos[0].kind, 'apply-hook');
});

test('v2 매니페스트 첫 변환 때 안내 줄을 낸다', async t => {
  const { s, env } = await server(t);
  const { p } = oldProject(t, s);
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: o.out }), 0);
  assert.match(o.text(), /guideline\.json 을 버전 3\(스택 단위\)으로 바꿈 — 고른 스택의 나머지 파일도 받음/);
  assert.equal(JSON.parse(read(p, 'guideline.json')).version, 3);
  // 이미 v3 이면 다시 내지 않는다
  const o2 = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: o2.out }), 0);
  assert.doesNotMatch(o2.text(), /버전 3/);
});

test('pick 은 옛 배치를 먼저 옮기고 새 배치로 폼을 만든다', async t => {
  const { s, env } = await server(t);
  const { p } = oldProject(t, s, { files: { '.ruler/base/00-a.md': `${BODY_A}\n고친 줄\n` } });
  let items = null;
  const open = async url => {
    const u = new URL(url);
    const r = await s.req(u.pathname + u.search);
    const cookie = r.headers['set-cookie'][0].split(';')[0];
    items = (await s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json().items;
    await s.req(`${u.pathname}/cancel`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: s.config.publicUrl.origin, Cookie: cookie } });
  };
  const e = collect();
  assert.equal(await projectPick({ project: p, env, ...quiet, err: e.out, out: () => {}, open }), 3);
  const by = Object.fromEntries(items.filter(i => i.kind !== 'orphan').map(i => [i.id, i]));
  assert.equal(by['rules/base/01-b.md'].state, 'same');
  assert.equal(by['rules/base/00-a.md'].state, 'different');
  assert.equal(by['rules/base/00-a.md'].lockState, 'local');
  assert.deepEqual(by['rules/base/00-a.md'].where, ['.guideline/rules/base/00-a.md']);
  // 옛 사본은 고아로 보이지 않는다
  assert.equal(items.some(i => i.kind === 'orphan'), false, JSON.stringify(items.filter(i => i.kind === 'orphan')));
  // 취소해도 옮긴 것은 남고 그 할 일을 알린다
  assert.equal(readLock(p).version, 3);
  assert.match(e.text(), /새 배치로 옮김/);
});

test('잠금이 없던(0.10 이전) 옛 배치는 디스크의 사본으로 옮기고 고친 사본은 adopted 로 남긴다', async t => {
  const { s, env } = await server(t);
  const { p } = oldProject(t, s, { lock: false, files: { '.ruler/base/00-a.md': `${BODY_A}\n고친 줄\n` } });
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  assert.equal(read(p, '.guideline/rules/base/00-a.md'), `${FRONT_A}${BODY_A}\n고친 줄\n`);
  assert.equal(read(p, '.guideline/rules/base/01-b.md'), SOURCE['rules/base/01-b.md']);
  const out = readLock(p).outputs.find(x => x.path === '.guideline/rules/base/00-a.md');
  assert.equal(out.adopted, true);
  assert.doesNotMatch(read(p, PROJECT_TOML), /mcp_servers\.c7/);
});

test('옛 배치에서 status·propose 는 update 로 옮기라고 하고 2', async t => {
  const { s, env } = await server(t);
  const { p } = oldProject(t, s);
  for (const run of [projectStatus, propose]) {
    const e = collect();
    assert.equal(await run({ project: p, env, out: () => {}, err: e.out, dryRun: true }), 2);
    assert.match(e.text(), /아직 예전 배치 — guideline update/);
  }
});

test('migrateLayout 은 디스크에 쓰지 않고, 지운 사본은 쓰지 않은 채 잠금에 남긴다', t => {
  const p = fs.realpathSync(tmpDir('guideline-migrate-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  const { manifest, lock } = writeOldLayout(p);
  fs.rmSync(path.join(p, 'docs/guideline/base/01-b.md'));
  const before = snapshot(p);
  const noGit = () => ({ status: 128, stdout: '' });
  const r = migrateLayout({ project: p, manifest, lock, trees: new Map([['default', { revision: 1, tree: memoryTree(SOURCE) }]]), git: noGit });
  assert.deepEqual(snapshot(p), before);
  assert.equal(Object.hasOwn(r.files, '.guideline/rules/base/01-b.md'), false);
  assert.ok(r.lock.outputs.some(x => x.path === '.guideline/rules/base/01-b.md'));
  // 관리 지침·색인은 사본이 아니다. git 이 없으면 추적에서 뺄 것도 없다
  assert.equal(Object.keys(r.files).some(f => f.includes('99-reference') || f === '.ruler/guideline.md'), false);
  assert.deepEqual(r.notes.untrack, []);
  // sourceOf 는 지침 사본에 원본 frontmatter 를 다시 붙인다
  assert.equal(sourceOf(memoryTree(SOURCE), '.ruler/base/00-a.md', Buffer.from(BODY_A)).content.toString(), SOURCE['rules/base/00-a.md']);
});
