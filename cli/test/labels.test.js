import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write, ALWAYS } from './helpers.js';
import { elementLabels } from '../src/catalog.js';
import { catalogSummary } from '../src/summary.js';
import { catalogView } from '../src/catalog-view.js';

function labelled() {
  const root = tmpDir('guideline-labels-');
  write(root, 'rules/deploy-agent__deploy.kbrainc.dev/README.md', '---\nlabel: 사내 개발서버 배포\n---\n# d\n');
  write(root, 'rules/deploy-agent__deploy.kbrainc.dev/00-a.md', `${ALWAYS}# a\n`);
  write(root, 'rules/base/README.md', '# base\n');
  write(root, 'rules/base/00-a.md', `${ALWAYS}# a\n`);
  write(root, 'skills/s/SKILL.md', '---\nname: s\nlabel: "배포: 패키지"\n---\n');
  write(root, 'agents/w.md', '---\nname: w\ndescription: 작업\nlabel: 작업자\n---\n');
  write(root, 'agents/blank.md', '---\nname: blank\ndescription: 빈 값\nlabel:\n---\n');
  return root;
}

test('label 은 categories 와 같은 자리에서 읽고, 따옴표를 풀고, 없거나 비면 키가 없다', t => {
  const root = labelled();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(elementLabels(root).labels, {
    'rules/deploy-agent__deploy.kbrainc.dev': '사내 개발서버 배포',
    'skills/s': '배포: 패키지',
    'agents/w.md': '작업자',
  });
  assert.deepEqual(catalogSummary(root).labels, elementLabels(root).labels);
});

test('catalogView 는 블록마다 label 을 싣고, 없으면 null', t => {
  const root = labelled();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const v = catalogView(root);
  assert.equal(v.stacks.find(s => s.name === 'base').label, null);
  assert.equal(v.stacks.find(s => s.name.startsWith('deploy-agent')).label, '사내 개발서버 배포');
  assert.equal(v.skills[0].label, '배포: 패키지');
  assert.equal(v.subagents.find(a => a.name === 'w').label, '작업자');
  assert.equal(v.subagents.find(a => a.name === 'blank').label, null);
});
