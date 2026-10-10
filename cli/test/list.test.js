import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDocsRepo, write, tmpDir, collect, ALWAYS } from './helpers.js';
import { list } from '../src/commands/list.js';

test('list 는 스택·스킬을 보여 주고 뼈대 스택은 뺀다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = collect();
  const code = await list({ root, out: c.out });
  assert.equal(code, 0);
  const text = c.text();
  assert.match(
    text,
    /스택\n {2}base\n {4}rules\/base\/00-alpha\.md {2}always\n {4}rules\/base\/01-beta\.md {3}reference {2}베타 작업을 할 때\n {2}demo\n {4}rules\/demo\/00-rules\.md {2}always\n/,
  );
  assert.match(text, /스킬\n {2}demo-skill/);
  assert.equal(text.includes('empty'), false);
  assert.match(text, /스킬\n {2}demo-skill\n서브에이전트\nMCP$/);
});

test('list 는 이름 규칙에 안 맞아 빠진 항목을 무시됨 절로 보여 준다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/오타.md', '규칙 아님\n');
  write(root, 'skills/no-skill/README.md', '없음\n');
  const c = collect();
  const code = await list({ root, out: c.out });
  assert.equal(code, 0);
  const text = c.text();
  assert.match(text, /무시됨\n {2}rules\/base\/오타\.md {2}이름이 NN-<주제>\.md 가 아님\n {2}skills\/no-skill\/ {4}SKILL\.md 없음/);
  assert.doesNotMatch(text, /배포되지 않습니다/);
});

test('list 는 무시된 것이 없으면 무시됨 절을 내지 않는다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = collect();
  await list({ root, out: c.out });
  assert.equal(c.text().includes('무시됨'), false);
});

test('rules/ 가 없는 폴더면 종료 코드 2 와 안내를 낸다', async t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const c = collect();
  const code = await list({ root: dir, out: c.out });
  assert.equal(code, 2);
  assert.match(c.text(), /rules\/ 가 없다/);
});

test('list 는 서브에이전트·MCP 절을 보여 주고 MCP 에 환경 변수를 붙인다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'agents/code-reviewer.md', '---\nname: code-reviewer\ndescription: 검토\n---\n');
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }));
  write(root, 'mcp/gitlab/server.json', JSON.stringify({
    type: 'http', url: 'https://gitlab.example.com/mcp', headers: { Authorization: 'Bearer ${GITLAB_TOKEN}' },
  }));
  const c = collect();
  const code = await list({ root, out: c.out });
  assert.equal(code, 0);
  const text = c.text();
  assert.match(text, /서브에이전트\n {2}code-reviewer\nMCP\n {2}context7\n {2}gitlab {4}환경 변수 GITLAB_TOKEN$/);
  assert.equal(text.includes('무시됨'), false);
  assert.equal(text.includes('경고'), false);
});

test('list 는 경고 절을 내도 종료 코드 0 이다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/db/server.json', JSON.stringify({ type: 'stdio', command: 'npx', env: { DB_PASSWORD: 'hunter2' } }));
  const c = collect();
  const code = await list({ root, out: c.out });
  assert.equal(code, 0);
  assert.match(c.text(), /MCP\n {2}db\n경고\n {2}mcp\/db\/server\.json {2}env\.DB_PASSWORD 가 변수 참조가 아님$/);
});

test('list 는 서브에이전트·MCP 의 무시됨도 이유와 함께 보여 준다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'agents/Reviewer.md', '---\nname: reviewer\ndescription: 검토\n---\n');
  write(root, 'mcp/jira/README.md', '설명\n');
  const c = collect();
  await list({ root, out: c.out });
  assert.match(c.text(), /무시됨\n {2}agents\/Reviewer\.md {2}name 이 파일 이름과 다름\n {2}mcp\/jira\/ {11}server\.json 없음/);
});

test('list 는 README.md 로 만드는 MCP 서버를 MCP 절에 표시와 함께 보여 준다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }));
  write(root, 'mcp/gitlab/README.md', '# gitlab\n\n## 반영할 때 항목 만들기\n\n호스트를 git remote 에서 뽑는다.\n');
  write(root, 'mcp/jira/README.md', '설명\n');
  const c = collect();
  await list({ root, out: c.out });
  const text = c.text();
  assert.match(text, /MCP\n {2}context7\n {2}gitlab {4}반영할 때 README 로 만든다\n무시됨\n {2}mcp\/jira\/ {2}server\.json 없음$/);
});

test('list 는 server.json 과 반영할 때 항목 만들기 절이 함께 있으면 경고 절에 낸다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'mcp/gitlab/server.json', JSON.stringify({ type: 'http', url: 'https://gitlab.example.com/api/v4/mcp' }));
  write(root, 'mcp/gitlab/README.md', '## 반영할 때 항목 만들기\n\n호스트를 git remote 에서 뽑는다.\n');
  const c = collect();
  await list({ root, out: c.out });
  assert.match(c.text(), /MCP\n {2}gitlab\n경고\n {2}mcp\/gitlab\/ {2}server\.json 과 README\.md 의 「반영할 때 항목 만들기」 절이 함께 있음 — 하나만 남긴다$/);
});

test('list 는 칸이 경고 대상인 지침 파일에 경고라고 표시하고 경고 절에 이유를 낸다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/02-gamma.md', '# gamma\n');
  const c = collect();
  const code = await list({ root, out: c.out });
  assert.equal(code, 0);
  const text = c.text();
  assert.match(text, /\n {4}rules\/base\/02-gamma\.md {2}경고\n/);
  assert.match(text, /경고\n {2}rules\/base\/02-gamma\.md {2}frontmatter 에 load 없음$/);
});

test('list --json 은 스택 파일의 칸과 스킬·서브에이전트·MCP·무시됨·경고를 한 객체로 낸다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/demo/01-bad.md', `${ALWAYS.replace('always', 'always\nwhen: 늘')}# bad\n`);
  write(root, 'skills/no-skill/README.md', '없음\n');
  write(root, 'agents/reviewer.md', '---\nname: reviewer\ndescription: 검토\n---\n');
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx', env: { K: '${K}' } }));
  write(root, 'mcp/gitlab/README.md', '## 반영할 때 항목 만들기\n\ngit remote 에서 뽑는다.\n');
  const c = collect();
  const code = await list({ root, json: true, out: c.out });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(c.text()), {
    stacks: [
      {
        name: 'base',
        files: [
          { path: 'rules/base/00-alpha.md', load: 'always', when: null },
          { path: 'rules/base/01-beta.md', load: 'reference', when: '베타 작업을 할 때' },
        ],
        overrides: [],
        setup: false,
      },
      {
        name: 'demo',
        files: [
          { path: 'rules/demo/00-rules.md', load: 'always', when: null },
          { path: 'rules/demo/01-bad.md', load: null, when: null },
        ],
        overrides: [],
        setup: false,
      },
    ],
    skills: ['demo-skill'],
    subagents: ['reviewer'],
    mcp: [
      { name: 'context7', envVars: ['K'], build: false },
      { name: 'gitlab', envVars: [], build: true },
    ],
    ignored: [{ path: 'skills/no-skill/', reason: 'SKILL.md 없음' }],
    warnings: [{ path: 'rules/demo/01-bad.md', message: 'load 가 always 인데 when 이 있음' }],
    categories: {},
  });
});

test('list 는 스택 파일 아래에 바꿈을 보여 주고 --json 의 스택마다 overrides 를 둔다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 기본 절\n`);
  write(root, 'rules/orca/05-switch.md', `${ALWAYS}# switch\n\n## 바꾸는 절\n`);
  write(root, 'rules/orca/README.md', '## 다른 스택을 바꾸는 것\n\n| 이 스택의 절 | 바꾸는 절 |\n| --- | --- |\n| `05-switch.md` 「바꾸는 절」 | `base/00-alpha.md` 「기본 절」 |\n');
  const c = collect();
  await list({ root, out: c.out });
  assert.match(c.text(), /\n {2}orca\n {4}rules\/orca\/05-switch\.md +always\n {4}바꾼다 {2}base\/00-alpha\.md 「기본 절」 {2}← {2}05-switch\.md 「바꾸는 절」\n스킬/);
  const j = collect();
  await list({ root, json: true, out: j.out });
  const data = JSON.parse(j.text());
  assert.deepEqual(data.stacks.map(s => [s.name, s.overrides]), [
    ['base', []],
    ['demo', []],
    ['orca', [{ from: { path: 'rules/orca/05-switch.md', title: '바꾸는 절' }, to: { path: 'rules/base/00-alpha.md', title: '기본 절' } }]],
  ]);
});

test('list 는 분류와 세팅 문서를 보여 주고 --json 에 categories·setup 을 낸다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/README.md', '---\ncategories: [공통]\n---\n\n# base\n');
  write(root, 'rules/base/SETUP.md', '# base 세팅\n\n## 확인\n\n## 세팅\n');
  write(root, 'rules/base/01-beta.md', '---\nload: reference\nwhen: "베타 작업을 할 때"\ncategories: [베타]\n---\n\n# beta\n');
  write(root, 'rules/empty/SETUP.md', '# 뼈대 세팅\n');
  write(root, 'skills/demo-skill/SKILL.md', '---\nname: demo-skill\ndescription: 데모\ncategories: [도구]\n---\n\n본문\n');
  write(root, 'agents/reviewer.md', '---\nname: reviewer\ndescription: 검토\ncategories: [리뷰]\n---\n');
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx' }));
  write(root, 'mcp/context7/README.md', '---\ncategories: [문서]\n---\n\n# context7\n');
  const c = collect();
  await list({ root, out: c.out });
  const text = c.text();
  assert.match(text, /\n {2}base {2}\[공통\] {2}세팅 문서\n/);
  assert.match(text, /rules\/base\/01-beta\.md +\[베타\] {2}reference {2}베타 작업을 할 때\n/);
  assert.match(text, /스킬\n {2}demo-skill {2}\[도구\]\n서브에이전트\n {2}reviewer {2}\[리뷰\]\nMCP\n {2}context7 {2}\[문서\]$/);
  assert.equal(text.includes('empty'), false);
  const j = collect();
  await list({ root, json: true, out: j.out });
  const data = JSON.parse(j.text());
  assert.deepEqual(data.categories, {
    'rules/base': ['공통'],
    'rules/base/01-beta.md': ['베타'],
    'skills/demo-skill': ['도구'],
    'agents/reviewer.md': ['리뷰'],
    'mcp/context7': ['문서'],
  });
  assert.deepEqual(data.stacks.map(s => [s.name, s.setup]), [['base', true], ['demo', false]]);
});

test('list 는 분류 형식이 틀리면 분류를 붙이지 않고 경고 절에 그 파일을 낸다', async t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'skills/demo-skill/SKILL.md', '---\nname: demo-skill\ndescription: 데모\ncategories: 도구\n---\n');
  const c = collect();
  await list({ root, out: c.out });
  const text = c.text();
  assert.match(text, /스킬\n {2}demo-skill\n/);
  assert.match(text, /경고\n {2}skills\/demo-skill\/SKILL\.md {2}categories 가 \[a, b\] 꼴이 아님$/);
});
