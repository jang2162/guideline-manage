import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLines, headingLines, headings, sectionBody, sectionsAt } from '../src/sections.js';

test('headingLines 는 코드 블록 밖 제목의 줄 번호·수준·제목을 돌려준다', () => {
  const lines = toLines('# a\r\n\r\n```\r\n## 코드 안\r\n```\r\n## b  \r\n### c\r\n');
  assert.deepEqual(headingLines(lines), [
    { index: 0, level: 1, title: 'a' },
    { index: 5, level: 2, title: 'b' },
    { index: 6, level: 3, title: 'c' },
  ]);
});

test('headings 는 코드 블록 밖의 ## 제목만 모은다', () => {
  assert.deepEqual([...headings('## a\n```\n## b\n```\n### c\n## d \n')], ['a', 'd']);
});

test('sectionBody 는 수준과 관계없이 제목을 찾고, 같거나 높은 수준의 다음 제목 앞까지 앞뒤 빈 줄을 떼고 돌려준다', () => {
  const text = '# t\n\n### 절\n\n본문\n\n#### 하위\n\n하위 본문\n\n### 다음\n\n끝\n';
  assert.equal(sectionBody(text, '절'), '본문\n\n#### 하위\n\n하위 본문');
  assert.equal(sectionBody(text, '다음'), '끝');
  assert.equal(sectionBody(text, '없음'), null);
});

test('sectionsAt 은 한 수준의 절마다 제목과 본문을 돌려준다', () => {
  assert.deepEqual(sectionsAt('# x\n\n## a\n\nA\n\n### a1\n\n## b\n\nB\n', 2), [
    { title: 'a', body: 'A\n\n### a1' },
    { title: 'b', body: 'B' },
  ]);
});

test('펜스는 여는 문자·길이로 닫힌다: 섞이거나 긴 펜스 안의 제목은 보지 않는다', () => {
  const lines = toLines(['# P', '````md', '```', '## 안1', '```', '````', '```text', '~~~', '## 안2', '~~~', '```', '## 밖'].join('\n'));
  assert.deepEqual(headingLines(lines).map(h => h.title), ['P', '밖']);
});
