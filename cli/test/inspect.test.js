import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDocsRepo, tmpDir, write, ALWAYS, reference } from './helpers.js';
import { inspect, detectForm, stripFrontmatter, itemDiff } from '../src/inspect.js';

function setup(t) {
  const root = makeDocsRepo();
  const project = tmpDir('guideline-proj-');
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });
  return { root, project };
}

/** kind 의 항목을 { id: state } 로. */
const states = (r, kind = 'rule') => Object.fromEntries(r.items.filter(i => i.kind === kind).map(i => [i.id, i.state]));
const item = (r, id) => r.items.find(i => i.id === id);

test('stripFrontmatter 는 frontmatter 와 그 뒤 빈 줄을 떼고 줄바꿈을 \\n 으로 맞춘다', () => {
  assert.equal(stripFrontmatter('---\nload: always\n---\n\n# a\n'), '# a\n');
  assert.equal(stripFrontmatter('# a\n'), '# a\n');
  assert.equal(stripFrontmatter('---\r\nload: always\r\n---\r\n\r\n# a\r\n'), '# a\n');
});

test('detectForm 은 .ruler 가 있으면 ruler, 지침 파일이 있으면 instructions, 없으면 none', t => {
  const { project } = setup(t);
  assert.deepEqual(detectForm(project), { form: 'none', instructionFiles: [] });
  write(project, 'AGENTS.md', '# a\n');
  write(project, 'CLAUDE.md', '@AGENTS.md\n');
  assert.deepEqual(detectForm(project), { form: 'instructions', instructionFiles: ['CLAUDE.md', 'AGENTS.md'] });
  write(project, '.ruler/ruler.toml', '');
  assert.deepEqual(detectForm(project), { form: 'ruler', instructionFiles: [] });
  assert.deepEqual(detectForm(null), { form: 'none', instructionFiles: [] });
});

test('새 프로젝트(null)는 모든 지침이 missing 이고 바꿈이 없다', t => {
  const { root } = setup(t);
  const r = inspect(root, null);
  assert.equal(r.form, 'none');
  assert.deepEqual(states(r), { 'rules/base/00-alpha.md': 'missing', 'rules/base/01-beta.md': 'missing', 'rules/demo/00-rules.md': 'missing' });
  assert.deepEqual(r.overrides, []);
});

test('ruler 형태는 칸마다 기대 자리의 사본을 frontmatter 를 뗀 원본과 비교하고, CRLF 사본도 같다고 본다', t => {
  const { root, project } = setup(t);
  write(project, '.ruler/ruler.toml', '');
  write(project, '.ruler/base/00-alpha.md', '# alpha\r\n\r\nA1\r\n');
  write(project, 'docs/guideline/base/01-beta.md', '# beta\n\nB2\n');
  const r = inspect(root, project);
  assert.deepEqual(states(r), { 'rules/base/00-alpha.md': 'same', 'rules/base/01-beta.md': 'different', 'rules/demo/00-rules.md': 'missing' });
  assert.deepEqual(item(r, 'rules/base/01-beta.md').where, ['docs/guideline/base/01-beta.md']);
  assert.equal(item(r, 'rules/base/00-alpha.md').load, 'always');
  assert.equal(item(r, 'rules/base/00-alpha.md').stack, 'base');
});

test('ruler 형태에서 반대 칸의 자리에 있으면 moved 다', t => {
  const { root, project } = setup(t);
  write(project, '.ruler/ruler.toml', '');
  write(project, '.ruler/base/01-beta.md', '# beta\n\nB1\n');
  write(project, 'docs/guideline/demo/00-rules.md', '# demo rules\n\nD1\n');
  const r = inspect(root, project);
  assert.equal(states(r)['rules/base/01-beta.md'], 'moved');
  assert.equal(states(r)['rules/demo/00-rules.md'], 'moved');
  assert.deepEqual(item(r, 'rules/base/01-beta.md').where, ['.ruler/base/01-beta.md']);
});

test('instructions 형태의 always 는 ## 제목을 수준과 관계없이 찾아 본문을 비교한다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 첫 절\n\n본문 1\n\n## 둘째 절\n\n본문 2\n`);
  write(project, 'CLAUDE.md', '# 프로젝트\n\n### 첫 절\n\n본문 1\n\n### 둘째 절\n\n본문 2\n\n## 프로젝트 절\n\n고유\n');
  let r = inspect(root, project);
  assert.equal(states(r)['rules/base/00-alpha.md'], 'same');
  assert.deepEqual(item(r, 'rules/base/00-alpha.md').where, ['CLAUDE.md']);

  write(project, 'CLAUDE.md', '# 프로젝트\n\n## 첫 절\n\n본문 1 고침\n\n## 둘째 절\n\n본문 2\n');
  assert.equal(states(inspect(root, project))['rules/base/00-alpha.md'], 'different');

  write(project, 'CLAUDE.md', '# 프로젝트\n\n## 첫 절\n\n본문 1\n');
  r = inspect(root, project);
  assert.deepEqual([item(r, 'rules/base/00-alpha.md').state, item(r, 'rules/base/00-alpha.md').reason], ['different', '일부 절만 있음']);

  write(project, 'CLAUDE.md', '# 프로젝트\n');
  assert.equal(states(inspect(root, project))['rules/base/00-alpha.md'], 'missing');
});

test('instructions 형태에서 원본에 ## 절이 없으면 unknown, 참조 지침은 docs/guideline 사본으로 본다', t => {
  const { root, project } = setup(t);
  write(project, 'CLAUDE.md', '# 프로젝트\n');
  write(project, 'docs/guideline/base/01-beta.md', '# beta\n\nB1\n');
  const r = inspect(root, project);
  assert.equal(r.form, 'instructions');
  assert.deepEqual(states(r), { 'rules/base/00-alpha.md': 'unknown', 'rules/base/01-beta.md': 'same', 'rules/demo/00-rules.md': 'unknown' });
  assert.match(item(r, 'rules/base/00-alpha.md').reason, /## 절이 없어/);
});

test('instructions 형태에서 always 사본이 docs/guideline 에 있거나, reference 의 절이 지침 파일에 있으면 moved', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 알파 절\n\nA\n`);
  write(root, 'rules/base/01-beta.md', `${reference('베타 작업을 할 때')}# beta\n\n## 베타 절\n\nB\n`);
  write(project, 'CLAUDE.md', '# 프로젝트\n\n## 베타 절\n\nB\n');
  write(project, 'docs/guideline/base/00-alpha.md', '# alpha\n\n## 알파 절\n\nA\n');
  const r = inspect(root, project);
  assert.equal(states(r)['rules/base/00-alpha.md'], 'moved');
  assert.deepEqual(item(r, 'rules/base/00-alpha.md').where, ['docs/guideline/base/00-alpha.md']);
  assert.equal(states(r)['rules/base/01-beta.md'], 'moved');
  assert.deepEqual(item(r, 'rules/base/01-beta.md').where, ['CLAUDE.md']);
});

test('칸 경고가 있는 파일과 바꿈 표 경고가 있는 스택(세팅 문서 포함)은 blocked 다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/demo/01-bad.md', '# 칸 없음\n');
  write(root, 'rules/base/README.md', '## 다른 스택을 바꾸는 것\n\n| 이 스택의 절 | 바꾸는 절 |\n| --- | --- |\n| 틀린 셀 | 틀린 셀 |\n');
  write(root, 'rules/base/SETUP.md', '# 세팅\n');
  const r = inspect(root, project);
  assert.deepEqual([item(r, 'rules/demo/01-bad.md').state, item(r, 'rules/demo/01-bad.md').reason], ['blocked', 'frontmatter 에 load 없음']);
  for (const id of ['rules/base/00-alpha.md', 'rules/base/01-beta.md', 'rules/base/SETUP.md']) {
    assert.deepEqual([item(r, id).state, item(r, id).reason], ['blocked', 'rules/base/README.md 의 바꿈 표에 경고가 있음'], id);
  }
});

test('세팅 문서는 원본 스택에 SETUP.md 가 있을 때만 행이 생기고 docs/guideline 사본과 비교한다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/SETUP.md', '# base 세팅\n');
  assert.deepEqual(states(inspect(root, project), 'setup'), { 'rules/base/SETUP.md': 'missing' });
  assert.deepEqual(states(inspect(root, null), 'setup'), { 'rules/base/SETUP.md': 'missing' });
  write(project, 'docs/guideline/base/SETUP.md', '# base 세팅\n');
  assert.deepEqual(states(inspect(root, project), 'setup'), { 'rules/base/SETUP.md': 'same' });
  write(project, 'docs/guideline/base/SETUP.md', '# 고침\n');
  const r = inspect(root, project);
  assert.deepEqual(states(r, 'setup'), { 'rules/base/SETUP.md': 'different' });
  assert.equal(item(r, 'rules/base/SETUP.md').stack, 'base');
});

test('inspect 는 프로젝트 바꿈을 원본과 대조해 담는다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 기본 절\n\nA\n`);
  write(project, '.ruler/ruler.toml', '');
  write(project, '.ruler/base/override.md', '## 바꿈\n\n바꾸는 절: `base/00-alpha.md` 「기본 절」\n');
  assert.deepEqual(inspect(root, project).overrides, [
    { file: '.ruler/base/override.md', stack: 'base', heading: '바꿈', target: 'rules/base/00-alpha.md', title: '기본 절', valid: true },
  ]);
});

const SKILL = '---\nname: demo-skill\ndescription: 데모\n---\n\n본문\n';

test('스킬은 형태의 스킬 자리에서 디렉터리 전체를 비교하고 점 파일은 보지 않는다', t => {
  const { root, project } = setup(t);
  write(root, 'skills/demo-skill/ref/a.md', 'A\n');
  write(project, 'CLAUDE.md', '# p\n');
  write(project, '.claude/skills/demo-skill/SKILL.md', SKILL);
  write(project, '.claude/skills/demo-skill/ref/a.md', 'A\n');
  write(project, '.claude/skills/demo-skill/.DS_Store', 'x');
  let it = inspect(root, project).items.find(i => i.kind === 'skill');
  assert.deepEqual([it.id, it.state, it.where], ['skills/demo-skill', 'same', ['.claude/skills/demo-skill']]);
  write(project, '.agents/skills/demo-skill/SKILL.md', SKILL);
  it = inspect(root, project).items.find(i => i.kind === 'skill');
  assert.deepEqual([it.state, it.where], ['different', ['.claude/skills/demo-skill', '.agents/skills/demo-skill']]);
});

test('ruler 형태의 스킬은 .ruler/skills 만 보고 생성물은 보지 않는다', t => {
  const { root, project } = setup(t);
  write(project, '.ruler/ruler.toml', '');
  write(project, '.claude/skills/demo-skill/SKILL.md', SKILL);
  assert.equal(inspect(root, project).items.find(i => i.kind === 'skill').state, 'missing');
  write(project, '.ruler/skills/demo-skill/SKILL.md', SKILL);
  assert.equal(inspect(root, project).items.find(i => i.kind === 'skill').state, 'same');
});

test('서브에이전트는 .ruler/agents 나 .claude/agents 를 비교하고 Codex 만 있으면 present', t => {
  const { root, project } = setup(t);
  const agent = '---\nname: reviewer\ndescription: 검토\n---\n\n본문\n';
  write(root, 'agents/reviewer.md', agent);
  write(root, 'agents/writer.md', '---\nname: writer\ndescription: 쓰기\n---\n');
  write(root, 'agents/tester.md', '---\nname: tester\ndescription: 시험\n---\n');
  write(project, '.claude/agents/reviewer.md', agent);
  write(project, '.codex/agents/writer.toml', 'name = "writer"\n');
  const r = inspect(root, project);
  assert.deepEqual(states(r, 'subagent'), { 'agents/reviewer.md': 'same', 'agents/tester.md': 'missing', 'agents/writer.md': 'present' });
  assert.deepEqual(item(r, 'agents/writer.md').where, ['.codex/agents/writer.toml']);
});

test('MCP 는 .mcp.json 항목과 type 을 빼고 비교하고, TOML 에만 있으면 present', t => {
  const { root, project } = setup(t);
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }));
  write(root, 'mcp/db/server.json', JSON.stringify({ type: 'stdio', command: 'npx', args: ['db'], env: { PW: '${PW}' } }));
  write(root, 'mcp/jira/server.json', JSON.stringify({ type: 'http', url: 'https://j' }));
  write(root, 'mcp/wiki/server.json', JSON.stringify({ type: 'http', url: 'https://w' }));
  write(root, 'mcp/none/server.json', JSON.stringify({ type: 'http', url: 'https://n' }));
  write(root, 'mcp/gitlab/README.md', '## 반영할 때 항목 만들기\n\ngit remote 에서 뽑는다.\n');
  write(project, '.mcp.json', JSON.stringify({ mcpServers: {
    context7: { command: 'npx', args: ['-y', 'c7'] },
    db: { type: 'stdio', command: 'npx', args: ['db'], env: { PW: 'hunter2' } },
    gitlab: { type: 'http', url: 'https://gitlab.example.com/api/v4/mcp' },
  } }));
  write(project, '.ruler/ruler.toml', '[agents.claude.mcp_servers.jira]\ntype = "http"\n');
  write(project, '.codex/config.toml', '[mcp_servers."wiki"]\nurl = "https://w"\n');
  const r = inspect(root, project);
  assert.deepEqual(states(r, 'mcp'), {
    'mcp/context7': 'same', 'mcp/db': 'different', 'mcp/gitlab': 'present', 'mcp/jira': 'present', 'mcp/none': 'missing', 'mcp/wiki': 'present',
  });
  assert.equal(item(r, 'mcp/gitlab').build, true);
  assert.equal(item(r, 'mcp/context7').build, false);
  assert.deepEqual(item(r, 'mcp/jira').where, ['.ruler/ruler.toml']);
  assert.deepEqual(item(r, 'mcp/wiki').where, ['.codex/config.toml']);
});

test('.mcp.json 이 깨져 있으면 TOML 에 있는 서버는 present, 없는 서버는 unknown 이고 이유가 붙는다', t => {
  const { root, project } = setup(t);
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx' }));
  write(root, 'mcp/jira/server.json', JSON.stringify({ type: 'http', url: 'https://j' }));
  write(project, '.mcp.json', '{ 깨짐');
  write(project, '.codex/config.toml', '[mcp_servers.jira]\n');
  const r = inspect(root, project);
  assert.deepEqual([item(r, 'mcp/context7').state, item(r, 'mcp/context7').reason], ['unknown', '.mcp.json 을 JSON 으로 읽을 수 없음']);
  assert.deepEqual([item(r, 'mcp/jira').state, item(r, 'mcp/jira').reason], ['present', '.mcp.json 을 JSON 으로 읽을 수 없음']);
});

test('원본에서 사라짐은 docs/guideline 과 표식이 있는 .ruler/<디렉터리> 에서만 찾는다', t => {
  const { root, project } = setup(t);
  write(project, '.ruler/ruler.toml', '');
  write(project, 'docs/guideline/README.md', 'x');
  write(project, 'docs/guideline/gone/05-old.md', 'x');
  write(project, 'docs/guideline/gone/SETUP.md', 'x');
  write(project, '.ruler/10-dev.md', 'x');
  write(project, '.ruler/base/00-alpha.md', '# alpha\n\nA1\n');
  write(project, '.ruler/base/09-gone.md', 'x');
  write(project, '.ruler/base/99-reference.md', 'x');
  write(project, '.ruler/base/override.md', 'x');
  write(project, '.ruler/base/override.d/01-x.md', 'x');
  write(project, '.ruler/dep__a.b/99-reference.md', 'x');
  write(project, '.ruler/dep__a.b/00-x.md', 'x');
  write(project, '.ruler/mine/01-own.md', 'x');
  const r = inspect(root, project);
  assert.deepEqual(r.items.filter(i => i.kind === 'orphan').map(i => [i.id, i.stack, i.state]), [
    ['docs/guideline/gone/05-old.md', 'gone', 'orphan'],
    ['docs/guideline/gone/SETUP.md', 'gone', 'orphan'],
    ['.ruler/base/09-gone.md', 'base', 'orphan'],
    ['.ruler/dep__a.b/00-x.md', 'dep__a.b', 'orphan'],
  ]);
  assert.deepEqual(inspect(root, null).items.filter(i => i.kind === 'orphan'), []);
});

test('itemDiff 는 사본의 줄 차이, 지침 파일 절의 차이, 값 없는 MCP 키 경로를 낸다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 알파 절\n\nA\n`);
  write(root, 'mcp/db/server.json', JSON.stringify({ type: 'stdio', command: 'npx', env: { PW: '${PW}' } }));
  write(project, 'CLAUDE.md', '# p\n\n## 알파 절\n\nA 고침\n');
  write(project, 'docs/guideline/base/01-beta.md', '# beta\n\nB2\n');
  write(project, '.mcp.json', JSON.stringify({ mcpServers: { db: { command: 'npx', env: { PW: 'hunter2' } } } }));
  const r = inspect(root, project);
  const alpha = itemDiff(root, project, item(r, 'rules/base/00-alpha.md'));
  assert.deepEqual(alpha.files.map(f => f.path), ['CLAUDE.md 「알파 절」']);
  assert.match(alpha.files[0].diff, /^-A\n\+A 고침$/m);
  assert.match(itemDiff(root, project, item(r, 'rules/base/01-beta.md')).files[0].diff, /^-B1\n\+B2$/m);
  const keys = itemDiff(root, project, item(r, 'mcp/db'));
  assert.deepEqual(keys, { keys: ['env.PW 다름'] });
  assert.doesNotMatch(JSON.stringify(keys), /hunter2/);
  assert.deepEqual(itemDiff(root, project, item(r, 'rules/demo/00-rules.md')), { files: [] });
});

test('itemDiff 는 스킬의 파일마다 차이를 낸다', t => {
  const { root, project } = setup(t);
  write(project, 'CLAUDE.md', '# p\n');
  write(project, '.claude/skills/demo-skill/SKILL.md', SKILL.replace('본문', '본문 고침'));
  write(project, '.claude/skills/demo-skill/extra.md', '추가\n');
  const r = inspect(root, project);
  const files = itemDiff(root, project, r.items.find(i => i.kind === 'skill')).files;
  assert.deepEqual(files.map(f => f.path), ['.claude/skills/demo-skill/SKILL.md', '.claude/skills/demo-skill/extra.md']);
});

test('스킬 사본이 줄바꿈 문자(CRLF)로만 다르면 same 이다', t => {
  const { root, project } = setup(t);
  write(project, 'CLAUDE.md', '# p\n');
  write(project, '.claude/skills/demo-skill/SKILL.md', SKILL.replace(/\n/g, '\r\n'));
  assert.equal(inspect(root, project).items.find(i => i.kind === 'skill').state, 'same');
});
