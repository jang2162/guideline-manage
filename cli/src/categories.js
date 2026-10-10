import { frontmatter } from './frontmatter.js';
import { t } from './i18n.js';

const NOT_LIST = () => t('categories.notList');
const EMPTY_ITEM = () => t('categories.emptyItem');
const OPEN_QUOTE = () => t('categories.openQuote');

/**
 * `[a, "b c", 'd']` 의 안쪽을 항목으로 나눈다.
 * @param {string} inner 대괄호 안(앞뒤 공백을 뗀 것)
 * @returns {string[] | string} 항목들, 문제가 있으면 경고 문구
 */
function splitItems(inner) {
  const items = [];
  let i = 0;
  const skipSpace = () => {
    while (inner[i] === ' ' || inner[i] === '\t') i++;
  };
  for (;;) {
    skipSpace();
    const q = inner[i];
    let item;
    if (q === '"' || q === "'") {
      const end = inner.indexOf(q, i + 1);
      if (end === -1) return OPEN_QUOTE();
      item = inner.slice(i + 1, end);
      i = end + 1;
      skipSpace();
      if (i < inner.length && inner[i] !== ',') return NOT_LIST();
    } else {
      const comma = inner.indexOf(',', i);
      const end = comma === -1 ? inner.length : comma;
      item = inner.slice(i, end).trim();
      i = end;
    }
    if (item === '') return EMPTY_ITEM();
    items.push(item);
    if (i >= inner.length) return items;
    i++; // ,
  }
}

/**
 * frontmatter 의 categories 값(한 줄)을 읽는다. 키가 없으면 분류 없음.
 * @param {string | undefined} raw frontmatter() 가 돌려준 값
 * @returns {{ categories: string[] } | { warning: string }}
 */
export function parseCategories(raw) {
  if (raw === undefined) return { categories: [] };
  const v = raw.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) return { warning: NOT_LIST() };
  const inner = v.slice(1, -1).trim();
  if (inner === '') return { categories: [] };
  const items = splitItems(inner);
  if (typeof items === 'string') return { warning: items };
  return { categories: [...new Set(items)] };
}

/**
 * 파일 내용의 frontmatter 에서 categories 를 읽는다. frontmatter 가 없으면 분류 없음.
 * 여러 줄 목록은 frontmatter() 가 빈 문자열로 돌려주므로 「[a, b] 꼴이 아님」 경고가 된다.
 * @param {string} text
 * @returns {{ categories: string[] } | { warning: string }}
 */
export function readCategories(text) {
  return parseCategories(frontmatter(text)?.categories);
}
