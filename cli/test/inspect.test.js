import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDocsRepo, tmpDir, write, ALWAYS } from './helpers.js';
import { inspect, stripFrontmatter, itemDiff } from '../src/inspect.js';
import { memoryTree } from '../src/tree.js';

// inspect 는 .guideline/ 사본(원본 모양)을 원본과 비교한다. 옛 배치(.ruler/·docs/guideline/ 사본, CLAUDE.md 절)를 보던 시험을 옮긴 것.

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
const SKILL = '---\nname: demo-skill\ndescription: 데모\n---\n\n본문\n';

test('stripFrontmatter 는 frontmatter 와 그 뒤 빈 줄을 떼고 줄바꿈을 \\n 으로 맞춘다', () => {
  assert.equal(stripFrontmatter('---\nload: always\n---\n\n# a\n'), '# a\n');
  assert.equal(stripFrontmatter('# a\n'), '# a\n');
  assert.equal(stripFrontmatter('---\r\nload: always\r\n---\r\n\r\n# a\r\n'), '# a\n');
});

test('새 프로젝트(null)는 모든 지침이 missing 이고 바꿈·고아가 없다', t => {
  const { root } = setup(t);
  const r = inspect(root, null);
  assert.deepEqual(states(r), { 'rules/base/00-alpha.md': 'missing', 'rules/base/01-beta.md': 'missing', 'rules/demo/00-rules.md': 'missing' });
  assert.deepEqual(r.overrides, []);
  assert.equal(r.items.some(i => i.kind === 'orphan'), false);
});

test('옛 배치 자리(.ruler/·docs/guideline/·CLAUDE.md 절)의 사본은 보지 않는다 — moved 는 없다', t => {
  const { root, project } = setup(t);
  write(project, '.ruler/base/00-alpha.md', '# alpha\n\nA1\n');
  write(project, 'docs/guideline/base/01-beta.md', '# beta\n\nB1\n');
  write(project, 'CLAUDE.md', '# p\n\n## demo rules\n\nD1\n');
  write(project, '.claude/skills/demo-skill/SKILL.md', SKILL);
  const r = inspect(root, project);
  assert.deepEqual(states(r), { 'rules/base/00-alpha.md': 'missing', 'rules/base/01-beta.md': 'missing', 'rules/demo/00-rules.md': 'missing' });
  assert.equal(item(r, 'skills/demo-skill').state, 'missing');
  assert.equal(r.items.some(i => i.kind === 'orphan'), false);
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

test('세팅 문서는 원본 스택에 SETUP.md 가 있을 때만 행이 생기고 .guideline 사본과 비교한다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/SETUP.md', '# base 세팅\n');
  assert.deepEqual(states(inspect(root, project), 'setup'), { 'rules/base/SETUP.md': 'missing' });
  assert.deepEqual(states(inspect(root, null), 'setup'), { 'rules/base/SETUP.md': 'missing' });
  write(project, '.guideline/rules/base/SETUP.md', '# base 세팅\n');
  assert.deepEqual(states(inspect(root, project), 'setup'), { 'rules/base/SETUP.md': 'same' });
  write(project, '.guideline/rules/base/SETUP.md', '# 고침\n');
  const r = inspect(root, project);
  assert.deepEqual(states(r, 'setup'), { 'rules/base/SETUP.md': 'different' });
  assert.equal(item(r, 'rules/base/SETUP.md').stack, 'base');
});

test('inspect 는 .guideline/overrides 의 프로젝트 바꿈을 원본과 대조해 담는다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 기본 절\n\nA\n`);
  write(project, '.guideline/overrides/base/override.md', '## 바꿈\n\n바꾸는 절: `base/00-alpha.md` 「기본 절」\n');
  // 조합이 복사한 .ruler/ 쪽은 읽지 않는다
  write(project, '.ruler/base/override.md', '## 바꿈\n\n바꾸는 절: `base/00-alpha.md` 「기본 절」\n');
  assert.deepEqual(inspect(root, project).overrides, [
    { file: '.guideline/overrides/base/override.md', stack: 'base', heading: '바꿈', target: 'rules/base/00-alpha.md', title: '기본 절', valid: true },
  ]);
});

test('스킬은 .guideline/skills 사본 디렉터리 전체를 비교하고 점 파일은 보지 않는다', t => {
  const { root, project } = setup(t);
  write(root, 'skills/demo-skill/ref/a.md', 'A\n');
  write(project, '.guideline/skills/demo-skill/SKILL.md', SKILL);
  write(project, '.guideline/skills/demo-skill/ref/a.md', 'A\n');
  write(project, '.guideline/skills/demo-skill/.DS_Store', 'x');
  let it = inspect(root, project).items.find(i => i.kind === 'skill');
  assert.deepEqual([it.id, it.state, it.where], ['skills/demo-skill', 'same', ['.guideline/skills/demo-skill']]);
  write(project, '.guideline/skills/demo-skill/extra.md', '추가\n');
  it = inspect(root, project).items.find(i => i.kind === 'skill');
  assert.equal(it.state, 'different');
});

test('서브에이전트는 .guideline/agents 사본만 본다(Codex·.claude 쪽 생성물은 보지 않는다)', t => {
  const { root, project } = setup(t);
  const agent = '---\nname: reviewer\ndescription: 검토\n---\n\n본문\n';
  write(root, 'agents/reviewer.md', agent);
  write(root, 'agents/writer.md', '---\nname: writer\ndescription: 쓰기\n---\n');
  write(project, '.guideline/agents/reviewer.md', agent);
  write(project, '.codex/agents/writer.toml', 'name = "writer"\n');
  const r = inspect(root, project);
  assert.deepEqual(states(r, 'subagent'), { 'agents/reviewer.md': 'same', 'agents/writer.md': 'missing' });
});

test('build MCP 는 사본이 없어 .mcp.json·TOML 에 그 이름이 있으면 present, .mcp.json 이 깨져 있으면 unknown 이고 이유가 붙는다', t => {
  const { root, project } = setup(t);
  for (const n of ['gitlab', 'jira', 'wiki', 'none']) write(root, `mcp/${n}/README.md`, '## 반영할 때 항목 만들기\n\n뽑는다\n');
  write(project, '.mcp.json', JSON.stringify({ mcpServers: { gitlab: { type: 'http', url: 'https://g' } } }));
  write(project, '.ruler/ruler.toml', '[agents.claude.mcp_servers.jira]\ntype = "http"\n');
  write(project, '.codex/config.toml', '[mcp_servers."wiki"]\nurl = "https://w"\n');
  const r = inspect(root, project);
  assert.deepEqual(states(r, 'mcp'), { 'mcp/gitlab': 'present', 'mcp/jira': 'present', 'mcp/none': 'missing', 'mcp/wiki': 'present' });
  assert.equal(item(r, 'mcp/gitlab').build, true);
  assert.deepEqual(item(r, 'mcp/jira').where, ['.ruler/ruler.toml']);
  assert.deepEqual(item(r, 'mcp/wiki').where, ['.codex/config.toml']);
  write(project, '.mcp.json', '{ 깨짐');
  const b = inspect(root, project);
  assert.deepEqual([item(b, 'mcp/none').state, item(b, 'mcp/none').reason], ['unknown', '.mcp.json 을 JSON 으로 읽을 수 없음']);
  assert.deepEqual([item(b, 'mcp/jira').state, item(b, 'mcp/jira').reason], ['present', '.mcp.json 을 JSON 으로 읽을 수 없음']);
});

test('itemDiff 는 스킬의 파일마다 차이를 낸다', t => {
  const { root, project } = setup(t);
  write(project, '.guideline/skills/demo-skill/SKILL.md', SKILL.replace('본문', '본문 고침'));
  write(project, '.guideline/skills/demo-skill/extra.md', '추가\n');
  const r = inspect(root, project);
  const files = itemDiff(root, project, r.items.find(i => i.kind === 'skill')).files;
  assert.deepEqual(files.map(f => f.path), ['.guideline/skills/demo-skill/SKILL.md', '.guideline/skills/demo-skill/extra.md']);
  assert.deepEqual(itemDiff(root, project, item(r, 'rules/demo/00-rules.md')), { files: [] });
});

test('스킬 사본이 줄바꿈 문자(CRLF)로만 다르면 same 이다', t => {
  const { root, project } = setup(t);
  write(project, '.guideline/skills/demo-skill/SKILL.md', SKILL.replace(/\n/g, '\r\n'));
  assert.equal(inspect(root, project).items.find(i => i.kind === 'skill').state, 'same');
});

test('하위 스택 지침은 .guideline/rules/<스택 경로>/ 사본과 비교하고 항목의 stack 은 경로다', t => {
  const { project } = setup(t);
  const src = `${ALWAYS}# x\n\nX1\n`;
  write(project, '.guideline/rules/browser/neo/00-x.md', src);
  const tree = memoryTree({ 'rules/browser/00-a.md': `${ALWAYS}# a\n`, 'rules/browser/neo/00-x.md': src });
  const r = inspect(tree, project);
  const x = item(r, 'rules/browser/neo/00-x.md');
  assert.deepEqual([x.stack, x.state, x.where], ['browser/neo', 'same', ['.guideline/rules/browser/neo/00-x.md']]);
  assert.equal(item(r, 'rules/browser/00-a.md').state, 'missing');
});

test('지침·세팅·스킬·서브에이전트·MCP 를 .guideline 사본과 원본 모양 그대로 비교한다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/base/SETUP.md', '# 세팅\n');
  write(root, 'agents/rev.md', '---\nname: rev\ndescription: 검토\n---\n\n# 검토\n');
  write(root, 'mcp/c7/server.json', '{"type":"stdio","command":"npx"}');
  write(root, 'mcp/c7/README.md', '# c7\n');
  write(root, 'mcp/jira/server.json', '{"type":"http","url":"https://j"}');
  write(root, 'mcp/gitlab/README.md', '## 반영할 때 항목 만들기\n\n뽑는다\n');
  write(project, '.ruler/ruler.project.toml', '');
  // frontmatter 를 그대로 둔 사본은 같다(CRLF 도 같다)
  write(project, '.guideline/rules/base/00-alpha.md', `${ALWAYS}# alpha\r\n\r\nA1\r\n`);
  write(project, '.guideline/rules/base/01-beta.md', '# beta\n\nB1\n');
  write(project, '.guideline/rules/base/SETUP.md', '# 세팅\n');
  write(project, '.guideline/skills/demo-skill/SKILL.md', '---\nname: demo-skill\ndescription: 데모\n---\n\n본문\n');
  write(project, '.guideline/agents/rev.md', '# 고침\n');
  write(project, '.guideline/mcp/c7/server.json', '{"type":"stdio","command":"npx"}');
  write(project, '.guideline/mcp/c7/README.md', '# c7\n');
  // 조합한 생성물이나 .mcp.json 은 보지 않는다
  write(project, '.ruler/demo/00-rules.md', '# demo rules\n\nD1\n');
  write(project, '.mcp.json', JSON.stringify({ mcpServers: { jira: { url: 'https://j' }, gitlab: { url: 'https://g' } } }));
  const r = inspect(root, project);
  assert.deepEqual(states(r), {
    'rules/base/00-alpha.md': 'same', 'rules/base/01-beta.md': 'different', 'rules/demo/00-rules.md': 'missing',
  });
  assert.deepEqual(item(r, 'rules/base/01-beta.md').where, ['.guideline/rules/base/01-beta.md']);
  assert.equal(item(r, 'rules/base/SETUP.md').state, 'same');
  assert.deepEqual([item(r, 'skills/demo-skill').state, item(r, 'skills/demo-skill').where], ['same', ['.guideline/skills/demo-skill']]);
  assert.equal(item(r, 'agents/rev.md').state, 'different');
  assert.deepEqual(states(r, 'mcp'), { 'mcp/c7': 'same', 'mcp/gitlab': 'present', 'mcp/jira': 'missing' });
  assert.equal(r.items.some(i => i.state === 'moved'), false);
  // 차이는 원본 모양(frontmatter 포함)끼리
  const d = itemDiff(root, project, item(r, 'rules/base/01-beta.md'));
  assert.equal(d.files[0].path, '.guideline/rules/base/01-beta.md');
  assert.match(d.files[0].diff, /-load: reference/);
});

test('MCP 사본이 다르면 different 이고 차이는 값 없이 키 경로만 낸다', t => {
  const { root, project } = setup(t);
  write(root, 'mcp/db/server.json', JSON.stringify({ type: 'stdio', command: 'npx', env: { PW: '${PW}' } }));
  write(project, '.guideline/mcp/db/server.json', JSON.stringify({ type: 'stdio', command: 'npx', env: { PW: 'hunter2' } }));
  const r = inspect(root, project);
  const it = item(r, 'mcp/db');
  assert.deepEqual([it.state, it.where], ['different', ['.guideline/mcp/db']]);
  const d = itemDiff(root, project, it);
  assert.deepEqual(Object.keys(d), ['keys']);
  assert.equal(JSON.stringify(d).includes('hunter2'), false);
  assert.equal(d.keys.length, 1);
});

test('원본에 없는 .guideline 사본은 orphan 이다', t => {
  const { root, project } = setup(t);
  write(root, 'agents/rev.md', '# 검토\n');
  write(root, 'mcp/c7/server.json', '{"type":"stdio","command":"npx"}');
  write(project, '.guideline/rules/base/00-alpha.md', `${ALWAYS}# alpha\n\nA1\n`);
  write(project, '.guideline/rules/base/07-gone.md', '# 사라짐\n');
  write(project, '.guideline/rules/base/sub/00-s.md', '# 하위\n');
  write(project, '.guideline/rules/old/SETUP.md', '# 옛 세팅\n');
  write(project, '.guideline/skills/demo-skill/SKILL.md', '# 있음\n');
  write(project, '.guideline/skills/old-skill/SKILL.md', '# 사라짐\n');
  write(project, '.guideline/agents/rev.md', '# 검토\n');
  write(project, '.guideline/agents/old.md', '# 사라짐\n');
  write(project, '.guideline/mcp/c7/server.json', '{}');
  write(project, '.guideline/mcp/old/server.json', '{}');
  // 바꿈·관리 지침은 사본이 아니다
  write(project, '.guideline/overrides/base/override.md', '## 바꿈\n');
  write(project, '.guideline/management/default.md', '# 관리\n');
  // 새 배치의 .ruler/·docs/guideline/ 은 조합한 생성물이라 보지 않는다
  write(project, '.ruler/base/07-gone.md', '# 생성물\n');
  write(project, 'docs/guideline/base/08-gone.md', '# 생성물\n');
  const r = inspect(root, project);
  assert.deepEqual(r.items.filter(i => i.kind === 'orphan').map(i => [i.id, i.stack ?? null]), [
    ['.guideline/rules/base/07-gone.md', 'base'],
    ['.guideline/rules/base/sub/00-s.md', 'base/sub'],
    ['.guideline/rules/old/SETUP.md', 'old'],
    ['.guideline/skills/old-skill', null],
    ['.guideline/agents/old.md', null],
    ['.guideline/mcp/old', null],
  ]);
});
