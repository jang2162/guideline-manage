import zlib from 'node:zlib';
import { memoryTree } from './tree.js';
import { t } from './i18n.js';

const BLOCK = 512;

export class TarError extends Error {}

/** NUL 앞까지의 UTF-8 문자열. */
function str(buf, start, len) {
  const s = buf.subarray(start, start + len);
  const nul = s.indexOf(0);
  return (nul === -1 ? s : s.subarray(0, nul)).toString('utf8');
}

const unsafe = p => p.startsWith('/') || p.split('/').some(s => s === '..');

/**
 * 서버의 `/api/v1/archive`(ustar + gzip)를 푼다. 보통 파일만 담고, 안전하지 않은 경로는 버린다.
 * @param {Buffer} gz
 * @returns {Map<string, Buffer>}
 */
export function untarGz(gz) {
  let buf;
  try {
    buf = zlib.gunzipSync(gz);
  } catch {
    throw new TarError(t('tar.bad'));
  }
  const files = new Map();
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every(b => b === 0)) break;
    const name = str(h, 0, 100);
    const size = Number.parseInt(str(h, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new TarError(t('tar.badSize'));
    const type = String.fromCharCode(h[156]);
    const prefix = str(h, 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    off += BLOCK;
    if (off + size > buf.length) throw new TarError(t('tar.truncated'));
    if ((type === '0' || type === '\0') && !unsafe(full)) files.set(full, Buffer.from(buf.subarray(off, off + size)));
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/**
 * @param {Buffer} gz
 * @returns {import('./tree.js').Tree}
 */
export function archiveTree(gz) {
  return memoryTree(Object.fromEntries(untarGz(gz)));
}
