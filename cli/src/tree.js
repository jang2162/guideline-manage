import fs from 'node:fs';
import path from 'node:path';

/**
 * 저장소 루트 기준 상대 경로로 읽는 트리. 경로는 `/` 로 잇고 앞뒤에 `/` 를 붙이지 않는다. `''` 는 루트다.
 * 목록 해석 코드(catalog.js 등)가 디스크와 서버 DB 를 같은 코드로 읽으려고 둔다.
 * @typedef {object} Tree
 * @property {(dir: string) => { name: string, dir: boolean }[]} list 이름순. 없는 디렉터리는 []
 * @property {(file: string) => Buffer | null} read 없거나 디렉터리면 null
 * @property {(p: string) => boolean} exists 파일이나 디렉터리
 */

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const toBuffer = c => (Buffer.isBuffer(c) ? c : Buffer.from(c));

/** dir 아래 name 의 상대 경로. dir 이 '' 이면 name. */
export function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

/**
 * 파일을 UTF-8 로 읽는다.
 * @param {Tree} tree
 * @param {string} file
 * @returns {string | null} 없으면 null
 */
export function readText(tree, file) {
  const buf = tree.read(file);
  return buf === null ? null : buf.toString('utf8');
}

/**
 * 디스크 경로면 diskTree 로 감싸고, 트리면 그대로 둔다.
 * @param {string | Tree} src
 * @returns {Tree}
 */
export function asTree(src) {
  return typeof src === 'string' ? diskTree(src) : src;
}

/**
 * 디스크의 디렉터리를 트리로 읽는다.
 * @param {string} root
 * @returns {Tree}
 */
export function diskTree(root) {
  const abs = p => path.join(root, ...p.split('/').filter(Boolean));
  return {
    list(dir) {
      try {
        return fs.readdirSync(abs(dir), { withFileTypes: true })
          .map(d => ({ name: d.name, dir: d.isDirectory() }))
          .sort(byName);
      } catch {
        return [];
      }
    },
    read(file) {
      try {
        return fs.readFileSync(abs(file));
      } catch {
        return null;
      }
    },
    exists(p) {
      return fs.existsSync(abs(p));
    },
  };
}

/**
 * 파일 경로 목록과 읽기 함수로 만든 트리. 디렉터리는 파일 경로에서 나온다(빈 디렉터리는 없다).
 * 목록에 없는 경로는 read 를 부르지 않고 null 이다.
 * @param {string[]} paths
 * @param {(file: string) => Buffer | null} read
 * @returns {Tree}
 */
export function pathsTree(paths, read) {
  const files = new Set(paths);
  return {
    list(dir) {
      const prefix = dir ? `${dir}/` : '';
      const seen = new Map();
      for (const p of files) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!name) continue;
        seen.set(name, seen.get(name) || slash !== -1);
      }
      return [...seen].map(([name, isDir]) => ({ name, dir: isDir })).sort(byName);
    },
    read(file) {
      return files.has(file) ? read(file) : null;
    },
    exists(p) {
      if (p === '' || files.has(p)) return true;
      for (const f of files) if (f.startsWith(`${p}/`)) return true;
      return false;
    },
  };
}

/**
 * 경로 → 내용 표로 만든 트리.
 * @param {Record<string, Buffer | string>} files
 * @returns {Tree}
 */
export function memoryTree(files) {
  const map = new Map(Object.entries(files).map(([p, c]) => [p, toBuffer(c)]));
  return pathsTree([...map.keys()], p => map.get(p) ?? null);
}

/**
 * base 위에 바뀐 내용을 얹은 트리. null 은 삭제다. 파일이 하나도 남지 않은 디렉터리는 보이지 않는다.
 * 웹이 저장하기 전에 목록 경고를 미리 계산할 때 쓴다.
 * @param {Tree} base
 * @param {Record<string, Buffer | string | null>} changes
 * @returns {Tree}
 */
export function overlayTree(base, changes) {
  const map = new Map(Object.entries(changes).map(([p, c]) => [p, c === null ? null : toBuffer(c)]));
  const added = pathsTree([...map].filter(([, c]) => c !== null).map(([p]) => p), p => map.get(p) ?? null);
  const tree = {
    read(file) {
      return map.has(file) ? map.get(file) : base.read(file);
    },
    list(dir) {
      const seen = new Map();
      for (const e of base.list(dir)) {
        const p = joinPath(dir, e.name);
        const alive = e.dir ? tree.list(p).length > 0 : !(map.has(p) && map.get(p) === null);
        if (alive) seen.set(e.name, e.dir);
      }
      for (const e of added.list(dir)) seen.set(e.name, seen.get(e.name) || e.dir);
      return [...seen].map(([name, isDir]) => ({ name, dir: isDir })).sort(byName);
    },
    exists(p) {
      if (p === '') return true;
      return tree.read(p) !== null || tree.list(p).length > 0;
    },
  };
  return tree;
}
