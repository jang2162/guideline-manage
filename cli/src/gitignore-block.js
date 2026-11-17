import { BLOCK_START, BLOCK_END } from './layout.js';

// .gitignore 안의 CLI 몫 블록. 블록 밖 바이트는 건드리지 않는다.

// gitignore 가 패턴으로 읽는 글자. 경로를 글자 그대로 무시하게 역슬래시로 감싼다.
const escape = p => p.replace(/[\\*?[]/g, c => `\\${c}`).replace(/ +$/, s => '\\ '.repeat(s.length));
const unescape = l => l.replace(/\\(.)/g, '$1');

/**
 * 온전한 블록들의 시작·끝 줄 번호. END 마다 그 앞의 가장 가까운(아직 짝 없는) START 와 짝짓는다.
 * 짝 없는 START·END 는 블록이 아니라 사용자 줄로 남긴다 — 끝 표시가 깨진 파일에 블록을 붙인 뒤에도
 * 고아 START 와 새 END 가 짝지어져 그 사이 사용자 줄을 블록으로 보는 일이 없게.
 */
function find(lines) {
  const out = [];
  let open = -1;
  lines.forEach((l, i) => {
    const s = l.replace(/\r$/, '');
    if (s === BLOCK_START) open = i;
    else if (s === BLOCK_END && open !== -1) {
      out.push({ start: open, end: i });
      open = -1;
    }
  });
  return out;
}

/**
 * 블록에 적힌 경로들(이스케이프를 푼 글자, 중복 없이). 블록이 없으면 [].
 * 블록이 여러 벌이면(병합 충돌 뒤 등) 모두 읽는다 — 모두 CLI 몫이라 writeBlock 이 하나로 합친다.
 * @param {string | null} text
 * @returns {string[]}
 */
export function readBlock(text) {
  if (text === null) return [];
  const lines = text.split('\n');
  const paths = find(lines).flatMap(b => lines.slice(b.start + 1, b.end).map(l => l.replace(/\r$/, '')).filter(l => l !== '').map(unescape));
  return [...new Set(paths)];
}

/**
 * 블록을 paths 로 바꾼 글자. 블록이 없으면 끝에 붙이고, 빈 목록이면 블록을 지운다. 경로는 정렬해 한 줄씩 쓴다.
 * 블록이 여러 벌이면 첫 블록 자리에 하나로 쓰고 나머지 블록을 지운다. 블록 밖 줄(짝 없는 표시 포함)은 그대로 둔다.
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
  const found = find(lines);
  if (!found.length) {
    if (!block) return src;
    return src === '' || src.endsWith('\n') ? src + block : `${src}${eol}${block}`;
  }
  // 블록 줄은 그 줄바꿈까지 블록 몫이다(끝 표시가 파일 끝이면 그 줄까지). 나머지 줄은 바이트 그대로 잇는다.
  const inBlock = new Map();
  for (const b of found) for (let i = b.start; i <= b.end; i++) inBlock.set(i, b);
  let out = '';
  lines.forEach((l, i) => {
    const b = inBlock.get(i);
    if (b) {
      if (b === found[0] && i === b.start) out += block;
      return;
    }
    out += i < lines.length - 1 ? `${l}\n` : l;
  });
  return out;
}
