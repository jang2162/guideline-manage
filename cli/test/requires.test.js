import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write, ALWAYS } from './helpers.js';
import { elementRequires, warnings } from '../src/catalog.js';
import { catalogSummary } from '../src/summary.js';
import { catalogView } from '../src/catalog-view.js';

function repo() {
  const root = tmpDir('guideline-requires-');
  write(root, 'rules/browseros-neo/00-a.md', `${ALWAYS}# a\n`);
  write(root, 'rules/orca/00-a.md', `${ALWAYS}# a\n`);
  write(root, 'rules/bad/README.md', '---\nrequires: rules/orca\n---\n# bad\n');
  write(root, 'rules/bad/00-a.md', `${ALWAYS}# a\n`);
  write(root, 'mcp/playwright-neo/server.json', JSON.stringify({ type: 'stdio', command: 'npx' }));
  write(root, 'mcp/playwright-neo/README.md', '---\nrequires: [rules/browseros-neo]\n---\n# p\n');
  write(root, 'skills/orca-worker/SKILL.md', '---\nname: orca-worker\ndescription: d\nrequires: [rules/orca, mcp/nope]\n---\n');
  write(root, 'agents/w.md', '---\nname: w\ndescription: d\nrequires: [skills/orca-worker]\n---\n');
  return root;
}

test('requires 는 블록 frontmatter 에서 블록 키 목록으로 읽고, 서브에이전트 키는 agents/<이름>.md', t => {
  const root = repo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(elementRequires(root).requires, {
    'mcp/playwright-neo': ['rules/browseros-neo'],
    'skills/orca-worker': ['rules/orca', 'mcp/nope'],
    'agents/w.md': ['skills/orca-worker'],
  });
  assert.deepEqual(catalogSummary(root).requires, elementRequires(root).requires);
});

test('requires 가 목록 꼴이 아니거나 원본에 없는 블록을 가리키면 경고', t => {
  const root = repo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const w = warnings(root);
  assert.ok(w.some(x => x.path === 'rules/bad/README.md'), JSON.stringify(w));
  assert.ok(w.some(x => x.path === 'skills/orca-worker/SKILL.md' && x.message.includes('mcp/nope')), JSON.stringify(w));
  assert.ok(!w.some(x => x.path === 'mcp/playwright-neo/README.md'));
});

test('catalogView 는 블록마다 requires 배열을 싣고, 없으면 빈 배열', t => {
  const root = repo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const v = catalogView(root);
  assert.deepEqual(v.mcp[0].requires, ['rules/browseros-neo']);
  assert.deepEqual(v.stacks.find(s => s.name === 'orca').requires, []);
  assert.deepEqual(v.subagents[0].requires, ['skills/orca-worker']);
});
