import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDocsRepo, write, ALWAYS, reference } from './helpers.js';
import { stacks, stackFiles, stackTiers, stackOverrides, skills, subagents, mcpServers, ignored, warnings, stackSetup, elementCategories, fileCategories } from '../src/catalog.js';

test('stacks 는 지침 파일이 있는 스택만 정렬해 돌려주고 뼈대 스택은 뺀다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(stacks(root), ['base', 'demo']);
});

test('stackFiles 는 한 스택의 NN-<주제>.md 만 정렬해 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/README.md', '설명\n');
  assert.deepEqual(stackFiles('base', root), ['rules/base/00-alpha.md', 'rules/base/01-beta.md']);
  assert.deepEqual(stackFiles('demo', root), ['rules/demo/00-rules.md']);
});

test('skills 는 SKILL.md 가 있는 디렉터리만 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'skills/no-skill/README.md', '없음\n');
  assert.deepEqual(skills(root), ['demo-skill']);
});

test('rules·skills 디렉터리가 없어도 빈 목록을 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(`${root}/rules`, { recursive: true });
  fs.rmSync(`${root}/skills`, { recursive: true });
  assert.deepEqual(stacks(root), []);
  assert.deepEqual(skills(root), []);
});

test('ignored 는 이름 규칙에 안 맞는 지침 파일과 SKILL.md 가 없는 스킬 디렉터리를 모은다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/README.md', '설명\n');
  write(root, 'rules/base/not-a-rule.md', '규칙 아님\n');
  write(root, 'rules/demo/README.md', '설명\n');
  write(root, 'rules/demo/오타.md', '규칙 아님\n');
  write(root, 'skills/no-skill/README.md', '없음\n');
  assert.deepEqual(ignored(root), [
    { path: 'rules/base/not-a-rule.md', reason: '이름이 NN-<주제>.md 가 아님' },
    { path: 'rules/demo/오타.md', reason: '이름이 NN-<주제>.md 가 아님' },
    { path: 'skills/no-skill/', reason: 'SKILL.md 없음' },
  ]);
});

test('ignored 는 뼈대 스택의 README.md 를 무시 대상으로 치지 않는다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(ignored(root), []);
});

const AGENT = (name, description = '맡길 때') => `---\nname: ${name}\ndescription: ${description}\ntools: [Read]\n---\n\n본문\n`;

test('subagents 는 조건을 만족하는 agents/*.md 만 정렬해 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'agents/reviewer.md', AGENT('reviewer'));
  write(root, 'agents/builder.md', AGENT('builder'));
  write(root, 'agents/README.md', '설명\n');
  write(root, 'agents/.gitkeep', '');
  write(root, 'agents/.DS_Store', '');
  assert.deepEqual(subagents(root), ['builder', 'reviewer']);
  assert.deepEqual(ignored(root), []);
});

test('ignored 는 서브에이전트가 못 되는 항목을 이유와 함께 모은다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'agents/no-fm.md', '# 제목\n');
  write(root, 'agents/Wrong.md', AGENT('wrong'));
  write(root, 'agents/no-desc.md', '---\nname: no-desc\n---\n');
  write(root, 'agents/nested/inner.md', AGENT('inner'));
  write(root, 'agents/codex.toml', 'name = "codex"\n');
  assert.deepEqual(subagents(root), []);
  assert.deepEqual(ignored(root), [
    { path: 'agents/Wrong.md', reason: 'name 이 파일 이름과 다름' },
    { path: 'agents/codex.toml', reason: '.md 가 아님' },
    { path: 'agents/nested/', reason: '하위 디렉터리는 읽지 않음' },
    { path: 'agents/no-desc.md', reason: 'description 없음' },
    { path: 'agents/no-fm.md', reason: 'frontmatter 없음' },
  ]);
});

test('mcpServers 는 읽히는 서버를 이름순으로, 참조하는 환경 변수와 함께 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/gitlab/server.json', JSON.stringify({
    type: 'http', url: 'https://gitlab.example.com/mcp', headers: { Authorization: 'Bearer ${GITLAB_TOKEN}' },
  }));
  write(root, 'mcp/gitlab/README.md', '설명\n');
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }));
  write(root, 'mcp/.gitkeep', '');
  write(root, 'mcp/README.md', '설명\n');
  assert.deepEqual(mcpServers(root), [
    { name: 'context7', envVars: [] },
    { name: 'gitlab', envVars: ['GITLAB_TOKEN'] },
  ]);
  assert.deepEqual(ignored(root), []);
  assert.deepEqual(warnings(root), []);
});

test('ignored 는 MCP 가 못 되는 항목을 이유와 함께 모은다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/jira/README.md', '설명\n');
  write(root, 'mcp/broken/server.json', '{');
  write(root, 'mcp/notype/server.json', JSON.stringify({ command: 'npx' }));
  write(root, 'mcp/context7.json', '{}');
  assert.deepEqual(mcpServers(root), []);
  assert.deepEqual(ignored(root), [
    { path: 'mcp/broken/', reason: 'server.json 을 읽을 수 없음' },
    { path: 'mcp/context7.json', reason: '디렉터리가 아님' },
    { path: 'mcp/jira/', reason: 'server.json 없음' },
    { path: 'mcp/notype/', reason: 'type 이 stdio·http 가 아니거나 command·url 없음' },
  ]);
});

test('warnings 는 목록에 넣은 MCP 서버의 경고를 서버 이름순으로 모은다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/db/server.json', JSON.stringify({
    type: 'stdio', command: 'npx', env: { DB_PASSWORD: 'hunter2', LOG_LEVEL: 'info' },
  }));
  write(root, 'mcp/api/server.json', JSON.stringify({ type: 'http', url: 'https://x/mcp?key=${K}' }));
  write(root, 'mcp/broken/server.json', JSON.stringify({ env: { A: 'plain' } }));
  assert.deepEqual(warnings(root), [
    { path: 'mcp/api/server.json', message: 'url 에는 변수 참조를 쓸 수 없음' },
    { path: 'mcp/db/server.json', message: 'env.DB_PASSWORD 가 변수 참조가 아님' },
    { path: 'mcp/db/server.json', message: 'env.LOG_LEVEL 가 변수 참조가 아님' },
  ]);
});

test('agents·mcp 디렉터리가 없어도 빈 목록을 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(subagents(root), []);
  assert.deepEqual(mcpServers(root), []);
  assert.deepEqual(warnings(root), []);
});

test('ignored 는 YAML 로 읽히지 않을 name·description 과 BOM 을 이유와 함께 모은다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'agents/colon.md', '---\nname: colon\ndescription: 검토: diff 를 본다\n---\n');
  write(root, 'agents/quoted.md', '---\nname: "quoted"\ndescription: "검토: diff 를 본다"\n---\n');
  write(root, 'agents/bom.md', `${String.fromCharCode(0xfeff)}---\nname: bom\ndescription: d\n---\n`);
  assert.deepEqual(subagents(root), ['quoted']);
  assert.deepEqual(ignored(root), [
    { path: 'agents/bom.md', reason: 'frontmatter 없음' },
    { path: 'agents/colon.md', reason: 'YAML 로 읽히지 않음 — 값을 따옴표로 감싼다' },
  ]);
});

const BUILD_README = '# gitlab\n\n## 반영할 때 항목 만들기\n\n`git remote get-url origin` 에서 호스트를 뽑아 `{ "type": "http", "url": "https://<호스트>/api/v4/mcp" }` 를 만든다.\n';

test('mcpServers 는 README.md 로 만드는 서버를 build 로 함께 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/gitlab/README.md', BUILD_README);
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }));
  assert.deepEqual(mcpServers(root), [
    { name: 'context7', envVars: [] },
    { name: 'gitlab', envVars: [], build: true },
  ]);
  assert.deepEqual(ignored(root), []);
  assert.deepEqual(warnings(root), []);
});

test('ignored 는 README.md 에 반영할 때 항목 만들기 절이 없거나 비면 무시한다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/jira/README.md', '# jira\n\n호스트는 프로젝트마다 다르다.\n');
  write(root, 'mcp/wiki/README.md', '# wiki\n\n## 반영할 때 항목 만들기\n\n## 환경 변수\n');
  assert.deepEqual(mcpServers(root), []);
  assert.deepEqual(ignored(root), [
    { path: 'mcp/jira/', reason: 'server.json 없음' },
    { path: 'mcp/wiki/', reason: 'README.md 의 「반영할 때 항목 만들기」 절이 비어 있음' },
  ]);
});

test('warnings 는 server.json 과 반영할 때 항목 만들기 절이 함께 있으면 경고한다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/gitlab/server.json', JSON.stringify({ type: 'http', url: 'https://gitlab.example.com/api/v4/mcp' }));
  write(root, 'mcp/gitlab/README.md', BUILD_README);
  write(root, 'mcp/broken/server.json', '{');
  write(root, 'mcp/broken/README.md', BUILD_README);
  assert.deepEqual(mcpServers(root), [{ name: 'gitlab', envVars: [] }]);
  assert.deepEqual(ignored(root), [{ path: 'mcp/broken/', reason: 'server.json 을 읽을 수 없음' }]);
  const both = 'server.json 과 README.md 의 「반영할 때 항목 만들기」 절이 함께 있음 — 하나만 남긴다';
  assert.deepEqual(warnings(root), [
    { path: 'mcp/broken/', message: both },
    { path: 'mcp/gitlab/', message: both },
  ]);
});

test('stackTiers 는 한 스택의 지침 파일마다 칸을 돌려주고 경고 대상은 load·when 을 null 로 둔다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/02-gamma.md', '# gamma\n');
  assert.deepEqual(stackTiers('base', root), [
    { path: 'rules/base/00-alpha.md', load: 'always', when: null },
    { path: 'rules/base/01-beta.md', load: 'reference', when: '베타 작업을 할 때' },
    { path: 'rules/base/02-gamma.md', load: null, when: null, warning: 'frontmatter 에 load 없음' },
  ]);
});

test('warnings 는 칸 경고 다섯 종류를 지침 파일 경로로 모으고 MCP 경고와 경로순으로 섞는다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/web/00-none.md', '# 없음\n');
  write(root, 'rules/web/01-value.md', '---\nload: sometimes\n---\n');
  write(root, 'rules/web/02-no-when.md', '---\nload: reference\n---\n');
  write(root, 'rules/web/03-when.md', `${ALWAYS.replace('always', 'always\nwhen: 늘')}`);
  write(root, 'rules/web/04-yaml.md', '---\nload: reference\nwhen: 검토: diff 를 볼 때\n---\n');
  write(root, 'rules/web/05-ok.md', `${reference('검토: diff 를 볼 때')}# ok\n`);
  write(root, 'rules/web/06-ok.md', `${ALWAYS}# ok\n`);
  write(root, 'rules/skeleton/README.md', '뼈대\n');
  write(root, 'mcp/db/server.json', JSON.stringify({ type: 'stdio', command: 'npx', env: { PW: 'x' } }));
  assert.deepEqual(warnings(root), [
    { path: 'mcp/db/server.json', message: 'env.PW 가 변수 참조가 아님' },
    { path: 'rules/web/00-none.md', message: 'frontmatter 에 load 없음' },
    { path: 'rules/web/01-value.md', message: 'load 가 always·reference 가 아님' },
    { path: 'rules/web/02-no-when.md', message: 'load 가 reference 인데 when 없음' },
    { path: 'rules/web/03-when.md', message: 'load 가 always 인데 when 이 있음' },
    { path: 'rules/web/04-yaml.md', message: 'load·when 이 YAML 문자열로 읽히지 않음 — 값을 따옴표로 감싼다' },
  ]);
});

test('warnings 는 always 파일이 없는 스택에 경고하지 않는다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/ref-only/00-a.md', `${reference('A 할 때')}# a\n`);
  write(root, 'rules/ref-only/01-b.md', `${reference('B 할 때')}# b\n`);
  assert.deepEqual(warnings(root), []);
});

/** base/00-alpha.md 에 「기본 절」, orca 스택에 always 05-switch.md(「바꾸는 절」)와 reference 00-ref.md 를 둔다. */
function withOrca(root, rows) {
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 기본 절\n\nA1\n`);
  write(root, 'rules/orca/00-ref.md', `${reference('orca 로 할 때')}# ref\n\n## 참조 절\n`);
  write(root, 'rules/orca/05-switch.md', `${ALWAYS}# switch\n\n## 바꾸는 절\n\n본문\n`);
  const table = rows.length ? `## 다른 스택을 바꾸는 것\n\n| 이 스택의 절 | 바꾸는 절 |\n| --- | --- |\n${rows.join('\n')}\n` : '';
  write(root, 'rules/orca/README.md', `# orca 스택\n\n${table}`);
}

test('stackOverrides 는 README 표의 행을 from·to 경로와 절 제목으로 돌려주고 경고가 없다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  withOrca(root, ['| `05-switch.md` 「바꾸는 절」 | `base/00-alpha.md` 「기본 절」 |']);
  assert.deepEqual(stackOverrides('orca', root), {
    overrides: [{ from: { path: 'rules/orca/05-switch.md', title: '바꾸는 절' }, to: { path: 'rules/base/00-alpha.md', title: '기본 절' } }],
    warnings: [],
  });
  assert.deepEqual(warnings(root), []);
});

test('stackOverrides 는 표나 README 가 없는 스택에 빈 배열을 돌려준다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  withOrca(root, []);
  assert.deepEqual(stackOverrides('orca', root), { overrides: [], warnings: [] });
  assert.deepEqual(stackOverrides('base', root), { overrides: [], warnings: [] });
});

test('warnings 는 바꿈 표의 틀린 행 다섯 종류를 README 경로로 내고 그 행은 overrides 에서 뺀다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  withOrca(root, [
    '| `09-none.md` 「바꾸는 절」 | `base/00-alpha.md` 「기본 절」 |',
    '| `05-switch.md` 「바꾸는 절」 | `base/09-none.md` 「기본 절」 |',
    '| `05-switch.md` 「없는 절」 | `base/00-alpha.md` 「기본 절」 |',
    '| `05-switch.md` 「바꾸는 절」 | `base/00-alpha.md` 「없는 절」 |',
    '| `00-ref.md` 「참조 절」 | `base/00-alpha.md` 「기본 절」 |',
    '| `05-switch.md` 「바꾸는 절」 | `orca/00-ref.md` 「참조 절」 |',
    '| 05-switch.md 「바꾸는 절」 | `base/00-alpha.md` 「기본 절」 |',
    '| `05-switch.md` 「바꾸는 절」 | `base/00-alpha.md` 「기본 절」 |',
  ]);
  const path = 'rules/orca/README.md';
  assert.deepEqual(warnings(root), [
    { path, message: '`09-none.md` — 파일이 없음' },
    { path, message: '`base/09-none.md` — 파일이 없음' },
    { path, message: '`05-switch.md` 「없는 절」 — 그 파일에 이 ## 절 제목이 없음' },
    { path, message: '`base/00-alpha.md` 「없는 절」 — 그 파일에 이 ## 절 제목이 없음' },
    { path, message: '`00-ref.md` — 바꾸는 절의 파일이 load: always 가 아님' },
    { path, message: '`orca/00-ref.md` 「참조 절」 — 바뀌는 절이 같은 스택에 있음' },
    { path, message: '| 05-switch.md 「바꾸는 절」 | `base/00-alpha.md` 「기본 절」 | — 셀 형식을 읽을 수 없음. `<파일>` 「<## 절 제목>」 으로 쓴다' },
  ]);
  assert.equal(stackOverrides('orca', root).overrides.length, 1);
});

test('stackSetup 은 rules/<스택>/SETUP.md 가 있는지 본다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/SETUP.md', '# base 세팅\n');
  assert.equal(stackSetup('base', root), true);
  assert.equal(stackSetup('demo', root), false);
});

test('elementCategories 는 요소마다 자기 분류를 모으고 형식이 틀리면 경고를 낸다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/README.md', '---\ncategories: [공통]\n---\n\n# base\n');
  write(root, 'rules/demo/00-rules.md', '---\nload: always\ncategories: 데모\n---\n\n# demo\n');
  write(root, 'agents/reviewer.md', '---\nname: reviewer\ndescription: 검토\ncategories: [리뷰]\n---\n');
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx' }));
  const r = elementCategories(root);
  assert.deepEqual(r.categories, { 'rules/base': ['공통'], 'agents/reviewer.md': ['리뷰'] });
  assert.deepEqual(r.warnings, [{ path: 'rules/demo/00-rules.md', message: 'categories 가 [a, b] 꼴이 아님' }]);
  assert.ok(warnings(root).some(w => w.path === 'rules/demo/00-rules.md' && w.message === 'categories 가 [a, b] 꼴이 아님'));
});

test('fileCategories 는 스택 분류와 파일 분류를 합친다', () => {
  assert.deepEqual(fileCategories({ 'rules/base': ['a', 'b'], 'rules/base/00-x.md': ['b', 'c'] }, 'rules/base/00-x.md'), ['a', 'b', 'c']);
  assert.deepEqual(fileCategories({}, 'rules/base/00-x.md'), []);
});
