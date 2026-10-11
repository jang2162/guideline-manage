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
