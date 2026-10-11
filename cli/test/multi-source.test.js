import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect, ALWAYS } from './helpers.js';
import { SOURCE, manifestOf } from './render-fixture.js';
import { memoryTree } from '../src/tree.js';
import { render } from '../src/render/index.js';
import { applyFiles } from '../src/apply.js';
import { diskReader } from '../src/project-state.js';
import { saveToken } from '../src/credentials.js';
import { readManifest, readLock, manifestText } from '../src/manifest.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { projectStatus } from '../src/commands/project-status.js';
import { projectPick } from '../src/commands/project-pick.js';
import { propose } from '../src/commands/propose.js';
import { source } from '../src/commands/source.js';
import { runGit } from '../src/projects.js';

/** 지침 서버 둘(a, b)과 각 서버에 저장한 토큰. GUIDELINE_TOKEN 은 쓰지 않는다. */
export async function servers(t) {
  const config = tmpDir('guideline-cfg-');
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: config };
  const make = async () => {
    const s = await startApp(t);
    s.store.commit({ ...META, source: 'import', changes: SOURCE });
    saveToken(s.base, { token: s.tokens.issue({ name: 'cli-t', scope: 'propose' }).token, name: 'cli-t' }, { env });
    return s;
  };
  return { a: await make(), b: await make(), env };
}

export function project(t, files = {}) {
  const p = tmpDir('guideline-proj-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  for (const [k, v] of Object.entries(files)) write(p, k, v);
  runGit(['init', '-q'], p);
  return p;
}

const quiet = { err: () => {}, runRuler: () => 0 };
const twoSources = (a, b, bAlias = 'b-base') => manifestText({ version: 2, form: 'ruler', agents: ['claude'], sources: {
  a: { server: a.base, items: ['rules/base/00-a.md'] },
  b: { server: b.base, items: ['rules/base/00-a.md'], aliases: { 'rules/base': bAlias } },
} });
const changed = (s, text) => s.store.commit({ ...META, changes: { 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n${text}\n` } });

/** 매니페스트·잠금을 뺀 프로젝트 파일 내용. */
function snapshot(p) {
  const out = {};
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(p, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === '.git' || r === 'guideline.json' || r === 'guideline-lock.json') continue;
      if (e.isDirectory()) walk(r);
      else out[r] = fs.readFileSync(path.join(p, r), 'utf8');
    }
  };
  walk('');
  return out;
}

test('update: 0.13(v1) 프로젝트는 파일이 바이트까지 같고 매니페스트·잠금만 v2 가 된다', async t => {
  const { a, env } = await servers(t);
  const p = project(t);
  const items = ['rules/base/00-a.md', 'rules/base/01-b.md', 'rules/base/SETUP.md', 'skills/s', 'mcp/c7'];
  const v1 = manifestOf('ruler', items, { server: a.base, agents: ['claude'] });
  const r = render({ tree: memoryTree(SOURCE), revision: 1, manifest: v1, lock: null, project: diskReader(p) });
  applyFiles(p, r.files);
  write(p, 'guideline.json', JSON.stringify(v1));
  write(p, 'guideline-lock.json', JSON.stringify(r.lock));
  const before = snapshot(p);
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  assert.deepEqual(snapshot(p), before);
  assert.deepEqual(Object.keys(readManifest(p).sources), ['default']);
  assert.match(read(p, 'guideline.json'), /"version": 2/);
  assert.match(read(p, 'guideline-lock.json'), /"default:rules\/base\/00-a\.md"/);
});

test('update: 두 출처를 별칭과 함께 반영하고, 한 출처가 실패하면 그것만 그대로 두고 1', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  assert.match(read(p, '.ruler/base/00-a.md'), /본문 A/);
  assert.match(read(p, '.ruler/b-base/00-a.md'), /본문 A/);
  assert.match(read(p, '.ruler/guideline.md'), /그 항목이 온 출처로 제안된다/);
  changed(a, '에이 새');
  changed(b, '비 새');
  const m = JSON.parse(read(p, 'guideline.json'));
  m.sources.b.server = 'http://127.0.0.1:9';
  write(p, 'guideline.json', JSON.stringify(m));
  saveToken('http://127.0.0.1:9', { token: 'glt_dead', name: 'x' }, { env });
  const e = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, err: e.out, out: () => {} }), 1);
  assert.match(read(p, '.ruler/base/00-a.md'), /에이 새/);
  assert.match(read(p, '.ruler/b-base/00-a.md'), /본문 A/);
  assert.equal(readLock(p).revisions.b, 1);
  assert.equal(readLock(p).revisions.a, 2);
  assert.ok(readLock(p).sources['b:rules/base/00-a.md']);
  assert.match(e.text(), /b/);
});

test('update --source 는 그 출처만 최신으로 올린다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  changed(a, '에이 새');
  changed(b, '비 새');
  assert.equal(await projectUpdate({ project: p, source: 'b', env, ...quiet, out: () => {} }), 0);
  assert.match(read(p, '.ruler/base/00-a.md'), /본문 A/);
  assert.match(read(p, '.ruler/b-base/00-a.md'), /비 새/);
  assert.deepEqual(readLock(p).revisions, { a: 1, b: 2 });
});

test('update: 별칭을 바꾸면 예전 자리 사본을 지우고 새 자리에 쓰며 바꿈은 할 일 alias', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  write(p, '.ruler/b-base/override.md', '# 바꿈\n');
  write(p, 'guideline.json', twoSources(a, b, 'bb'));
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  assert.equal(exists(p, '.ruler/b-base/00-a.md'), false);
  assert.match(read(p, '.ruler/bb/00-a.md'), /본문 A/);
  assert.ok(exists(p, '.ruler/b-base/override.md'));
  assert.ok(JSON.parse(o.text()).todos.some(x => x.kind === 'alias' && x.message.includes('.ruler/b-base/override.md')));
});

test('status: 출처가 둘이면 항목을 <출처>:<id> 로 보인다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  changed(b, '비 새');
  const o = collect();
  assert.equal(await projectStatus({ project: p, env, json: true, out: o.out }), 0);
  const s = JSON.parse(o.text());
  assert.deepEqual(s.items.map(i => [i.id, i.state]).sort(), [['a:rules/base/00-a.md', 'current'], ['b:rules/base/00-a.md', 'upstream']]);
  assert.deepEqual(s.token, { a: { name: 'cli-t', scope: 'propose' }, b: { name: 'cli-t', scope: 'propose' } });
  const text = collect();
  await projectStatus({ project: p, env, out: text.out });
  assert.match(text.text(), /^ {2}a: 토큰: cli-t — 범위 propose$/m);
  assert.match(text.text(), /^ {2}b: 토큰: cli-t — 범위 propose$/m);
});

/** 브라우저 대신: 폼 주소가 어느 서버의 것인지 찾아 열고, 출처마다 정한 대로 제출하거나 취소한다. seen 에 폼 데이터를 모은다. */
function driverMany(list, plan, seen = []) {
  return async url => {
    const u = new URL(url);
    for (const s of list) {
      const r = await s.req(u.pathname + u.search);
      if (!r.headers['set-cookie']) continue;
      const cookie = r.headers['set-cookie'][0].split(';')[0];
      const data = (await s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json();
      seen.push({ server: s.base, data });
      const step = plan(s, data);
      const body = step.cancel ? {} : { choices: step.choices ?? {}, force: true };
      await s.req(`${u.pathname}/${step.cancel ? 'cancel' : 'submit'}`, {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Origin: s.config.publicUrl.origin, Cookie: cookie },
      });
      return;
    }
    throw new Error(`폼을 찾지 못했다: ${url}`);
  };
}
const checkOnly = pred => items => Object.fromEntries(items.map(i => [`${i.kind}:${i.id}`, { checked: pred(i), update: false }]));
const pickQuiet = { ...quiet, pollWait: 1, out: () => {} };

test('pick --source 로 출처를 더하고, --source 없이는 출처마다 차례로 폼을 연다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t);
  assert.equal(await projectPick({ project: p, source: 'personal', server: a.base, env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id === 'rules/base/00-a.md')(d.items) })) }), 0);
  assert.equal(await projectPick({ project: p, source: 'company', server: b.base, env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id.startsWith('skills/'))(d.items) })) }), 0);
  const m = readManifest(p);
  assert.deepEqual(Object.keys(m.sources), ['company', 'personal']);
  assert.deepEqual(m.sources.company.items, ['skills/s']);
  assert.ok(exists(p, '.ruler/base/00-a.md') && exists(p, '.ruler/skills/s/SKILL.md'));
  const order = [];
  await projectPick({ project: p, env, ...pickQuiet, open: driverMany([a, b], s => {
    order.push(s === a ? 'personal' : 'company');
    return {};
  }) });
  assert.deepEqual(order, ['company', 'personal']);
  assert.deepEqual(readManifest(p).sources.personal.items, ['rules/base/00-a.md']);
});

test('다른 출처가 쓰는 이름은 폼에서 blocked 이고, 매니페스트로 겹치게 하면 쓰지 않고 2', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t);
  await projectPick({ project: p, source: 'personal', server: a.base, env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id === 'rules/base/00-a.md')(d.items) })) });
  const seen = [];
  await projectPick({ project: p, source: 'company', server: b.base, env, ...pickQuiet, open: driverMany([a, b], () => ({ cancel: true }), seen) });
  const item = seen[0].data.items.find(i => i.id === 'rules/base/00-a.md');
  assert.equal(item.state, 'blocked');
  assert.match(item.reason, /다른 출처\(personal\)가 이미 쓰는 이름/);
  const m = JSON.parse(read(p, 'guideline.json'));
  m.sources.company = { server: b.base, items: ['rules/base/01-b.md'] };
  write(p, 'guideline.json', JSON.stringify(m));
  const before = read(p, 'guideline-lock.json');
  const e = collect();
  assert.equal(await projectPick({ project: p, source: 'company', env, ...pickQuiet, err: e.out, open: driverMany([a, b], () => ({})) }), 2);
  assert.match(e.text(), /이름 충돌: 스택 base — company 와 personal/);
  assert.equal(read(p, 'guideline-lock.json'), before);
  assert.equal(exists(p, 'docs/guideline/base/01-b.md'), false);
});

test('별칭을 주면 두 출처의 같은 이름 스택을 함께 받는다', async t => {
  const { a, b, env } = await servers(t);
  changed(b, '회사 본문');
  const p = project(t);
  await projectPick({ project: p, source: 'personal', server: a.base, env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id === 'rules/base/00-a.md')(d.items) })) });
  const m = JSON.parse(read(p, 'guideline.json'));
  m.sources.company = { server: b.base, items: [], aliases: { 'rules/base': 'company-base' } };
  write(p, 'guideline.json', JSON.stringify(m));
  assert.equal(await projectPick({ project: p, source: 'company', env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id === 'rules/company-base/00-a.md' || i.id === 'rules/company-base/SETUP.md')(d.items) })) }), 0);
  assert.match(read(p, '.ruler/company-base/00-a.md'), /회사 본문/);
  assert.match(read(p, '.ruler/base/00-a.md'), /본문 A/);
  assert.match(read(p, '.ruler/guideline.md'), /\| company-base \| company \| `docs\/guideline\/company-base\/SETUP\.md` \|/);
  assert.deepEqual(readManifest(p).sources.company.items, ['rules/base/00-a.md', 'rules/base/SETUP.md']);
});

test('취소한 출처는 이전 선택과 잠금 리비전 그대로다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  changed(a, '에이 새');
  changed(b, '비 새');
  assert.equal(await projectPick({ project: p, env, ...pickQuiet, open: driverMany([a, b], s => (s === a ? { cancel: true } : {})) }), 0);
  assert.match(read(p, '.ruler/b-base/00-a.md'), /비 새/);
  assert.match(read(p, '.ruler/base/00-a.md'), /본문 A/);
  assert.deepEqual(readLock(p).revisions, { a: 1, b: 2 });
  assert.equal(await projectPick({ project: p, env, ...pickQuiet, open: driverMany([a, b], () => ({ cancel: true })) }), 3);
});

test('propose 는 출처마다 제안 하나를 그 서버에 올리고, 별칭은 원래 경로로 되돌린다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  write(p, '.ruler/base/00-a.md', `${read(p, '.ruler/base/00-a.md')}에이 고침\n`);
  write(p, '.ruler/b-base/00-a.md', `${read(p, '.ruler/b-base/00-a.md')}비 고침\n`);
  const o = collect();
  assert.equal(await propose({ project: p, title: '다듬기', env, out: o.out, err: () => {} }), 0);
  assert.deepEqual(a.proposals.get(1).changes.map(c => c.path), ['rules/base/00-a.md']);
  assert.match(a.proposals.get(1).changes[0].content.toString(), /에이 고침/);
  assert.deepEqual(b.proposals.get(1).changes.map(c => c.path), ['rules/base/00-a.md']);
  assert.match(b.proposals.get(1).changes[0].content.toString(), /^---\nload: always\n---\n/);
  assert.match(o.text(), /a: 제안 등록 완료: #1/);
  assert.match(o.text(), /b: 제안 등록 완료: #1/);
});

test('propose: 출처마다 범위를 따로 본다 — admin 토큰 출처는 바로 반영, propose 토큰 출처는 대기 제안', async t => {
  const { a, b, env } = await servers(t);
  saveToken(a.base, { token: a.tokens.issue({ name: 'boss', scope: 'admin' }).token, name: 'boss' }, { env });
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  write(p, '.ruler/base/00-a.md', `${read(p, '.ruler/base/00-a.md')}에이 고침\n`);
  write(p, '.ruler/b-base/00-a.md', `${read(p, '.ruler/b-base/00-a.md')}비 고침\n`);
  const o = collect();
  assert.equal(await propose({ project: p, title: '섞임', env, out: o.out, err: () => {} }), 0);
  assert.equal(a.store.headRevision(), 2);
  assert.equal(a.proposals.list({ status: 'pending' }).length, 0);
  assert.equal(b.store.headRevision(), 1);
  assert.equal(b.proposals.list({ status: 'pending' }).length, 1);
  assert.match(o.text(), /a: 반영 완료: r2/);
  assert.match(o.text(), /a: admin 토큰이라 검토 없이 바로 반영함/);
  assert.match(o.text(), /b: 제안 등록 완료: #1/);
  assert.doesNotMatch(o.text(), /b: admin 토큰이라/);
});

test('propose --source 는 그 출처만, 한 출처가 권한이 없으면 나머지는 올리고 1', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  write(p, '.ruler/base/00-a.md', `${read(p, '.ruler/base/00-a.md')}에이 고침\n`);
  write(p, '.ruler/b-base/00-a.md', `${read(p, '.ruler/b-base/00-a.md')}비 고침\n`);
  assert.equal(await propose({ project: p, source: 'b', title: 'b 만', env, out: () => {}, err: () => {} }), 0);
  assert.equal(a.proposals.list({}).length, 0);
  assert.equal(b.proposals.list({}).length, 1);
  saveToken(a.base, { token: a.tokens.issue({ name: 'ro', scope: 'read' }).token, name: 'ro' }, { env });
  const e = collect();
  assert.equal(await propose({ project: p, title: '둘 다', env, out: () => {}, err: e.out }), 1);
  assert.equal(b.proposals.list({}).length, 2);
  assert.match(e.text(), /제안 권한이 없는 토큰/);
});

test('source --source 는 그 출처의 서버에서 원본을 푼다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  const folder = path.join(tmpDir('guideline-src-'), 'src');
  assert.equal(await source({ dir: folder, sourceName: 'b', cwd: p, env, out: () => {}, err: () => {} }), 0);
  assert.equal(JSON.parse(read(folder, '.guideline-source.json')).server, b.base);
});

test('출처 폼: 별칭 스택은 별칭 이름으로 보이고, 다른 출처의 사본은 「원본에서 사라짐」 에 나오지 않는다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t);
  await projectPick({ project: p, source: 'personal', server: a.base, env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id.startsWith('rules/base/'))(d.items) })) });
  const m = JSON.parse(read(p, 'guideline.json'));
  m.sources.company = { server: b.base, items: [], aliases: { 'rules/base': 'company-base' } };
  write(p, 'guideline.json', JSON.stringify(m));
  const seen = [];
  await projectPick({ project: p, source: 'company', env, ...pickQuiet, open: driverMany([a, b], () => ({ cancel: true }), seen) });
  const { data } = seen[0];
  assert.ok(data.catalog.stacks.some(x => x.name === 'company-base'));
  assert.equal(data.catalog.stacks.some(x => x.name === 'base'), false);
  assert.deepEqual(data.items.filter(i => i.kind === 'orphan').map(i => i.id), []);
});

test('한 출처의 폼에서 막힌 항목의 결정이 같은 이름의 다른 출처 항목에 번지지 않는다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t);
  await projectPick({ project: p, source: 'personal', server: a.base, env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id.startsWith('rules/base/'))(d.items) })) });
  assert.ok(exists(p, '.ruler/base/99-reference.md'));
  assert.equal(await projectPick({ project: p, source: 'company', server: b.base, env, ...pickQuiet,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id === 'skills/s')(d.items) })) }), 0);
  assert.ok(exists(p, '.ruler/base/99-reference.md'));
  assert.ok(exists(p, 'docs/guideline/base/01-b.md'));
  assert.ok(exists(p, '.ruler/skills/s/SKILL.md'));
});

test('update: 닿지 못한 출처의 색인과 관리 지침은 건드리지 않는다', async t => {
  const { a, b, env } = await servers(t);
  b.store.commit({ ...META, changes: { 'docs/management.md': '## 보안\n\n검토\n' } });
  const p = project(t, { 'guideline.json': manifestText({ version: 2, form: 'ruler', agents: ['claude'], sources: {
    a: { server: a.base, items: ['rules/base/00-a.md'] },
    b: { server: b.base, items: ['rules/base/00-a.md', 'rules/base/01-b.md'], aliases: { 'rules/base': 'b-base' } },
  } }) });
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  const index = read(p, '.ruler/b-base/99-reference.md');
  const management = read(p, '.ruler/guideline.md');
  assert.match(management, /## b 추가 지침/);
  changed(a, '에이 새');
  const m = JSON.parse(read(p, 'guideline.json'));
  m.sources.b.server = 'http://127.0.0.1:9';
  write(p, 'guideline.json', JSON.stringify(m));
  saveToken('http://127.0.0.1:9', { token: 'glt_dead', name: 'x' }, { env });
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 1);
  assert.match(read(p, '.ruler/base/00-a.md'), /에이 새/);
  assert.equal(read(p, '.ruler/b-base/99-reference.md'), index);
  assert.equal(read(p, '.ruler/guideline.md'), management);
  assert.ok(readLock(p).outputs.some(o => o.path === '.ruler/b-base/99-reference.md'));
});

// 최종 검토에서 나온 회귀들.

test('고르지 않은 같은 이름 단위가 다른 출처에서 고른 단위의 내용을 덮지 않는다', async t => {
  const { a, b, env } = await servers(t);
  changed(b, '비 내용');
  const p = project(t, { 'guideline.json': manifestText({ version: 2, form: 'ruler', agents: ['claude'], sources: {
    a: { server: a.base, items: ['skills/s'] },
    b: { server: b.base, items: ['rules/base/00-a.md'] },
  } }) });
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  assert.match(read(p, '.ruler/base/00-a.md'), /비 내용/);
  const o = collect();
  await projectStatus({ project: p, env, json: true, out: o.out, err: () => {} });
  assert.ok(JSON.parse(o.text()).items.every(i => i.state === 'current'));
});

test('GUIDELINE_TOKEN 은 출처가 여럿인 프로젝트에서 어느 서버로도 나가지 않는다(pick --source, status --source)', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': manifestText({ version: 2, form: 'ruler', agents: ['claude'], sources: {
    a: { server: a.base, items: ['rules/base/00-a.md'] },
    b: { server: b.base, items: ['skills/s'] },
  } }) });
  assert.equal(await projectUpdate({ project: p, env, ...quiet, out: () => {} }), 0);
  const leaked = [];
  const fetchImpl = (url, init) => {
    if (init?.headers?.Authorization === 'Bearer glt_ENV_SECRET') leaked.push(new URL(url).origin);
    return fetch(url, init);
  };
  const env2 = { ...env, GUIDELINE_TOKEN: 'glt_ENV_SECRET' };
  assert.equal(await projectPick({ project: p, source: 'a', env: env2, ...pickQuiet, fetchImpl,
    open: driverMany([a, b], (s, d) => ({ choices: checkOnly(i => i.id === 'rules/base/00-a.md')(d.items) })) }), 0);
  assert.equal(await projectStatus({ project: p, source: 'b', env: env2, out: () => {}, err: () => {}, fetchImpl }), 0);
  assert.deepEqual(leaked, []);
});

test('update·status·propose 는 매니페스트의 이름 겹침을 보면 아무것도 쓰지 않고 2', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  const m = JSON.parse(read(p, 'guideline.json'));
  delete m.sources.b.aliases;
  write(p, 'guideline.json', JSON.stringify(m));
  const before = snapshot(p);
  const lockBefore = read(p, 'guideline-lock.json');
  for (const run of [
    o => projectUpdate({ project: p, env, ...quiet, ...o }),
    o => projectStatus({ project: p, env, ...o }),
    o => propose({ project: p, env, dryRun: true, ...o }),
  ]) {
    const e = collect();
    assert.equal(await run({ err: e.out, out: () => {} }), 2);
    assert.match(e.text(), /이름 충돌: 스택 base — a 와 b/);
  }
  assert.deepEqual(snapshot(p), before);
  assert.equal(read(p, 'guideline-lock.json'), lockBefore);
});

test('status --source 는 다른 출처의 잠금을 섞지 않는다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': manifestText({ version: 2, form: 'ruler', agents: ['claude'], sources: {
    a: { server: a.base, items: ['skills/s'] },
    b: { server: b.base, items: ['skills/s'], aliases: { 'skills/s': 'bs' } },
  } }) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  for (const source of ['a', 'b']) {
    const o = collect();
    assert.equal(await projectStatus({ project: p, source, env, json: true, out: o.out, err: () => {} }), 0);
    const s = JSON.parse(o.text());
    assert.deepEqual(s.items, [{ id: `${source}:skills/s`, state: 'current' }]);
    assert.ok(s.outputs.every(x => x.state === 'current'), JSON.stringify(s.outputs));
  }
});

test('별칭을 바꿔도 프로젝트에서 고친 예전 자리 사본은 지우지 않고 할 일로 남긴다', async t => {
  const { a, b, env } = await servers(t);
  const p = project(t, { 'guideline.json': twoSources(a, b) });
  await projectUpdate({ project: p, env, ...quiet, out: () => {} });
  write(p, '.ruler/b-base/00-a.md', `${read(p, '.ruler/b-base/00-a.md')}\n내 수정\n`);
  write(p, 'guideline.json', twoSources(a, b, 'bb'));
  const o = collect();
  assert.equal(await projectUpdate({ project: p, env, ...quiet, json: true, out: o.out }), 0);
  assert.match(read(p, '.ruler/b-base/00-a.md'), /내 수정/);
  assert.match(read(p, '.ruler/bb/00-a.md'), /본문 A/);
  assert.ok(JSON.parse(o.text()).todos.some(x => x.kind === 'leftover' && x.message.includes('.ruler/b-base/00-a.md')));
  assert.ok(!readLock(p).outputs.some(x => x.path === '.ruler/b-base/00-a.md'));
});
