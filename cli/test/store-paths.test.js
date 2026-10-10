import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathProblem, contentProblem, writeProblems, isTextPath, inStoreRoots, MAX_FILE_BYTES } from '../src/store-paths.js';

test('pathProblem 은 허용하는 경로에 null 을 낸다', () => {
  for (const p of ['rules/base/00-a.md', 'skills/s/assets/logo.png', 'agents/x.md', 'mcp/gitlab/server.json', 'docs/authoring.md', 'rules/한글/00-a.md']) {
    assert.equal(pathProblem(p), null, p);
  }
});

test('pathProblem 은 규칙을 어긴 경로마다 이유를 낸다', () => {
  const cases = {
    '': '경로가 비어 있음',
    '/rules/a.md': '절대경로는 쓸 수 없음',
    'rules/a\tb.md': '제어 문자나 \\ 는 쓸 수 없음',
    'rules\\a.md': '제어 문자나 \\ 는 쓸 수 없음',
    'rules//a.md': '빈 경로 조각이 있음',
    'rules/a/': '빈 경로 조각이 있음',
    'rules/../x.md': '. 이나 .. 은 쓸 수 없음',
    'rules/./x.md': '. 이나 .. 은 쓸 수 없음',
    'agents/.gitkeep': '이름이 . 으로 시작하는 조각은 쓸 수 없음',
    'rules/.hidden/a.md': '이름이 . 으로 시작하는 조각은 쓸 수 없음',
    'docs/other.md': '최상위는 rules/, skills/, agents/, mcp/ 또는 docs/authoring.md·docs/management.md 여야 함',
    'package.json': '최상위는 rules/, skills/, agents/, mcp/ 또는 docs/authoring.md·docs/management.md 여야 함',
    'rules': '최상위는 rules/, skills/, agents/, mcp/ 또는 docs/authoring.md·docs/management.md 여야 함',
  };
  for (const [p, message] of Object.entries(cases)) assert.equal(pathProblem(p), message, JSON.stringify(p));
});

test('contentProblem 은 크기와 텍스트 파일의 UTF-8 을 본다', () => {
  assert.equal(contentProblem('rules/a/00-x.md', Buffer.from('한글')), null);
  assert.equal(contentProblem('rules/a/00-x.md', Buffer.alloc(MAX_FILE_BYTES)), null);
  assert.equal(contentProblem('rules/a/00-x.md', Buffer.alloc(MAX_FILE_BYTES + 1)), '파일이 1MB 를 넘음');
  assert.equal(contentProblem('rules/a/00-x.md', Buffer.from([0xff, 0xfe])), 'UTF-8 이 아님');
  assert.equal(contentProblem('skills/s/logo.png', Buffer.from([0xff, 0xfe])), null);
});

test('isTextPath 와 inStoreRoots', () => {
  assert.equal(isTextPath('a/B.MD'), true);
  assert.equal(isTextPath('a/x.png'), false);
  assert.equal(inStoreRoots('agents/.gitkeep'), true);
  assert.equal(inStoreRoots('docs/superpowers/x.md'), false);
});

test('writeProblems 는 경로·내용 문제와 파일·디렉터리 충돌을 모은다', () => {
  const existing = ['skills/a/SKILL.md', 'rules/x/00-a.md'];
  assert.deepEqual(writeProblems({ 'rules/x/01-b.md': Buffer.from('b') }, existing), []);
  assert.deepEqual(writeProblems({ 'skills/a': Buffer.from('x') }, existing), [
    { path: 'skills/a', message: 'skills/a 는 디렉터리라 파일로 둘 수 없음' },
  ]);
  assert.deepEqual(writeProblems({ 'rules/x/00-a.md/y.md': Buffer.from('y') }, existing), [
    { path: 'rules/x/00-a.md/y.md', message: 'rules/x/00-a.md 가 파일이라 그 아래에 둘 수 없음' },
  ]);
  // 같은 쓰기에서 파일을 지우고 그 자리를 디렉터리로 쓰면 충돌이 아니다(이름 바꾸기)
  assert.deepEqual(writeProblems({ 'rules/x/00-a.md': null, 'rules/x/00-a.md/y.md': Buffer.from('y') }, existing), []);
  assert.deepEqual(writeProblems({ 'docs/x.md': Buffer.from('x'), 'rules/x/02.md': Buffer.from([0xff]) }, existing), [
    { path: 'docs/x.md', message: '최상위는 rules/, skills/, agents/, mcp/ 또는 docs/authoring.md·docs/management.md 여야 함' },
    { path: 'rules/x/02.md', message: 'UTF-8 이 아님' },
  ]);
});

test('docs/management.md 는 원본 경로다', () => {
  assert.equal(pathProblem('docs/management.md'), null);
  assert.match(pathProblem('docs/other.md'), /docs\/authoring\.md·docs\/management\.md/);
});
