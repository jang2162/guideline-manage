import crypto from 'node:crypto';
import { isTextPath } from './store-paths.js';

/** 16진 sha256. 서버의 파일 해시와 같은 방식이다. */
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

/**
 * 텍스트 파일이면 CRLF 를 LF 로 맞춘다. 윈도에서 체크아웃한 사본을 「프로젝트에서 고침」 으로 보지 않게 한다.
 * @param {string} rel
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function normalized(rel, buf) {
  if (!buf.includes(0x0d)) return buf;
  if (!isTextPath(rel) && !looksText(buf)) return buf;
  const s = buf.toString('utf8');
  return s.includes('\r\n') ? Buffer.from(s.replace(/\r\n/g, '\n')) : buf;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 확장자를 모르는 파일(스킬의 .sh·.py 등)은 NUL 이 없고 UTF-8 로 읽히면 텍스트로 본다. */
function looksText(buf) {
  if (buf.includes(0)) return false;
  try {
    utf8.decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** 디렉터리를 통째로 다루는 항목(스킬, MCP)인가. */
export const isDirItem = id => id.startsWith('skills/') || id.startsWith('mcp/');

const hidden = rel => rel.split('/').some(s => s.startsWith('.'));

/**
 * 디렉터리 항목의 해시. 경로순으로 `경로\0해시\n` 을 이어 붙인 문자열의 sha256. 점으로 시작하는 이름은 뺀다.
 * @param {{ path: string, hash: string }[]} entries 디렉터리 기준 상대 경로
 */
export function dirHash(entries) {
  const lines = entries.filter(e => !hidden(e.path)).map(e => `${e.path}\0${e.hash}\n`).sort();
  return sha256(lines.join(''));
}

/**
 * 원본 항목 하나의 해시.
 * @param {Map<string, string>} hashes 저장 경로 → 파일 sha256
 * @param {string} id
 * @returns {string | null} 원본에 없으면 null
 */
export function itemHash(hashes, id) {
  if (!isDirItem(id)) return hashes.get(id) ?? null;
  const prefix = `${id}/`;
  const entries = [];
  for (const [p, h] of hashes) if (p.startsWith(prefix)) entries.push({ path: p.slice(prefix.length), hash: h });
  return entries.length ? dirHash(entries) : null;
}

/**
 * 트리의 모든 파일 해시.
 * @param {import('./tree.js').Tree} tree
 * @returns {Map<string, string>}
 */
export function treeHashes(tree) {
  const out = new Map();
  const walk = dir => {
    for (const e of tree.list(dir)) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.dir) walk(p);
      else out.set(p, sha256(tree.read(p)));
    }
  };
  walk('');
  return out;
}
