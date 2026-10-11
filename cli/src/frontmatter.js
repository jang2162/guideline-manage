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

/** 따옴표 없이 쓰면 다르게 읽히는 값: 앞뒤 공백, 따옴표·특수 문자로 시작, `: `, ` #`. */
const NEEDS_QUOTES = v => v !== v.trim() || /^['"]/.test(v) || PLAIN_START_BAD.test(v) || v.includes(': ') || / #/.test(v) || v.endsWith(':');

/** 값을 한 줄 YAML 문자열로. 필요할 때만 큰따옴표로 감싸고 `\` 와 `"` 를 이스케이프한다. */
function quoteValue(v) {
  return NEEDS_QUOTES(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}

/**
 * frontmatter 의 한 줄 값을 읽는다. 큰따옴표는 `\"`·`\\` 를, 작은따옴표는 `''` 를 푼다. 따옴표가 없으면 yamlString 과 같다.
 * @param {string} raw
 * @returns {string | null}
 */
export function readQuoted(raw) {
  const q = raw[0];
  if (q === '"' && raw.length >= 2 && raw.at(-1) === '"') return raw.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (q === "'" && raw.length >= 2 && raw.at(-1) === "'") return raw.slice(1, -1).replace(/''/g, "'");
  return yamlString(raw);
}

/**
 * 분류 목록을 frontmatter 한 줄 값 `[a, b]` 로. `,`·`]`·`[`·따옴표가 있거나 quoteValue 가 감쌀 항목만 큰따옴표로 감싼다.
 * @param {string[]} items
 */
export function categoriesValue(items) {
  return `[${items.map(i => (/[,[\]'"]/.test(i) || NEEDS_QUOTES(i) ? `"${i.replace(/"/g, '\\"')}"` : i)).join(', ')}]`;
}

/**
 * frontmatter 의 최상위 키 하나를 바꾸거나 더하거나(끝에) 지운다. 값이 null·빈 문자열이면 줄을 지운다.
 * frontmatter 가 없으면 만든다(지울 때는 그대로). 값은 quoteValue 로 쓴다. 분류처럼 이미 YAML 인 값은 raw 로 준다.
 * @param {string} text
 * @param {string} key
 * @param {string | null} value
 * @param {{ raw?: boolean }} [opts]
 */
export function setFrontmatterValue(text, key, value, { raw = false } = {}) {
  const line = value ? `${key}: ${raw ? value : quoteValue(value)}` : null;
  const lines = text.split('\n');
  const end = lines[0] === '---' ? lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---') : -1;
  if (end === -1) return line ? `---\n${line}\n---\n\n${text}` : text;
  const at = lines.slice(1, end).findIndex(l => KEY_LINE.exec(l)?.[1] === key) + 1;
  if (at > 0) {
    if (line) lines[at] = line;
    else lines.splice(at, 1);
  } else if (line) {
    lines.splice(end, 0, line);
  }
  return lines.join('\n');
}
