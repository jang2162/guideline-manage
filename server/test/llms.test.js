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
  for (const kind of ['mcp-build', 'env', 'setup', 'conflict', 'skipped', 'override', 'subagents-off', 'ruler-apply', 'new-file', 'removed-upstream', 'blocked', 'leftover', 'nested-off', 'mcp-local', 'adopted', 'alias']) {
    assert.ok(text.includes(`\`${kind}\``), `할 일 ${kind}`);
  }
  assert.doesNotMatch(text, /old-section|guideline:begin|CLAUDE\.md·AGENTS\.md 형/);
  assert.match(text, /POST http:\/\/guideline\.test\/api\/v1\/proposals/);
  assert.match(text, /guideline pick --source/);
  assert.match(text, /"aliases"/);
});

test('화면 상단에 사용법(/usage) 링크가 있다', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  assert.match((await s.req('/', { headers: { Cookie: cookie } })).text, /<a href="\/usage">사용법<\/a>/);
});
