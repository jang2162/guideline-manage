import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, login, getAs, postForm, META } from './helpers.js';
import { frontmatter } from '../../cli/src/frontmatter.js';
import { catalogSummary } from '../../cli/src/summary.js';
import { dbTree } from '../src/db-tree.js';

const FILES = {
  'rules/base/README.md': '# base\n',
  'rules/base/00-a.md': '---\nload: always\n---\n# a\n',
  'skills/s/SKILL.md': '---\nname: s\ndescription: 스킬\n---\n# s\n',
  'agents/w.md': '---\nname: w\ndescription: 작업\n---\n# w\n',
  'mcp/m/README.md': '# m\n',
  'mcp/m/server.json': '{"type":"stdio","command":"npx"}\n',
};

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: FILES });
  return { s, cookie: await login(s) };
}

const text = (s, p) => s.store.fileAt(p)?.toString('utf8') ?? null;
const summary = s => catalogSummary(dbTree(s.store, s.store.headRevision()));
const post = (s, cookie, path, fields) => postForm(s, path, { message: '설정', ...fields }, { cookie });

test('블록 설정 페이지는 관리자에게 기본 정보·파일·위험 칸을 보이고, 로그인 안 하면 로그인으로', async t => {
  const { s, cookie } = await setup(t);
  const page = await getAs(s, cookie, '/settings/stack/base');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('name="label"'));
  assert.ok(page.text.includes('name="categories"'));
  assert.ok(page.text.includes('href="/new?dir=rules%2Fbase"'));
  assert.ok(page.text.includes('data-upload="rules/base"'));
  assert.ok(page.text.includes('value="rename"'));
  assert.ok(page.text.includes('value="delete"'));
  assert.equal((await s.req('/settings/stack/base')).status, 303);
  assert.equal((await getAs(s, cookie, '/settings/stack/nope')).status, 404);
  assert.equal((await getAs(s, cookie, '/settings/bogus/base')).status, 404);
});

test('표시 이름·분류 저장은 블록의 frontmatter 파일에 쓰고, 빈 값이면 줄을 지운다', async t => {
  const { s, cookie } = await setup(t);
  const r = await post(s, cookie, '/settings/stack/base', { action: 'meta', label: '사내 개발서버 배포', categories: 'deploy, backend' });
  assert.equal(r.status, 303);
  const fm = frontmatter(text(s, 'rules/base/README.md'));
  assert.equal(fm.label, '사내 개발서버 배포');
  assert.equal(fm.categories, '[deploy, backend]');
  await post(s, cookie, '/settings/stack/base', { action: 'meta', label: 'a: b', categories: 'deploy' });
  assert.equal(summary(s).labels['rules/base'], 'a: b');
  await post(s, cookie, '/settings/stack/base', { action: 'meta', label: '', categories: '' });
  const after = frontmatter(text(s, 'rules/base/README.md')) ?? {};
  assert.equal(after.label, undefined);
  assert.equal(after.categories, undefined);
});

test('스킬·서브에이전트·MCP 의 표시 이름은 각자의 frontmatter 파일에 쓴다', async t => {
  const { s, cookie } = await setup(t);
  await post(s, cookie, '/settings/skill/s', { action: 'meta', label: '스킬 이름', categories: '' });
  await post(s, cookie, '/settings/agent/w', { action: 'meta', label: '작업자', categories: '' });
  await post(s, cookie, '/settings/mcp/m', { action: 'meta', label: '엠', categories: '' });
  assert.deepEqual(summary(s).labels, { 'skills/s': '스킬 이름', 'agents/w.md': '작업자', 'mcp/m': '엠' });
});

test('블록 이름 바꾸기는 name: 줄도 고쳐 목록에 남고, 스택은 도메인을 붙일 수 있다', async t => {
  const { s, cookie } = await setup(t);
  assert.equal((await post(s, cookie, '/settings/agent/w', { action: 'rename', name: 'w2' })).status, 303);
  assert.ok(summary(s).subagents.includes('w2'));
  assert.equal(frontmatter(text(s, 'agents/w2.md')).name, 'w2');
  await post(s, cookie, '/settings/skill/s', { action: 'rename', name: 's2' });
  assert.ok(summary(s).skills.includes('s2'));
  assert.equal(frontmatter(text(s, 'skills/s2/SKILL.md')).name, 's2');
  const r = await post(s, cookie, '/settings/stack/base', { action: 'rename', name: 'core', domain: 'gitlab.example.com' });
  assert.equal(r.headers.location, '/settings/stack/core__gitlab.example.com');
  assert.ok(summary(s).stacks.some(x => x.name === 'core__gitlab.example.com'));
  assert.equal(text(s, 'rules/base/00-a.md'), null);
});

test('블록 이름 규칙 위반은 400, 이미 있는 이름은 409', async t => {
  const { s, cookie } = await setup(t);
  assert.equal((await post(s, cookie, '/settings/skill/s', { action: 'rename', name: 'Bad' })).status, 400);
  s.store.commit({ ...META, changes: { 'skills/t/SKILL.md': '---\nname: t\ndescription: x\n---\n' } });
  assert.equal((await post(s, cookie, '/settings/skill/s', { action: 'rename', name: 't' })).status, 409);
});

test('블록 삭제는 블록 파일을 모두 지우고 그 탭 목록으로 간다', async t => {
  const { s, cookie } = await setup(t);
  const r = await post(s, cookie, '/settings/mcp/m', { action: 'delete' });
  assert.equal(r.headers.location, '/mcp');
  assert.equal(text(s, 'mcp/m/README.md'), null);
  assert.equal(text(s, 'mcp/m/server.json'), null);
  const a = await post(s, cookie, '/settings/agent/w', { action: 'delete' });
  assert.equal(a.headers.location, '/agents');
  assert.equal(text(s, 'agents/w.md'), null);
});

test('메시지가 없으면 400, 다른 출처면 거부', async t => {
  const { s, cookie } = await setup(t);
  assert.equal((await postForm(s, '/settings/stack/base', { action: 'meta', label: 'x' }, { cookie })).status, 400);
  assert.notEqual((await postForm(s, '/settings/stack/base', { action: 'meta', label: 'x', message: 'm' }, { cookie, origin: 'http://evil.example' })).status, 303);
});

test('블록 추가에서 표시 이름을 넣으면 첫 파일 frontmatter 에 label 이 들어간다', async t => {
  const { s, cookie } = await setup(t);
  await postForm(s, '/add', { kind: 'skill', name: 'new-skill', label: '새 스킬', categories: 'a], b: c' }, { cookie });
  assert.equal(summary(s).labels['skills/new-skill'], '새 스킬');
  assert.deepEqual(summary(s).categories['skills/new-skill'], ['a]', 'b: c']);
});

test('필요한 블록(requires)을 저장하고, 빈 값이면 줄을 지운다', async t => {
  const { s, cookie } = await setup(t);
  await post(s, cookie, '/settings/mcp/m', { action: 'meta', label: '', categories: '', requires: 'rules/base, skills/s' });
  assert.equal(frontmatter(text(s, 'mcp/m/README.md')).requires, '[rules/base, skills/s]');
  assert.deepEqual(summary(s).requires['mcp/m'], ['rules/base', 'skills/s']);
  assert.ok((await getAs(s, cookie, '/settings/mcp/m')).text.includes('value="rules/base, skills/s"'));
  await post(s, cookie, '/settings/mcp/m', { action: 'meta', label: '', categories: '', requires: '' });
  assert.equal((frontmatter(text(s, 'mcp/m/README.md')) ?? {}).requires, undefined);
});

test('블록 이름을 바꾸면 다른 블록의 requires 도 새 이름으로 고친다(한 리비전)', async t => {
  const { s, cookie } = await setup(t);
  await post(s, cookie, '/settings/mcp/m', { action: 'meta', label: '', categories: '', requires: 'rules/base' });
  await post(s, cookie, '/settings/agent/w', { action: 'meta', label: '', categories: '', requires: 'rules/base, mcp/m' });
  const head = s.store.headRevision();
  await post(s, cookie, '/settings/stack/base', { action: 'rename', name: 'core' });
  assert.equal(s.store.headRevision(), head + 1);
  assert.deepEqual(summary(s).requires['mcp/m'], ['rules/core']);
  assert.deepEqual(summary(s).requires['agents/w.md'], ['rules/core', 'mcp/m']);
  await post(s, cookie, '/settings/agent/w', { action: 'rename', name: 'w2' });
  await post(s, cookie, '/settings/mcp/m', { action: 'rename', name: 'm2' });
  assert.deepEqual(summary(s).requires['agents/w2.md'], ['rules/core', 'mcp/m2']);
});

test('블록 상세에 필요한 블록 링크가 보인다', async t => {
  const { s, cookie } = await setup(t);
  await post(s, cookie, '/settings/mcp/m', { action: 'meta', label: '', categories: '', requires: 'rules/base' });
  assert.ok((await s.req('/mcp/m')).text.includes('href="/s/base"'));
});

test('블록 추가에서 필요한 블록을 넣으면 첫 파일 frontmatter 에 requires 가 들어간다', async t => {
  const { s, cookie } = await setup(t);
  await postForm(s, '/add', { kind: 'mcp', name: 'new-mcp', requires: 'rules/base' }, { cookie });
  assert.deepEqual(summary(s).requires['mcp/new-mcp'], ['rules/base']);
});

const TREE = {
  'rules/browser/README.md': '# browser\n',
  'rules/browser/00-a.md': '---\nload: always\n---\n# a\n',
  'rules/browser/neo/README.md': '# neo\n',
  'rules/browser/neo/00-x.md': '---\nload: always\n---\n# x\n',
  'rules/browser/neo/deep/00-y.md': '---\nload: always\n---\n# y\n',
  'rules/tools/deploy__gitlab.example.com/00-d.md': '---\nload: always\n---\n# d\n',
  'skills/s/SKILL.md': '---\nname: s\ndescription: 스킬\nrequires: [rules/browser/neo, rules/browser/neo/deep]\n---\n# s\n',
};

async function tree(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: TREE });
  return { s, cookie: await login(s) };
}

test('부모 이름을 바꾸면 자손과 requires 키가 함께 바뀐다', async t => {
  const { s, cookie } = await tree(t);
  // 자손 스택이 다른 자손을 requires 로 가리켜도 옮긴 자리에서 고친다.
  await post(s, cookie, '/settings/stack/browser/neo', { action: 'meta', requires: 'rules/browser/neo/deep' });
  const head = s.store.headRevision();
  const r = await post(s, cookie, '/settings/stack/browser', { action: 'rename', name: 'web' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/settings/stack/web');
  assert.equal(s.store.headRevision(), head + 1);
  assert.equal(text(s, 'rules/browser/neo/00-x.md'), null);
  assert.ok(text(s, 'rules/web/neo/00-x.md'));
  assert.ok(text(s, 'rules/web/neo/deep/00-y.md'));
  const sum = summary(s);
  assert.deepEqual(sum.requires['skills/s'], ['rules/web/neo', 'rules/web/neo/deep']);
  assert.deepEqual(sum.requires['rules/web/neo'], ['rules/web/neo/deep']);
});

test('하위 스택 이름 바꾸기는 마지막 조각만 바꾸고 부모는 그대로다', async t => {
  const { s, cookie } = await tree(t);
  const page = (await getAs(s, cookie, '/settings/stack/browser/neo')).text;
  assert.ok(page.includes('name="name" value="neo"'), page);
  assert.ok(page.includes('guideline source'));
  const r = await post(s, cookie, '/settings/stack/browser/neo', { action: 'rename', name: 'neo2' });
  assert.equal(r.headers.location, '/settings/stack/browser/neo2');
  assert.ok(text(s, 'rules/browser/neo2/deep/00-y.md'));
  assert.deepEqual(summary(s).requires['skills/s'], ['rules/browser/neo2', 'rules/browser/neo2/deep']);
  assert.equal((await post(s, cookie, '/settings/stack/browser/neo2', { action: 'rename', name: 'x/y' })).status, 400);
});

test('하위 스택이 있으면 이름 바꾸기·삭제 확인 문구에 개수가 있고, 지우면 자손도 지운다', async t => {
  const { s, cookie } = await tree(t);
  const page = (await getAs(s, cookie, '/settings/stack/browser')).text;
  assert.equal(page.split('하위 스택 2개 포함').length - 1, 2, page);
  const leaf = (await getAs(s, cookie, '/settings/stack/browser/neo/deep')).text;
  assert.ok(!leaf.includes('개 포함'));
  const r = await post(s, cookie, '/settings/stack/browser/neo', { action: 'delete' });
  assert.equal(r.headers.location, '/s/browser');
  assert.equal(text(s, 'rules/browser/neo/deep/00-y.md'), null);
  assert.ok(text(s, 'rules/browser/00-a.md'));
  assert.equal((await post(s, cookie, '/settings/stack/browser', { action: 'delete' })).headers.location, '/');
});

test('스택 설정에서 when 을 README frontmatter 한 줄로 저장한다', async t => {
  const { s, cookie } = await tree(t);
  const page = (await getAs(s, cookie, '/settings/stack/browser/neo')).text;
  assert.ok(page.includes('name="when"'));
  assert.ok(!(await getAs(s, cookie, '/settings/skill/s')).text.includes('name="when"'));
  await post(s, cookie, '/settings/stack/browser/neo', { action: 'meta', when: 'neo 로 웹을\r\n다룰 때: 항상' });
  assert.equal(summary(s).stacks.find(x => x.name === 'browser/neo').when, 'neo 로 웹을 다룰 때: 항상');
  assert.ok((await getAs(s, cookie, '/settings/stack/browser/neo')).text.includes('value="neo 로 웹을 다룰 때: 항상"'));
  await post(s, cookie, '/settings/stack/browser/neo', { action: 'meta', when: '' });
  assert.equal(summary(s).stacks.find(x => x.name === 'browser/neo').when, null);
});

test('도메인 하위 스택의 설정은 마지막 조각에서 도구·도메인을 가른다', async t => {
  const { s, cookie } = await tree(t);
  const page = (await getAs(s, cookie, '/settings/stack/tools/deploy__gitlab.example.com')).text;
  assert.ok(page.includes('name="name" value="deploy"'), page);
  assert.ok(page.includes('name="domain" value="gitlab.example.com"'));
  const r = await post(s, cookie, '/settings/stack/tools/deploy__gitlab.example.com', { action: 'rename', name: 'ship', domain: 'gitlab.example.com' });
  assert.equal(r.headers.location, '/settings/stack/tools/ship__gitlab.example.com');
});
