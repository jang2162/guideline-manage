import { t } from './i18n.js';

const splitLines = t => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));

/**
 * 줄 단위 LCS 로 편집 목록을 만든다. 지침 파일은 200줄 안쪽이라 O(n·m) 표로 충분하다.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{ op: ' ' | '-' | '+', line: string }[]}
 */
function edits(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: '-', line: a[i++] });
    } else {
      out.push({ op: '+', line: b[j++] });
    }
  }
  while (i < n) out.push({ op: '-', line: a[i++] });
  while (j < m) out.push({ op: '+', line: b[j++] });
  return out;
}

/**
 * 두 텍스트의 줄 단위 unified 차이. 줄바꿈 문자는 \n 으로 맞춘 뒤 비교한다.
 * @param {string} a 원본 쪽
 * @param {string} b 프로젝트 쪽
 * @param {{ aLabel?: string, bLabel?: string, context?: number }} [opts]
 * @returns {string} 같으면 ''
 */
export function unifiedDiff(a, b, { aLabel = t('diff.source'), bLabel = t('diff.project'), context = 3 } = {}) {
  const na = a.replace(/\r\n/g, '\n');
  const nb = b.replace(/\r\n/g, '\n');
  if (na === nb) return '';
  const header = [`--- ${aLabel}`, `+++ ${bLabel}`];
  const es = edits(splitLines(na), splitLines(nb));
  const changed = es.flatMap((e, k) => (e.op === ' ' ? [] : [k]));
  if (changed.length === 0) return [...header, t('diff.eolOnly')].join('\n');
  const hunks = [];
  for (const k of changed) {
    const start = Math.max(0, k - context);
    const end = Math.min(es.length, k + context + 1);
    const last = hunks.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }
  const lines = [...header];
  for (const h of hunks) {
    const before = es.slice(0, h.start);
    const slice = es.slice(h.start, h.end);
    const aStart = before.filter(e => e.op !== '+').length + 1;
    const bStart = before.filter(e => e.op !== '-').length + 1;
    const aCount = slice.filter(e => e.op !== '+').length;
    const bCount = slice.filter(e => e.op !== '-').length;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const e of slice) lines.push(`${e.op}${e.line}`);
  }
  return lines.join('\n');
}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 두 MCP 항목에서 다른 키 경로. 값은 담지 않는다 — 프로젝트 설정에 비밀값이 박혀 있을 수 있다.
 * 최상위 type 은 보지 않는다(ruler 가 채우거나 빼므로). 배열은 그 경로 통째로 비교한다.
 * @param {object} source server.json
 * @param {object} project 프로젝트 .mcp.json 의 항목
 * @returns {string[]} 경로순
 */
export function keyPathDiff(source, project) {
  const out = [];
  const walk = (a, b, prefix) => {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (prefix === '' && k === 'type') continue;
      const p = prefix ? `${prefix}.${k}` : k;
      if (!Object.hasOwn(b, k)) out.push(t('diff.onlySource', { path: p }));
      else if (!Object.hasOwn(a, k)) out.push(t('diff.onlyProject', { path: p }));
      else if (isObject(a[k]) && isObject(b[k])) walk(a[k], b[k], p);
      else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(t('diff.differs', { path: p }));
    }
  };
  walk(isObject(source) ? source : {}, isObject(project) ? project : {}, '');
  return out;
}

/** 줄 배열 둘의 편집 목록(LCS). 3-way merge 가 쓴다. */
export { edits as lineEdits };
