import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChanges, diffCounts, changeTree } from '../src/web/change-tree.js';
import { diffBlock } from '../src/web/layout.js';

const summary = { stacks: [{ name: 'base' }], skills: ['s'], subagents: ['w'], mcp: [], labels: { 'rules/base': '기본 규칙' } };

test('groupChanges 는 종류 → 블록 → 파일로 묶고, 문서와 블록 밖 경로는 문서 묶음에 둔다', () => {
  const groups = groupChanges(['rules/base/README.md', 'skills/s/SKILL.md', 'docs/x.md', 'rules/base/00-a.md', 'agents/w.md', 'rules/gone/00-a.md', 'agents/README.md'], summary);
  assert.deepEqual(groups.map(g => g.kind), ['stack', 'skill', 'agent', 'docs']);
  const stack = groups[0];
  assert.deepEqual(stack.blocks.map(b => [b.name, b.label]), [['base', '기본 규칙'], ['gone', null]]);
  assert.deepEqual(stack.blocks[0].files.map(f => f.rel), ['00-a.md', 'README.md']);
  assert.deepEqual(groups[2].blocks[0].files.map(f => f.path), ['agents/w.md']);
  assert.deepEqual(groups[3].blocks[0].files.map(f => f.path), ['docs/x.md', 'agents/README.md']);
  assert.equal(groups[3].blocks[0].name, null);
});

test('diffCounts 는 머리 줄을 빼고 더한·뺀 줄을 센다', () => {
  assert.deepEqual(diffCounts('--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n+d\n'), { add: 2, del: 1 });
  assert.deepEqual(diffCounts(''), { add: 0, del: 0 });
});

test('changeTree 는 지금 파일에 aria-current, 파일 옆에 +N −M', () => {
  const groups = groupChanges(['rules/base/00-a.md', 'docs/x.md'], summary);
  const out = String(changeTree(groups, 'docs/x.md', p => `/r/2?file=${encodeURIComponent(p)}`, new Map([['docs/x.md', { add: 3, del: 1 }]])));
  assert.match(out, /<a class="on" href="\/r\/2\?file=docs%2Fx\.md"[^>]*aria-current="page"/);
  assert.ok(out.includes('+3') && out.includes('−1'));
  assert.ok(out.includes('기본 규칙'));
  assert.ok(out.includes('<details open>'));
});

test('diffBlock 은 80줄이 넘으면 앞 80줄만 보이고 나머지를 접는다', () => {
  const text = Array.from({ length: 200 }, (_, i) => `+line${i}`).join('\n');
  const out = String(diffBlock(text));
  assert.ok(out.includes('나머지 120줄 보기'));
  const shown = out.slice(0, out.indexOf('<details'));
  assert.ok(shown.includes('line79') && !shown.includes('line80'));
  assert.ok(!String(diffBlock('+a\n+b')).includes('<details'));
});
