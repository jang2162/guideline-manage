const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

/**
 * 줄마다 코드 펜스 줄이거나 펜스 안인가. CommonMark 처럼 여는 펜스의 문자와 길이를 기억해,
 * 같은 문자로 그 이상 길이인 줄로만 닫는다. 닫히지 않으면 끝까지 펜스 안이다.
 * @param {string[]} lines
 * @returns {boolean[]}
 */
export function fenceMask(lines) {
  let open = null;
  return lines.map(l => {
    if (open) {
      const m = /^\s*(`{3,}|~{3,})\s*$/.exec(l);
      if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
      return true;
    }
    const m = FENCE_OPEN.exec(l);
    if (m) open = m[1];
    return Boolean(m);
  });
}
const HEADING = /^(#{1,6}) (.*)$/;

/** CRLF 를 LF 로 맞춰 줄로 나눈다. */
export function toLines(text) {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/** 코드 블록 밖의 줄. 울타리 줄 자체도 뺀다. */
export function outsideFences(lines) {
  const mask = fenceMask(lines);
  return lines.filter((l, i) => !mask[i]);
}

/**
 * 코드 블록 밖의 제목 줄. title 은 뒤 공백만 뗀다.
 * @param {string[]} lines
 * @returns {{ index: number, level: number, title: string }[]}
 */
export function headingLines(lines) {
  const result = [];
  const mask = fenceMask(lines);
  lines.forEach((l, index) => {
    if (mask[index]) return;
    const m = HEADING.exec(l);
    if (m) result.push({ index, level: m[1].length, title: m[2].trimEnd() });
  });
  return result;
}

/**
 * 코드 블록 밖의 `## ` 절 제목. 뒤 공백만 뗀다.
 * @param {string} text
 * @returns {Set<string>}
 */
export function headings(text) {
  return new Set(headingLines(toLines(text)).filter(h => h.level === 2).map(h => h.title));
}

function trimBlank(lines) {
  let s = 0;
  let e = lines.length;
  while (s < e && lines[s].trim() === '') s++;
  while (e > s && lines[e - 1].trim() === '') e--;
  return lines.slice(s, e);
}

/** hs[i] 제목 아래 본문: 다음 줄부터 같거나 높은 수준의 다음 제목 앞까지, 앞뒤 빈 줄을 뗀다. */
function bodyAt(lines, hs, i) {
  const h = hs[i];
  const next = hs.slice(i + 1).find(x => x.level <= h.level);
  return trimBlank(lines.slice(h.index + 1, next ? next.index : lines.length)).join('\n');
}

/**
 * 제목이 title 인 첫 절의 본문. 제목 수준은 가리지 않는다.
 * @param {string} text
 * @param {string} title
 * @returns {string | null} 그런 제목이 없으면 null
 */
export function sectionBody(text, title) {
  const lines = toLines(text);
  const hs = headingLines(lines);
  const i = hs.findIndex(h => h.title === title);
  return i === -1 ? null : bodyAt(lines, hs, i);
}

/**
 * 한 수준의 절마다 제목과 본문.
 * @param {string} text
 * @param {number} level
 * @returns {{ title: string, body: string }[]}
 */
export function sectionsAt(text, level) {
  const lines = toLines(text);
  const hs = headingLines(lines);
  return hs.flatMap((h, i) => (h.level === level ? [{ title: h.title, body: bodyAt(lines, hs, i) }] : []));
}
