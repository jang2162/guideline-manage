const KEY_LINE = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/;

/** 따옴표 없이 쓰면 YAML 이 문자열로 읽지 않거나 오류를 내는 첫 글자. */
const PLAIN_START_BAD = /^[`@*!%#&[{]/;

/**
 * --- 로 둘러싼 frontmatter 의 최상위 `key: value` 줄을 읽어 값을 쓰인 그대로(앞뒤 공백만 뗀다) 돌려준다.
 * 여는 줄은 ruler 처럼 정확히 `---` 여야 한다(BOM·뒤 공백 불가).
 * 들여쓴 줄(YAML 목록 등)은 건너뛰므로 목록 값은 빈 문자열로 남는다. YAML 전체를 해석하지 않는다.
 * @param {string} text
 * @returns {Record<string, string> | null} frontmatter 가 없거나 닫히지 않으면 null
 */
export function frontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end === -1) return null;
  const fm = {};
  for (const line of lines.slice(1, end)) {
    const m = KEY_LINE.exec(line);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

/**
 * frontmatter 의 한 줄짜리 값을 YAML 이 읽을 문자열로 바꾼다. 따옴표를 벗기고 ` #` 뒤 주석을 뗀다.
 * YAML 이 문자열로 읽지 못할 값(따옴표 없는 `: `, 닫히지 않은 따옴표, 특수 문자로 시작)이면 null.
 * @param {string} raw
 * @returns {string | null}
 */
export function yamlString(raw) {
  const q = raw[0];
  if (q === '"' || q === "'") return raw.length >= 2 && raw.at(-1) === q ? raw.slice(1, -1) : null;
  if (PLAIN_START_BAD.test(raw)) return null;
  const value = raw.replace(/\s+#.*$/, '');
  return value.includes(': ') ? null : value;
}
