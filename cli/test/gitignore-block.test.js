import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBlock, writeBlock } from '../src/gitignore-block.js';

const block = lines => ['# START guideline generated files', ...lines, '# END guideline generated files', ''].join('\n');

test('writeBlock 은 블록이 없으면 끝에 붙인다', () => {
  assert.equal(writeBlock(null, ['/b', '/a']), block(['/a', '/b']));
  assert.equal(writeBlock('', ['/a']), block(['/a']));
  assert.equal(writeBlock('node_modules\n', ['/a']), `node_modules\n${block(['/a'])}`);
  // 끝 줄바꿈이 없는 파일은 줄을 나눠서 붙인다
  assert.equal(writeBlock('node_modules', ['/a']), `node_modules\n${block(['/a'])}`);
});

test('writeBlock 은 블록 밖을 바꾸지 않는다', () => {
  const before = '# 내 설정\nnode_modules\n\n';
  const after = '\n# 뒤\n*.log  \n';
  const text = `${before}${block(['/old'])}${after}`;
  assert.equal(writeBlock(text, ['/x', '/y']), `${before}${block(['/x', '/y'])}${after}`);
  // 빈 목록이면 블록만 지운다
  assert.equal(writeBlock(text, []), `${before}${after}`);
  // 블록이 없고 빈 목록이면 그대로
  assert.equal(writeBlock('a\n', []), 'a\n');
  assert.equal(writeBlock(null, []), '');
});

test('writeBlock 은 CRLF 파일에서 CRLF 로 쓰고 블록 밖은 그대로 둔다', () => {
  const text = 'a\r\n# START guideline generated files\r\n/old\r\n# END guideline generated files\r\nb\r\n';
  assert.equal(writeBlock(text, ['/n']), 'a\r\n# START guideline generated files\r\n/n\r\n# END guideline generated files\r\nb\r\n');
  assert.deepEqual(readBlock(text), ['/old']);
  assert.equal(writeBlock(text, []), 'a\r\nb\r\n');
});

test('readBlock 은 블록의 경로를 읽는다', () => {
  assert.deepEqual(readBlock(null), []);
  assert.deepEqual(readBlock('a\n'), []);
  assert.deepEqual(readBlock(`x\n${block(['/a', '', '/b'])}y\n`), ['/a', '/b']);
  // 끝 표시가 없으면 블록이 아니다
  assert.deepEqual(readBlock('# START guideline generated files\n/a\n'), []);
});

test('writeBlock·readBlock 은 gitignore 패턴 글자를 이스케이프해 왕복한다', () => {
  const paths = ['/.ruler/skills/s/a[1].png', '/.ruler/skills/s/b*?.md', '/.ruler/skills/s/c\\d.md', '/.ruler/skills/s/e '];
  const text = writeBlock(null, paths);
  assert.match(text, /a\\\[1\]\.png/);
  assert.match(text, /b\\\*\\\?\.md/);
  assert.match(text, /e\\ \n/);
  assert.deepEqual(readBlock(text), [...paths].sort());
});
