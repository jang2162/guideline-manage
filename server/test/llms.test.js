import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, login } from './helpers.js';

test('/llms.txt 는 로그인 없이 열리고, 이 서버의 주소로 사용·세팅 방법을 낸다', async t => {
  const s = await startApp(t);
  const r = await s.req('/llms.txt');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/plain; charset=utf-8');
  const text = r.text;
  assert.match(text, /^# 지침 서버\n\n> /);
  assert.match(text, /guideline login --server http:\/\/guideline\.test\n/);
  assert.doesNotMatch(text, /\{\{/);
  for (const cmd of ['guideline pick', 'guideline status', 'guideline update', 'guideline pick --new', 'guideline propose', 'guideline source']) assert.ok(text.includes(cmd), cmd);
  for (const kind of ['mcp-build', 'env', 'setup', 'conflict', 'skipped', 'override', 'subagents-off', 'ruler-apply', 'removed-upstream', 'blocked', 'leftover', 'nested-off', 'adopted', 'alias', 'apply', 'root-apply', 'untracked', 'stray-ruler-output', 'override-unchosen', 'no-copy', 'mcp-conflict', 'dev-dependency', 'apply-hook', 'migrated', 'manifest-v3', 'prepare']) {
    assert.ok(text.includes(`\`${kind}\``), `할 일 ${kind}`);
  }
  assert.doesNotMatch(text, /`mcp-local`|`moved`|`new-file`/);
  // 새 배치: 사본은 .guideline/, 생성물은 gitignore, 클론 직후에는 guideline apply
  for (const want of ['guideline apply', '.guideline/rules/<스택>/NN-*.md', '.ruler/ruler.project.toml', '# START guideline generated files', '.guideline/overrides/<스택 경로>/override.md']) assert.ok(text.includes(want), want);
  assert.doesNotMatch(text, /`\.ruler\/<스택>\/override\.md`|사본 자리: /);
  assert.doesNotMatch(text, /old-section|guideline:begin|CLAUDE\.md·AGENTS\.md 형/);
  assert.match(text, /POST http:\/\/guideline\.test\/api\/v1\/proposals/);
  assert.match(text, /guideline pick --source/);
  assert.match(text, /"aliases"/);
  // 개인 범위: pick --local 과 그 할 일, 머신 기본값
  for (const want of ['guideline pick --local', '## 내 머신에서만 (개인 범위)', 'defaults.json', 'info/exclude', 'scope: "personal"']) assert.ok(text.includes(want), want);
  for (const kind of ['setup-personal', 'personal-ignored', 'personal-shadowed', 'personal-revision', 'personal-sync', 'local-bad', 'ruler-leftover', 'override-target', 'unit-write-failed']) {
    assert.ok(text.includes(`| \`${kind}\` |`), `할 일 ${kind}`);
  }
});

test('화면 상단에 사용법(/usage) 링크가 있다', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  assert.match((await s.req('/', { headers: { Cookie: cookie } })).text, /<a href="\/usage">사용법<\/a>/);
});
