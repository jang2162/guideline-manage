import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, login, getAs, postForm, META } from './helpers.js';
import { catalogSummary } from '../../cli/src/summary.js';
import { dbTree } from '../src/db-tree.js';

const summaryOf = s => catalogSummary(dbTree(s.store));

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': '---\nload: always\n---\n# a\n' } });
  return { s, cookie: await login(s) };
}

test('관리자 목록에만 블록 추가 카드가 있다', async t => {
  const { s, cookie } = await setup(t);
  assert.ok((await getAs(s, cookie, '/')).text.includes('href="/add?kind=stack"'));
  assert.ok((await getAs(s, cookie, '/skills')).text.includes('href="/add?kind=skill"'));
  assert.ok((await getAs(s, cookie, '/agents')).text.includes('href="/add?kind=agent"'));
  assert.ok((await getAs(s, cookie, '/mcp')).text.includes('href="/add?kind=mcp"'));
  assert.ok(!(await s.req('/')).text.includes('/add?kind='));
  assert.ok(!(await getAs(s, cookie, '/')).text.includes('href="/new'));
});

test('추가 폼은 관리자만, 스택이면 도메인 칸이 있다', async t => {
  const { s, cookie } = await setup(t);
  assert.equal((await s.req('/add?kind=stack')).status, 303);
  const stack = (await getAs(s, cookie, '/add?kind=stack')).text;
  assert.ok(stack.includes('name="domain"'));
  assert.ok(stack.includes('name="categories"'));
  assert.ok(!(await getAs(s, cookie, '/add?kind=skill')).text.includes('name="domain"'));
  assert.equal((await getAs(s, cookie, '/add?kind=nope')).status, 404);
});

test('스택 추가는 README 와 00-general.md 를 한 리비전으로 만들고 상세로 보낸다', async t => {
  const { s, cookie } = await setup(t);
  const head = s.store.headRevision();
  const r = await postForm(s, '/add', { kind: 'stack', name: 'deploy-package', domain: 'gitlab.develma.com', categories: 'deploy, ci' }, { cookie });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/s/deploy-package__gitlab.develma.com');
  assert.equal(s.store.headRevision(), head + 1);
  assert.ok(summaryOf(s).stacks.some(x => x.name === 'deploy-package__gitlab.develma.com'));
  const readme = s.store.fileAt('rules/deploy-package__gitlab.develma.com/README.md').toString();
  assert.match(readme, /^---\ncategories: \[deploy, ci\]\n---\n/);
  assert.match(readme, /# deploy-package__gitlab\.develma\.com /);
  assert.match(s.store.fileAt('rules/deploy-package__gitlab.develma.com/00-general.md').toString(), /^---\nload: always\n---\n/);
  assert.deepEqual(summaryOf(s).warnings, []);
  assert.equal((await getAs(s, cookie, r.headers.location)).status, 200);
});

test('스킬·서브에이전트·MCP 추가 뒤 목록에 경고 없이 뜬다', async t => {
  const { s, cookie } = await setup(t);
  for (const [kind, name, href] of [['skill', 'review', '/skills/review'], ['agent', 'tester', '/agents/tester'], ['mcp', 'context7', '/mcp/context7']]) {
    const r = await postForm(s, '/add', { kind, name, categories: '' }, { cookie });
    assert.equal(r.status, 303, kind);
    assert.equal(r.headers.location, href);
  }
  const sum = summaryOf(s);
  assert.deepEqual(sum.skills, ['review']);
  assert.deepEqual(sum.subagents, ['tester']);
  assert.deepEqual(sum.mcp.map(m => m.name), ['context7']);
  assert.deepEqual(sum.warnings, []);
  assert.deepEqual(sum.ignored, []);
  assert.match(s.store.fileAt('skills/review/SKILL.md').toString(), /^---\nname: review\n/);
  assert.match(s.store.fileAt('agents/tester.md').toString(), /^---\nname: tester\n/);
});

test('틀린 이름·도메인·이미 있는 이름은 400 이고 아무것도 쓰지 않는다', async t => {
  const { s, cookie } = await setup(t);
  const head = s.store.headRevision();
  const bad = async (fields, text) => {
    const r = await postForm(s, '/add', fields, { cookie });
    assert.equal(r.status, 400, JSON.stringify(fields));
    assert.ok(r.text.includes(text), text);
  };
  await bad({ kind: 'stack', name: 'Bad Name' }, '이름은 영문 소문자로 시작하고');
  await bad({ kind: 'stack', name: 'x', domain: 'nodomain' }, '도메인 형식이 아님');
  await bad({ kind: 'stack', name: 'base' }, '이미 있는 이름');
  assert.equal(s.store.headRevision(), head);
  assert.equal((await postForm(s, '/add', { kind: 'stack', name: 'x' }, { cookie, origin: 'http://evil.test' })).status, 403);
});
