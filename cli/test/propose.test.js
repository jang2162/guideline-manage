import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, collect, ALWAYS } from './helpers.js';
import { SOURCE, ALL, manifestOf } from './render-fixture.js';
import { render } from '../src/render/index.js';
import { applyFiles } from '../src/apply.js';
import { diskReader } from '../src/project-state.js';
import { manifestText, lockText } from '../src/manifest.js';
import { memoryTree, readText } from '../src/tree.js';
import { sha256 } from '../src/hashes.js';
import { propose } from '../src/commands/propose.js';
import { localChanges, toRealChanges, changeOf } from '../src/propose.js';
import { sourceView } from '../src/sources.js';

async function setup(t, scope = 'propose') {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'web', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-p', scope }).token;
  const p = tmpDir('guideline-propose-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude", "codex"]\n');
  const manifest = manifestOf('ruler', ALL, { server: s.base });
  const r = render({ tree: memoryTree(SOURCE), revision: 1, manifest, lock: null, project: diskReader(p) });
  applyFiles(p, r.files);
  write(p, 'guideline.json', manifestText(manifest));
  write(p, 'guideline-lock.json', lockText(r.lock));
  return { s, p, env: { GUIDELINE_TOKEN: token } };
}
const run = (opts, extra = {}) => {
  const o = collect();
  const e = collect();
  return propose({ out: o.out, err: e.out, ...opts, ...extra }).then(code => ({ code, out: o.text(), err: e.text() }));
};

test('고친 지침·세팅 문서·스킬(더함·지움)을 원본 모양으로 되돌려 제안한다', async t => {
  const { s, p, env } = await setup(t);
  write(p, '.ruler/base/00-a.md', '# 에이\n\n다듬은 본문\n');
  write(p, 'docs/guideline/base/SETUP.md', '# base 세팅\n\n한 줄 더\n');
  write(p, '.ruler/skills/s/new.md', '새 파일\n');
  fs.rmSync(path.join(p, '.ruler/skills/s/img/a.png'));
  const r = await run({ project: p, env, title: '다듬기' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /제안 등록 완료: #1 — /);
  const got = s.proposals.get(1);
  assert.equal(got.title, '다듬기');
  assert.equal(got.project, path.basename(p));
  assert.equal(got.author, 'cli-p');
  const by = Object.fromEntries(got.changes.map(c => [c.path, c]));
  assert.deepEqual(Object.keys(by).sort(), ['rules/base/00-a.md', 'rules/base/SETUP.md', 'skills/s/img/a.png', 'skills/s/new.md']);
  assert.equal(by['rules/base/00-a.md'].content.toString(), `${ALWAYS}# 에이\n\n다듬은 본문\n`);
  assert.equal(by['rules/base/00-a.md'].base, sha256(Buffer.from(SOURCE['rules/base/00-a.md'])));
  assert.equal(by['skills/s/new.md'].base, null);
  assert.equal(by['skills/s/img/a.png'].content, null);
  assert.equal(by['skills/s/img/a.png'].base, sha256(SOURCE['skills/s/img/a.png']));
});

test('줄바꿈만 다르면 올릴 것이 없고, MCP 수정은 할 일 mcp-local 로 알린다', async t => {
  const { s, p, env } = await setup(t);
  write(p, '.ruler/base/00-a.md', '# 에이\r\n\r\n## 절 하나\r\n\r\n본문 A\r\n\r\n### 아래\r\n\r\n깊이\r\n');
  const toml = fs.readFileSync(path.join(p, '.ruler/ruler.toml'), 'utf8').replace('args = ["-y", "c7"]', 'args = ["-y", "c7@2"]');
  write(p, '.ruler/ruler.toml', toml);
  const r = await run({ project: p, env, json: true });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.changes, []);
  assert.deepEqual(out.todos.map(x => [x.kind, x.item]), [['mcp-local', 'mcp/c7']]);
  assert.equal(s.proposals.list({}).length, 0);
});

test('--dry-run 은 보내지 않고 차이를 보이며, --only 는 항목을 거른다', async t => {
  const { s, p, env } = await setup(t);
  write(p, '.ruler/base/00-a.md', '# 에이\n\n다듬은 본문\n');
  write(p, 'docs/guideline/base/SETUP.md', '# 바꿈\n');
  const dry = await run({ project: p, env, dryRun: true, only: ['rules/base/00-a.md'] });
  assert.equal(dry.code, 0);
  assert.match(dry.out, /바뀜  rules\/base\/00-a\.md/);
  assert.match(dry.out, /\+다듬은 본문/);
  assert.doesNotMatch(dry.out, /SETUP\.md/);
  assert.equal(s.proposals.list({}).length, 0);
});

test('read 토큰이면 권한 안내와 함께 1, 잠금이 없거나 ruler 가 아니면 2', async t => {
  const { p, env } = await setup(t, 'read');
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const denied = await run({ project: p, env });
  assert.equal(denied.code, 1);
  assert.match(denied.err, /제안 권한이 없는 토큰 — 관리자에게 propose 범위 토큰을 받아/);
  fs.rmSync(path.join(p, 'guideline-lock.json'));
  assert.equal((await run({ project: p, env })).code, 2);
  fs.rmSync(path.join(p, '.ruler'), { recursive: true });
  assert.match((await run({ project: p, env })).err, /ruler 프로젝트가 아님/);
});

test('받기 전부터 원본과 달랐던 사본은 기본으로 올리지 않고 할 일 adopted 로 알린다. --only 로 집으면 올린다', t => {
  const p = tmpDir('guideline-adopt-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  write(p, '.ruler/base/00-a.md', '# 옛 사본\n');
  const manifest = manifestOf('ruler', ['rules/base/00-a.md'], { server: 'http://x' });
  const r = render({ tree: memoryTree(SOURCE), revision: 1, manifest, lock: null, project: diskReader(p) });
  applyFiles(p, r.files);
  const lock = structuredClone(r.lock);
  const a = localChanges({ base: memoryTree(SOURCE), project: p, lock });
  assert.deepEqual(a.changes, []);
  assert.deepEqual(a.todos.map(x => [x.kind, x.item]), [['adopted', 'rules/base/00-a.md']]);
  const b = localChanges({ base: memoryTree(SOURCE), project: p, lock, only: new Set(['rules/base/00-a.md']) });
  assert.deepEqual(b.changes.map(c => c.path), ['rules/base/00-a.md']);
});

test('toRealChanges: 별칭 스킬의 name 줄을 되돌리고 기준 해시는 원래 원본 기준이다', () => {
  const company = memoryTree(SOURCE);
  const sources = [{ name: 'company', items: ['skills/s'], aliases: { 'skills/s': 'company-s' } }];
  const view = sourceView(company, sources[0].aliases);
  const edited = readText(view, 'skills/company-s/SKILL.md').replace(/\n$/, '\n더한 줄\n');
  const viewChanges = [changeOf(view, 'skills/company-s/SKILL.md', Buffer.from(edited))];
  const real = toRealChanges({ changes: viewChanges, sources, trees: new Map([['company', { tree: company }]]) });
  const [c] = real.get('company');
  assert.equal(c.path, 'skills/s/SKILL.md');
  assert.match(c.content.toString(), /^---\nname: s\n/);
  assert.match(c.content.toString(), /더한 줄\n$/);
  assert.equal(c.base, sha256(Buffer.from(SOURCE['skills/s/SKILL.md'])));
});

test('propose --apply 는 admin 토큰이면 바로 반영하고 리비전을 알린다', async t => {
  const { s, p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 에이\n\n바로 반영\n');
  const r = await run({ project: p, env, title: '바로', apply: true });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /반영 완료: r2 — /);
  assert.equal(s.store.headRevision(), 2);
  assert.equal(s.proposals.list({ status: 'pending' }).length, 0);
});

test('propose --apply 를 propose 토큰으로 하면 1 과 admin 토큰 안내', async t => {
  const { s, p, env } = await setup(t);
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const r = await run({ project: p, env, apply: true });
  assert.equal(r.code, 1);
  assert.match(r.err, /admin 토큰 필요 — /);
  assert.equal(s.proposals.list({}).length, 0);
});

test('--review 면 admin 토큰이어도 대기 제안', async t => {
  const { s, p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const r = await run({ project: p, env, review: true });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /제안 등록 완료: #1 — /);
  assert.doesNotMatch(r.out, /바로 반영/);
  assert.equal(s.proposals.list({ status: 'pending' }).length, 1);
  assert.equal(s.store.headRevision(), 1);
});

test('admin 토큰이면 플래그 없이도 바로 반영하고, 그렇게 했다는 줄과 --review 안내를 낸다', async t => {
  const { s, p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 에이\n\n기본 반영\n');
  const r = await run({ project: p, env, title: '기본' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /반영 완료: r2 — /);
  assert.match(r.out, /admin 토큰이라 검토 없이 바로 반영함 — 검토를 받으려면 --review/);
  assert.equal(s.store.headRevision(), 2);
  assert.equal(s.proposals.list({ status: 'pending' }).length, 0);
});

test('propose 토큰이면 플래그 없이 대기 제안이고 바로 반영 안내가 없다', async t => {
  const { s, p, env } = await setup(t);
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const r = await run({ project: p, env });
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /바로 반영/);
  assert.equal(s.proposals.list({ status: 'pending' }).length, 1);
  assert.equal(s.store.headRevision(), 1);
});

test('--json 은 mode 로 반영인지 제안인지 알린다', async t => {
  const admin = await setup(t, 'admin');
  write(admin.p, '.ruler/base/00-a.md', '# 고침\n');
  const a = JSON.parse((await run({ project: admin.p, env: admin.env, json: true })).out);
  assert.equal(a.mode, 'apply');
  assert.equal(a.status, 'accepted');
  assert.equal(a.revision, 2);
  const prop = await setup(t);
  write(prop.p, '.ruler/base/00-a.md', '# 고침\n');
  const b = JSON.parse((await run({ project: prop.p, env: prop.env, json: true })).out);
  assert.equal(b.mode, 'proposal');
  assert.equal(b.status, 'pending');
  const admin2 = await setup(t, 'admin');
  write(admin2.p, '.ruler/base/00-a.md', '# 고침\n');
  const c = JSON.parse((await run({ project: admin2.p, env: admin2.env, json: true, review: true })).out);
  assert.equal(c.mode, 'proposal');
});

test('--dry-run 은 admin 토큰이어도 보내지 않고, 보내면 어느 방식인지 알린다', async t => {
  const { s, p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const dry = await run({ project: p, env, dryRun: true });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /보내면 바로 반영됨\(admin 토큰\) — 검토를 받으려면 --review/);
  const json = JSON.parse((await run({ project: p, env, dryRun: true, json: true })).out);
  assert.equal(json.mode, 'apply');
  const review = JSON.parse((await run({ project: p, env, dryRun: true, json: true, review: true })).out);
  assert.equal(review.mode, 'proposal');
  const reviewText = await run({ project: p, env, dryRun: true, review: true });
  assert.match(reviewText.out, /보내면 검토를 기다리는 제안이 됨/);
  assert.equal(s.store.headRevision(), 1);
  assert.equal(s.proposals.list({}).length, 0);
});

test('--apply 와 --review 를 같이 주면 2', async t => {
  const { s, p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const r = await run({ project: p, env, apply: true, review: true });
  assert.equal(r.code, 2);
  assert.match(r.err, /--apply 와 --review 는 같이 쓸 수 없음/);
  assert.equal(s.proposals.list({}).length, 0);
  assert.equal(s.store.headRevision(), 1);
});

test('whoami 가 없는 옛 서버(404)면 admin 토큰이어도 예전처럼 대기 제안', async t => {
  const { s, p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const old = (url, init) => (String(url).endsWith('/api/v1/whoami')
    ? Promise.resolve(new Response(JSON.stringify({ error: '페이지 없음' }), { status: 404 }))
    : fetch(url, init));
  const r = await run({ project: p, env, fetchImpl: old, json: true });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).mode, 'proposal');
  assert.equal(r.err, '', '옛 서버는 경고 없이 조용히 제안');
  assert.equal(s.proposals.list({ status: 'pending' }).length, 1);
  assert.equal(s.store.headRevision(), 1);
});

test('whoami 가 없는 옛 서버(404)에서도 --apply 는 예전처럼 바로 반영한다', async t => {
  const { s, p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const old = (url, init) => (String(url).endsWith('/api/v1/whoami')
    ? Promise.resolve(new Response(JSON.stringify({ error: '페이지 없음' }), { status: 404 }))
    : fetch(url, init));
  const r = await run({ project: p, env, fetchImpl: old, apply: true });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /반영 완료: r2 — /);
  assert.doesNotMatch(r.out, /admin 토큰이라/);
  assert.equal(s.store.headRevision(), 2);
});

test('whoami 가 404 가 아닌 오류(500·프록시 403·네트워크)면 경고 한 줄을 내고 제안으로 보낸다', async t => {
  const failures = {
    500: () => Promise.resolve(new Response(JSON.stringify({ error: '서버 오류' }), { status: 500 })),
    403: () => Promise.resolve(new Response('<html>forbidden</html>', { status: 403 })),
    network: () => Promise.reject(new TypeError('fetch failed')),
  };
  for (const [name, fail] of Object.entries(failures)) {
    const { s, p, env } = await setup(t, 'admin');
    write(p, '.ruler/base/00-a.md', '# 고침\n');
    const broken = (url, init) => (String(url).endsWith('/api/v1/whoami') ? fail() : fetch(url, init));
    const r = await run({ project: p, env, fetchImpl: broken, json: true });
    assert.equal(r.code, 0, `${name}: ${r.err}`);
    assert.equal(JSON.parse(r.out).mode, 'proposal', name);
    assert.equal(r.err.trim().split('\n').length, 1, name);
    assert.match(r.err, /토큰 범위를 확인하지 못해 제안으로 보냄 — 바로 반영하려면 --apply/, name);
    assert.equal(s.proposals.list({ status: 'pending' }).length, 1, name);
    assert.equal(s.store.headRevision(), 1, name);
  }
});

test('--apply --json 은 status 와 revision 을 낸다', async t => {
  const { p, env } = await setup(t, 'admin');
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const r = await run({ project: p, env, apply: true, json: true });
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.status, 'accepted');
  assert.equal(out.revision, 2);
});
