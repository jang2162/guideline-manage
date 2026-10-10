import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRichDocsRepo, filesOf, collect } from './helpers.js';
import { catalogSummary } from '../src/summary.js';
import { memoryTree } from '../src/tree.js';
import { readServer } from '../src/mcp.js';
import { list } from '../src/commands/list.js';

test('catalogSummary 는 디스크 경로와 같은 내용의 메모리 트리에서 같은 결과를 낸다', t => {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const disk = catalogSummary(root);
  assert.deepEqual(catalogSummary(memoryTree(filesOf(root))), disk);

  // 픽스처가 목록의 갈래를 실제로 건드리는지 본다. 빈 결과끼리 같아서 통과하는 것을 막는다.
  assert.ok(disk.stacks.find(s => s.name === 'base').setup);
  assert.equal(disk.stacks.find(s => s.name === 'orca').overrides.length, 1);
  assert.deepEqual(disk.ignored.map(i => i.path), ['agents/bad.md', 'agents/notes.txt', 'mcp/file.txt', 'rules/base/오타.md', 'skills/no-skill/']);
  const warned = new Set(disk.warnings.map(w => w.path));
  for (const p of ['rules/demo/01-bad.md', 'rules/orca/README.md', 'mcp/leaky/server.json', 'mcp/both/', 'skills/cat-skill/SKILL.md']) {
    assert.ok(warned.has(p), p);
  }
  assert.deepEqual(disk.mcp.map(m => m.name), ['both', 'builder', 'context7', 'gitlab', 'leaky']);
  assert.equal(disk.mcp.find(m => m.name === 'builder').build, true);
  assert.deepEqual(disk.mcp.find(m => m.name === 'gitlab').envVars, ['GITLAB_TOKEN']);
  assert.deepEqual(disk.subagents, ['code-reviewer']);
  assert.deepEqual(disk.categories['rules/base'], ['공통']);
  assert.deepEqual(disk.categories['rules/orca/00-switch.md'], ['orca']);
  assert.deepEqual(disk.categories['agents/code-reviewer.md'], ['검토']);
  assert.deepEqual(disk.categories['mcp/gitlab'], ['gitlab']);
});

test('list --json 은 catalogSummary 와 같다', async t => {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = collect();
  await list({ root, json: true, out: c.out });
  assert.deepEqual(JSON.parse(c.text()), catalogSummary(root));
});

test('readServer 는 트리와 상대 경로로도 읽는다', () => {
  const tree = memoryTree({ 'mcp/x/server.json': JSON.stringify({ type: 'stdio', command: 'npx' }) });
  assert.deepEqual(readServer(tree, 'mcp/x'), { server: { type: 'stdio', command: 'npx' } });
  assert.deepEqual(readServer(tree, 'mcp/none'), { reason: 'server.json 없음' });
});
