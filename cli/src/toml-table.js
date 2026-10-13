import { t } from './i18n.js';

// 의존성 없이 TOML 의 [표] 하나만 찾고 바꾼다. 파일의 나머지(다른 표, 주석, 서식)는 그대로 둔다.

const BARE = /^[A-Za-z0-9_-]+$/;
const HEADER = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/;
const ARRAY_HEADER = /^\s*\[\[([^[\]]+)\]\]/;
const KEY_LINE = /^\s*([A-Za-z0-9_\-."' ]+?)\s*=\s*(.*)$/;

export const tomlKey = k => (BARE.test(k) ? k : JSON.stringify(k));

/** 문자열·수·참거짓·배열·인라인 표. 문자열은 JSON 이스케이프(TOML 기본 문자열과 호환). */
export function tomlValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  if (v && typeof v === 'object') {
    const e = Object.entries(v).filter(([, x]) => x !== undefined);
    return e.length ? `{ ${e.map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x)}`).join(', ')} }` : '{}';
  }
  throw new TypeError(t('toml.badValue', { value: v }));
}

const headerOf = segs => segs.map(tomlKey).join('.');

/** `[a.b]` 와 키 줄들. 끝에 줄바꿈이 있다. */
export function tableText(segs, obj) {
  const lines = [`[${headerOf(segs)}]`];
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) lines.push(`${tomlKey(k)} = ${tomlValue(v)}`);
  return `${lines.join('\n')}\n`;
}

/** 점으로 나눈 키 경로. 따옴표 안의 점은 나누지 않는다. */
export function parseKeyPath(s) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') {
        cur += s[i + 1] ?? '';
        i++;
      } else if (c === q) q = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '.') {
      segs.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  segs.push(cur.trim());
  return segs;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function scan(text, segs) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let current = [];
  const starts = [];
  let inline = false;
  let sub = false;
  const under = path => path.length > segs.length && same(path.slice(0, segs.length), segs);
  lines.forEach((l, i) => {
    const a = ARRAY_HEADER.exec(l);
    if (a) {
      if (under(parseKeyPath(a[1]))) sub = true;
      current = null;
      return;
    }
    const h = HEADER.exec(l);
    if (h) {
      current = parseKeyPath(h[1]);
      if (same(current, segs)) starts.push(i);
      if (under(current)) sub = true;
      return;
    }
    const k = current && !l.trimStart().startsWith('#') ? KEY_LINE.exec(l) : null;
    if (k && same([...current, ...parseKeyPath(k[1])], segs) && k[2].trim().startsWith('{')) inline = true;
  });
  return { lines, starts, inline, sub };
}

/** start 의 표가 끝나는 줄. 다음 머리 줄 바로 앞의 빈 줄·주석은 다음 표의 몫이라 뺀다. */
function tableEnd(lines, start) {
  let j = start + 1;
  while (j < lines.length && !HEADER.test(lines[j]) && !ARRAY_HEADER.test(lines[j])) j++;
  const atHeader = j < lines.length;
  while (j - 1 > start && (lines[j - 1].trim() === '' || (atHeader && lines[j - 1].trimStart().startsWith('#')))) j--;
  return j;
}

/** 그 표의 지금 글자. 없거나, 둘 이상이거나, 인라인 표면 null. */
export function tableSlice(text, segs) {
  const { lines, starts, inline } = scan(text, segs);
  if (inline || starts.length !== 1) return null;
  return `${lines.slice(starts[0], tableEnd(lines, starts[0])).join('\n')}\n`;
}

/**
 * 표를 바꾸거나(있으면), 끝에 추가하거나(없으면), 지운다(null).
 * @returns {{ text: string } | { conflict: string }}
 */
export function setTable(text, segs, obj) {
  const { lines, starts, inline, sub } = scan(text, segs);
  if (inline) return { conflict: t('toml.inline', { table: headerOf(segs) }) };
  if (sub) return { conflict: t('toml.subtables', { table: headerOf(segs) }) };
  if (starts.length > 1) return { conflict: t('toml.duplicate', { table: headerOf(segs) }) };
  if (starts.length === 1) {
    const start = starts[0];
    const end = tableEnd(lines, start);
    if (obj === null) {
      let stop = end;
      while (stop < lines.length && lines[stop].trim() === '') stop++;
      lines.splice(start, stop - start);
    } else {
      lines.splice(start, end - start, ...tableText(segs, obj).trimEnd().split('\n'));
    }
    return { text: lines.join('\n') };
  }
  if (obj === null) return { text };
  const body = text.replace(/\s+$/, '');
  return { text: body ? `${body}\n\n${tableText(segs, obj)}` : tableText(segs, obj) };
}
