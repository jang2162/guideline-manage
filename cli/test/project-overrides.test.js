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

test('바꿈이 틀리면 valid 가 거짓이고 이유가 붙는다', t => {
  const { root, project } = setup(t);
  write(project, '.guideline/overrides/base/override.md', [
    '## 첫 줄 없음', '', '규칙만 있다', '',
    '## 다른 스택', '', '바꾸는 절: `demo/00-rules.md`', '',
    '## 없는 파일', '', '바꾸는 절: `base/07-none.md`', '',
    '## 없는 절', '', '바꾸는 절: `base/00-alpha.md` 「없는 절」', '',
  ].join('\n'));
  const list = checkOverrides(readProjectOverrides(project), root);
  assert.deepEqual(list.map(o => [o.heading, o.valid, o.reason]), [
    ['첫 줄 없음', false, '첫 줄이 「바꾸는 절: `<스택>/<파일>` 「<## 절 제목>」」 꼴이 아님'],
    ['다른 스택', false, '다른 스택(demo)의 절을 가리킴'],
    ['없는 파일', false, '원본에 base/07-none.md 이 없음'],
    ['없는 절', false, 'base/00-alpha.md 에 「없는 절」 절이 없음'],
  ]);
});

test('하위 스택 폴더의 override.md 와 override.d 를 .guideline/overrides 기준 경로 스택으로 읽는다', t => {
  const { root, project } = setup(t);
  write(root, 'rules/browser/neo/00-n.md', `${ALWAYS}# n\n\n## 네오 절\n\nN\n`);
  write(root, 'rules/browser/neo/deep/00-d.md', `${ALWAYS}# d\n\n## 깊은 절\n\nD\n`);
  write(project, '.guideline/overrides/browser/neo/override.md', '## 네오\n\n바꾸는 절: `browser/neo/00-n.md` 「네오 절」\n');
  write(project, '.guideline/overrides/browser/neo/deep/override.d/01-x.md', '## 깊이\n\nOverrides: `browser/neo/deep/00-d.md` "깊은 절"\n');
  write(project, '.guideline/overrides/browser/neo/override.d/02-y.md', '## 다른 스택\n\n바꾸는 절: `browser/00-t.md`\n');
  assert.deepEqual(checkOverrides(readProjectOverrides(project), root).map(o => [o.file, o.stack, o.target, o.title, o.valid, o.reason]), [
    ['.guideline/overrides/browser/neo/deep/override.d/01-x.md', 'browser/neo/deep', 'rules/browser/neo/deep/00-d.md', '깊은 절', true, undefined],
    ['.guideline/overrides/browser/neo/override.d/02-y.md', 'browser/neo', 'rules/browser/00-t.md', null, false, '다른 스택(browser)의 절을 가리킴'],
    ['.guideline/overrides/browser/neo/override.md', 'browser/neo', 'rules/browser/neo/00-n.md', '네오 절', true, undefined],
  ]);
});

test('바꿈이 없는 프로젝트는 빈 배열이고, 옛 자리(.ruler/<스택>/override.md·CLAUDE.md 절)는 읽지 않는다', t => {
  const { project } = setup(t);
  assert.deepEqual(readProjectOverrides(project), []);
  write(project, '.ruler/base/override.md', '## 옛 자리\n\n바꾸는 절: `base/00-alpha.md`\n');
  write(project, 'CLAUDE.md', '# 지침\n\n## base 프로젝트 바꿈\n\n### 밖에\n\n바꾸는 절: `base/00-alpha.md`\n');
  assert.deepEqual(readProjectOverrides(project), []);
});

test('바꿈은 .guideline/overrides 의 override.md 와 override.d/*.md 의 ## 절에서 읽는다', t => {
  const { root, project } = setup(t);
  write(project, '.guideline/overrides/base/override.md', '## 밖에 만든다\n\n바꾸는 절: `base/00-alpha.md` 「기본 절」\n');
  write(project, '.guideline/overrides/base/override.d/01-beta.md', '## 베타 전체\n\n바꾸는 절: `base/01-beta.md`\n');
  write(project, '.guideline/overrides/deploy__a.b/override.md', '## 배포\n\n바꾸는 절: `deploy__a.b/00-x.md` 「배포 절」\n');
  // 조합이 복사한 .ruler/ 쪽은 읽지 않는다
  write(project, '.ruler/base/override.md', '## 생성물\n\n바꾸는 절: `base/00-alpha.md`\n');
  assert.deepEqual(checkOverrides(readProjectOverrides(project), root), [
    { file: '.guideline/overrides/base/override.d/01-beta.md', stack: 'base', heading: '베타 전체', target: 'rules/base/01-beta.md', title: null, valid: true },
    { file: '.guideline/overrides/base/override.md', stack: 'base', heading: '밖에 만든다', target: 'rules/base/00-alpha.md', title: '기본 절', valid: true },
    { file: '.guideline/overrides/deploy__a.b/override.md', stack: 'deploy__a.b', heading: '배포', target: 'rules/deploy__a.b/00-x.md', title: '배포 절', valid: true },
  ]);
});
