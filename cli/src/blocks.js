// 서버와 폼 화면이 함께 쓴다. 브라우저에서도 돌아야 하므로 아무것도 import 하지 않는다.

const ROOTS = ['rules', 'skills', 'mcp'];

/**
 * 항목·경로 id 의 블록 키. 블록이 아니면 null.
 * `rules/<스택>[/<하위 스택>…]` 는 `.md` 파일이면 그 디렉터리, 아니면 id 자체,
 * `skills/<이름>[/…]` → `skills/<이름>`, `mcp/<이름>[/…]` → `mcp/<이름>`, `agents/<이름>.md` 는 그대로.
 * @param {string} id
 * @returns {string | null}
 */
export function blockKey(id) {
  const parts = id.split('/');
  if (parts.length < 2 || !parts[1]) return null;
  const root = parts[0];
  if (root === 'rules') {
    const dir = parts[parts.length - 1].endsWith('.md') ? parts.slice(0, -1) : parts;
    return dir.length >= 2 && dir.every(Boolean) ? dir.join('/') : null;
  }
  if (ROOTS.includes(root)) return `${root}/${parts[1]}`;
  if (root === 'agents' && parts.length === 2 && parts[1].endsWith('.md')) return id;
  return null;
}

/** 문자열이 블록 키 자체인가. */
export function isBlockKey(s) {
  return blockKey(s) === s;
}

/** 부모 스택 키. 최상위 스택이거나 스택이 아니면 null. */
export function parentKey(key) {
  if (!key.startsWith('rules/')) return null;
  const parts = key.split('/');
  return parts.length > 2 ? parts.slice(0, -1).join('/') : null;
}

/** 조상 스택 키, 가까운 것부터. */
export function ancestorKeys(key) {
  const out = [];
  for (let p = parentKey(key); p; p = parentKey(p)) out.push(p);
  return out;
}

/** keys 에 조상을 더하고 중복 없이 정렬한다. */
export function withAncestors(keys) {
  return [...new Set(keys.flatMap(k => [k, ...ancestorKeys(k)]))].sort();
}

/** key 가 other 와 같거나 other 의 자손인가. */
export function isWithin(key, other) {
  return key === other || key.startsWith(`${other}/`);
}
