import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDocsRepo, tmpDir, write, ALWAYS } from './helpers.js';
import { readProjectOverrides, checkOverrides } from '../src/project-overrides.js';

function setup(t) {
  const root = makeDocsRepo();
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\n## 기본 절\n\nA\n`);
  write(root, 'rules/deploy__a.b/00-x.md', `${ALWAYS}# x\n\n## 배포 절\n\nX\n`);
  const project = tmpDir('guideline-proj-');
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });
  return { root, project };
}

test('ruler 프로젝트의 override.md 와 override.d/*.md 의 ## 절을 바꿈으로 읽는다', t => {
  const { root, project } = setup(t);
  write(project, '.ruler/base/override.md', '# base 바꿈\n\n## 이 프로젝트는 밖에 만든다\n\n바꾸는 절: `base/00-alpha.md` 「기본 절」\n\n규칙\n');
  write(project, '.ruler/base/override.d/01-beta.md', '## 베타 전체\n\n바꾸는 절: `base/01-beta.md`\n\n규칙\n');
  write(project, '.ruler/deploy__a.b/override.md', '## 배포\n\n바꾸는 절: `deploy__a.b/00-x.md` 「배포 절」\n');
  assert.deepEqual(checkOverrides(readProjectOverrides(project, 'ruler', []), root), [
    { file: '.ruler/base/override.d/01-beta.md', stack: 'base', heading: '베타 전체', target: 'rules/base/01-beta.md', title: null, valid: true },
    { file: '.ruler/base/override.md', stack: 'base', heading: '이 프로젝트는 밖에 만든다', target: 'rules/base/00-alpha.md', title: '기본 절', valid: true },
    { file: '.ruler/deploy__a.b/override.md', stack: 'deploy__a.b', heading: '배포', target: 'rules/deploy__a.b/00-x.md', title: '배포 절', valid: true },
  ]);
});

test('바꿈이 틀리면 valid 가 거짓이고 이유가 붙는다', t => {
  const { root, project } = setup(t);
  write(project, '.ruler/base/override.md', [
    '## 첫 줄 없음', '', '규칙만 있다', '',
    '## 다른 스택', '', '바꾸는 절: `demo/00-rules.md`', '',
    '## 없는 파일', '', '바꾸는 절: `base/07-none.md`', '',
    '## 없는 절', '', '바꾸는 절: `base/00-alpha.md` 「없는 절」', '',
  ].join('\n'));
  const list = checkOverrides(readProjectOverrides(project, 'ruler', []), root);
  assert.deepEqual(list.map(o => [o.heading, o.valid, o.reason]), [
    ['첫 줄 없음', false, '첫 줄이 「바꾸는 절: `<스택>/<파일>` 「<## 절 제목>」」 꼴이 아님'],
    ['다른 스택', false, '다른 스택(demo)의 절을 가리킴'],
    ['없는 파일', false, '원본에 base/07-none.md 이 없음'],
    ['없는 절', false, 'base/00-alpha.md 에 「없는 절」 절이 없음'],
  ]);
});

test('instructions 형태는 ## <스택> 프로젝트 바꿈 절의 ### 를 읽고, 사본 파일의 같은 바꿈은 하나로 친다', t => {
  const { root, project } = setup(t);
  const text = '# 지침\n\n## base 프로젝트 바꿈\n\n### 밖에 만든다\n\n바꾸는 절: `base/00-alpha.md` 「기본 절」\n\n규칙\n\n## 다른 절\n\n### 바꿈 아님\n\n본문\n';
  write(project, 'CLAUDE.md', text);
  write(project, 'AGENTS.md', text);
  assert.deepEqual(checkOverrides(readProjectOverrides(project, 'instructions', ['CLAUDE.md', 'AGENTS.md']), root), [
    { file: 'CLAUDE.md', stack: 'base', heading: '밖에 만든다', target: 'rules/base/00-alpha.md', title: '기본 절', valid: true },
  ]);
});

test('none 형태나 바꿈이 없는 프로젝트는 빈 배열', t => {
  const { project } = setup(t);
  assert.deepEqual(readProjectOverrides(project, 'none', []), []);
  write(project, '.ruler/base/00-alpha.md', '# alpha\n');
  assert.deepEqual(readProjectOverrides(project, 'ruler', []), []);
});
