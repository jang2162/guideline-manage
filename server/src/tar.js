import zlib from 'node:zlib';

const BLOCK = 512;

/** width 칸의 8진수 문자열. 마지막 칸은 NUL. */
const octal = (n, width) => `${n.toString(8).padStart(width - 1, '0')}\0`;

/** 경로를 ustar 의 name(100바이트)·prefix(155바이트)로 나눈다. 바이트는 UTF-8 기준. */
function splitName(p) {
  if (Buffer.byteLength(p) <= 100) return { name: p, prefix: '' };
  const parts = p.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    const name = parts.slice(i).join('/');
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
  }
  throw new Error(`path too long for tar: ${p}`);
}

function header(p, size, mtimeSecs) {
  const h = Buffer.alloc(BLOCK, 0);
  const { name, prefix } = splitName(p);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');
  h.write('0000000\0', 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtimeSecs, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${octal(sum, 7)} `, 148, 8, 'ascii');
  return h;
}

/**
 * 파일들을 ustar 형식으로 묶어 gzip 한다. 디렉터리 항목은 넣지 않는다(풀 때 만들어진다).
 * @param {{ path: string, content: Buffer }[]} files
 * @param {{ mtime?: Date }} [opts]
 * @returns {Buffer}
 */
export function tarGz(files, { mtime = new Date() } = {}) {
  const secs = Math.floor(mtime.getTime() / 1000);
  const blocks = [];
  for (const f of files) {
    blocks.push(header(f.path, f.content.length, secs), f.content);
    const pad = (BLOCK - (f.content.length % BLOCK)) % BLOCK;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return zlib.gzipSync(Buffer.concat(blocks));
}
