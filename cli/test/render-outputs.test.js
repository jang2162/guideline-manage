import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desiredOutputs, desiredPart, RULER_TOML_BASE, NESTED_TOML_BASE, isRootOnly } from '../src/render/outputs.js';
import { indexText, managementText, docsReadme } from '../src/render/text.js';
import { tableText } from '../src/toml-table.js';
import { codexEntry } from '../src/render/mcp.js';
import { DEPLOY, ALL, renderTree, manifestOf } from './render-fixture.js';

const ids = outputs => outputs.map(o => (o.key ? `${o.path}#${o.key}` : o.path)).sort();
const C7 = { type: 'stdio', command: 'npx', args: ['-y', 'c7'] };
const GL = { type: 'http', url: 'https://g/mcp', headers: { Authorization: 'Bearer ${GITLAB_TOKEN}' } };

test('ruler 형의 출력 자리', () => {
  const { outputs, todos } = desiredOutputs({ tree: renderTree(), manifest: manifestOf('ruler', ALL), items: ALL });
  assert.deepEqual(ids(outputs), [
    '.ruler/base/00-a.md',
    '.ruler/base/99-reference.md',
    `.ruler/${DEPLOY}/01-y.md`,
    `.ruler/${DEPLOY}/99-reference.md`,
    '.ruler/guideline.md',
    '.ruler/ruler.toml#agents.claude.mcp_servers.gl',
    '.ruler/ruler.toml#agents.codex.mcp_servers.gl',
    '.ruler/ruler.toml#mcp_servers.c7',
    '.ruler/skills/s/SKILL.md',
    '.ruler/skills/s/img/a.png',
    'docs/guideline/README.md',
    'docs/guideline/base/01-b.md',
    'docs/guideline/base/SETUP.md',
    `docs/guideline/${DEPLOY}/00-x.md`,
  ]);
  assert.deepEqual(todos.map(t => t.kind).sort(), ['env', 'mcp-build', 'subagents-off']);
  assert.deepEqual(todos.find(t => t.kind === 'env').data, { vars: ['GITLAB_TOKEN'], readme: 'mcp/gl/README.md' });
  const at = p => outputs.find(o => o.path === p);
  assert.equal(at('.ruler/base/00-a.md').content.toString(), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  assert.equal(at('.ruler/base/00-a.md').adopt, true);
  assert.equal(at('.ruler/guideline.md').owned, true);
  assert.equal(at('.ruler/guideline.md').content.toString(), managementText({ setupStacks: ['base'] }));
  assert.equal(at(`.ruler/${DEPLOY}/99-reference.md`).content.toString(),
    indexText(DEPLOY, [{ when: '배포 | 할 때', path: `docs/guideline/${DEPLOY}/00-x.md` }]));
  assert.equal(at('docs/guideline/README.md').content.toString(), docsReadme());
  assert.deepEqual([...at('.ruler/skills/s/img/a.png').content], [1, 2, 3]);
  const gl = outputs.filter(o => o.items[0] === 'mcp/gl');
  assert.deepEqual(gl.map(o => o.entry), [GL, codexEntry(GL)]);
  assert.deepEqual(outputs.find(o => o.key === 'mcp_servers.c7').entry, C7);
  assert.equal(outputs.every(o => o.kind === 'file' || o.kind === 'toml'), true);
});

test('[agents] 가 켜져 있으면 서브에이전트를 그대로 쓴다', () => {
  const { outputs, todos } = desiredOutputs({
    tree: renderTree(), manifest: manifestOf('ruler', ['agents/rev.md']), items: ['agents/rev.md'], rulerAgentsEnabled: true,
  });
  assert.deepEqual(ids(outputs), ['.ruler/agents/rev.md', '.ruler/guideline.md']);
  assert.match(outputs[0].content.toString(), /^---\nname: rev/);
  assert.deepEqual(todos, []);
});

test('desiredPart 는 파일이면 내용, TOML 이면 그 표의 글자', () => {
  assert.equal(desiredPart({ kind: 'file', content: Buffer.from('a') }).toString(), 'a');
  assert.equal(desiredPart({ kind: 'toml', segs: ['mcp_servers', 'c7'], entry: C7 }).toString(), tableText(['mcp_servers', 'c7'], C7));
});

test('RULER_TOML_BASE 와 중첩 단위의 NESTED_TOML_BASE', () => {
  assert.equal(RULER_TOML_BASE(['codex', 'claude']), 'default_agents = ["claude", "codex"]\nnested = false\n\n[gitignore]\nenabled = true\n');
  assert.equal(NESTED_TOML_BASE(['codex', 'claude']), 'default_agents = ["claude", "codex"]\n');
});

test('isRootOnly 는 스킬·서브에이전트·MCP 다', () => {
  assert.deepEqual(['skills/s', 'agents/a.md', 'mcp/c7', 'rules/base/00-a.md', 'rules/base/SETUP.md'].map(isRootOnly), [true, true, true, false, false]);
});
