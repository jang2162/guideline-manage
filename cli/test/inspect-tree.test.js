import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRichDocsRepo, filesOf, tmpDir, write, ALWAYS } from './helpers.js';
import { inspect, itemDiff } from '../src/inspect.js';
import { checkOverrides } from '../src/project-overrides.js';
import { memoryTree } from '../src/tree.js';

/** 지침이 조금씩 들어간 ruler 프로젝트. */
function rulerProject(root) {
  const p = tmpDir('guideline-proj-');
  write(p, '.ruler/base/00-alpha.md', '# alpha\n\nA1\n');
  write(p, '.ruler/base/02-git.md', '# git\n\n## 워크트리는 저장소 안에\n\n다름\n');
  write(p, '.ruler/base/override.md', '## 바꿈\n\n바꾸는 절: `base/02-git.md` 「워크트리는 저장소 안에」\n\n규칙\n');
  write(p, 'docs/guideline/base/05-old.md', '# 옛\n');
  fs.cpSync(`${root}/skills/demo-skill`, `${p}/.ruler/skills/demo-skill`, { recursive: true });
  write(p, '.ruler/skills/demo-skill/.DS_Store', 'x');
  write(p, '.mcp.json', JSON.stringify({ mcpServers: { context7: { command: 'npx', args: ['-y', 'other'] } } }));
  return p;
}

test('inspect 는 디스크 경로와 같은 내용의 트리에서 같은 결과를 낸다', t => {
  const root = makeRichDocsRepo();
  const project = rulerProject(root);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });
  const tree = memoryTree(filesOf(root));
  assert.deepEqual(inspect(tree, project), inspect(root, project));
  assert.deepEqual(inspect(tree, null), inspect(root, null));
  const states = Object.fromEntries(inspect(tree, project).items.map(i => [i.id, i.state]));
  assert.equal(states['rules/base/00-alpha.md'], 'same');
  assert.equal(states['rules/base/02-git.md'], 'different');
  assert.equal(states['skills/demo-skill'], 'same');
  assert.equal(states['docs/guideline/base/05-old.md'], 'orphan');
});

test('itemDiff 도 트리에서 같은 차이를 낸다', t => {
  const root = makeRichDocsRepo();
  const project = rulerProject(root);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });
  const tree = memoryTree(filesOf(root));
  for (const item of inspect(root, project).items) {
    if (['different', 'moved'].includes(item.state)) assert.deepEqual(itemDiff(tree, project, item), itemDiff(root, project, item), item.id);
  }
});

test('checkOverrides 는 트리를 받는다', t => {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/03-x.md', `${ALWAYS}# x\n\n## 있다\n\n본문\n`);
  const tree = memoryTree(filesOf(root));
  const overrides = [
    { file: 'f', stack: 'base', heading: 'h', target: 'rules/base/03-x.md', title: '있다' },
    { file: 'f', stack: 'base', heading: 'h', target: 'rules/base/03-x.md', title: '없다' },
    { file: 'f', stack: 'base', heading: 'h', target: 'rules/base/77-none.md', title: null },
  ];
  assert.deepEqual(checkOverrides(overrides, tree), checkOverrides(overrides, root));
  assert.deepEqual(checkOverrides(overrides, tree).map(o => o.valid), [true, false, false]);
});
