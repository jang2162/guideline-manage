import { BLOCK_START, BLOCK_END } from './layout.js';

// .gitignore 안의 CLI 몫 블록. 블록 밖 바이트는 건드리지 않는다.

// gitignore 가 패턴으로 읽는 글자. 경로를 글자 그대로 무시하게 역슬래시로 감싼다.
const escape = p => p.replace(/[\\*?[]/g, c => `\\${c}`).replace(/ +$/, s => '\\ '.repeat(s.length));
const unescape = l => l.replace(/\\(.)/g, '$1');

/** 블록의 시작·끝 줄 번호. 끝 표시가 없으면 블록이 아니다(그 아래 사용자 줄을 지우지 않게). */
function find(lines) {
  const start = lines.findIndex(l => l.replace(/\r$/, '') === BLOCK_START);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.replace(/\r$/, '') === BLOCK_END);
  return end === -1 ? null : { start, end };
}

/**
 * 블록에 적힌 경로들(이스케이프를 푼 글자). 블록이 없으면 [].
 * @param {string | null} text
 * @returns {string[]}
 */
export function readBlock(text) {
  if (text === null) return [];
  const lines = text.split('\n');
  const b = find(lines);
  if (!b) return [];
  return lines.slice(b.start + 1, b.end).map(l => l.replace(/\r$/, '')).filter(l => l !== '').map(unescape);
}

/**
 * 블록을 paths 로 바꾼 글자. 블록이 없으면 끝에 붙이고, 빈 목록이면 블록을 지운다. 경로는 정렬해 한 줄씩 쓴다.
 * 파일이 CRLF 면 블록도 CRLF 로 쓴다.
 * @param {string | null} text
 * @param {string[]} paths
 * @returns {string}
 */
export function writeBlock(text, paths) {
  const src = text ?? '';
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const sorted = [...new Set(paths)].sort();
  const block = sorted.length ? [BLOCK_START, ...sorted.map(escape), BLOCK_END].map(l => `${l}${eol}`).join('') : '';
  const lines = src.split('\n');
  const b = find(lines);
  if (!b) {
    if (!block) return src;
    return src === '' || src.endsWith('\n') ? src + block : `${src}${eol}${block}`;
  }
  // 끝 표시 줄의 줄바꿈까지가 블록이다. 끝 표시가 파일 끝(줄바꿈 없음)이면 그 줄까지.
  const before = lines.slice(0, b.start).map(l => `${l}\n`).join('');
  const afterLines = lines.slice(b.end + 1);
  const after = afterLines.join('\n');
  return before + block + after;
}
