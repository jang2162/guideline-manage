import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCategories, readCategories } from '../src/categories.js';

const NOT_LIST = { warning: 'categories 가 [a, b] 꼴이 아님' };
const EMPTY_ITEM = { warning: 'categories 에 빈 항목이 있음' };

test('parseCategories 는 흐름 목록을 읽고 따옴표를 벗기고 중복을 하나로 친다', () => {
  assert.deepEqual(parseCategories('[backend, spring]'), { categories: ['backend', 'spring'] });
  assert.deepEqual(parseCategories('[ "a, b" , \'백엔드\' ]'), { categories: ['a, b', '백엔드'] });
  assert.deepEqual(parseCategories('[]'), { categories: [] });
  assert.deepEqual(parseCategories('[a, b, a]'), { categories: ['a', 'b'] });
  assert.deepEqual(parseCategories(undefined), { categories: [] });
});

test('parseCategories 는 형식이 틀리면 경고를 낸다', () => {
  assert.deepEqual(parseCategories('backend'), NOT_LIST);
  assert.deepEqual(parseCategories(''), NOT_LIST);
  assert.deepEqual(parseCategories('[a, , b]'), EMPTY_ITEM);
  assert.deepEqual(parseCategories('[a, ]'), EMPTY_ITEM);
  assert.deepEqual(parseCategories('[""]'), EMPTY_ITEM);
  assert.deepEqual(parseCategories('["a, b]'), { warning: 'categories 의 따옴표가 닫히지 않음' });
  assert.deepEqual(parseCategories('["a" x, b]'), NOT_LIST);
});

test('readCategories 는 frontmatter 의 한 줄 값을 읽고, 여러 줄 목록은 경고한다', () => {
  assert.deepEqual(readCategories('---\nload: always\ncategories: [공통]\n---\n\n# x\n'), { categories: ['공통'] });
  assert.deepEqual(readCategories('# frontmatter 없음\n'), { categories: [] });
  assert.deepEqual(readCategories('---\nload: always\n---\n'), { categories: [] });
  assert.deepEqual(readCategories('---\ncategories:\n  - a\n---\n'), NOT_LIST);
});
