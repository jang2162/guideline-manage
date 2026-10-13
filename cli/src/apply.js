import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

export class ApplyError extends Error {
  constructor(message, { written = [], deleted = [], remaining = [] } = {}) {
    super(message);
    this.written = written;
    this.deleted = deleted;
    this.remaining = remaining;
  }
}

/** 지운 뒤 비면 지우는 디렉터리. 그 밖의 디렉터리는 비어도 둔다. */
const CLEAN = [/^docs\/guideline(\/|$)/, /^\.ruler\/[^/]+(\/|$)/, /^\.(claude|agents|opencode)\/skills\/[^/]+(\/|$)/];

/** 프로젝트 루트 기준 상대 경로의 문제. 없으면 null. */
export function pathProblemIn(rel) {
  if (!rel || path.isAbsolute(rel) || rel.includes('\\') || rel.includes('\0')) return t('apply.badPath');
  if (rel.split('/').some(s => s === '' || s === '.' || s === '..')) return t('apply.badPath');
  return null;
}

const within = (root, real) => real === root || real.startsWith(root + path.sep);

/** rel 의 조상(과 그 자신)이 심볼릭 링크로 루트 밖을 가리키지 않는가. 아직 없는 조상은 만들 것이라 괜찮다. */
function insideRoot(root, rel) {
  let cur = root;
  for (const s of rel.split('/')) {
    cur = path.join(cur, s);
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return true;
    }
    if (st.isSymbolicLink() && !within(root, fs.realpathSync(cur))) return false;
  }
  return true;
}

/** 같은 디렉터리의 임시 파일에 쓰고 이름을 바꾼다. */
export function writeFileAtomic(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.guideline-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, abs);
}

function cleanEmptyDirs(root, rel) {
  let dir = path.posix.dirname(rel);
  while (dir !== '.' && CLEAN.some(re => re.test(dir))) {
    const abs = path.join(root, dir);
    try {
      if (fs.readdirSync(abs).length > 0) break;
      fs.rmdirSync(abs);
    } catch {
      break;
    }
    dir = path.posix.dirname(dir);
  }
}

/**
 * 렌더링 결과를 프로젝트에 쓴다. null 은 지운다. 경로를 모두 먼저 검사한다.
 * @param {string} project
 * @param {Record<string, Buffer | string | null>} files
 * @returns {{ written: string[], deleted: string[] }}
 */
export function applyFiles(project, files) {
  const root = fs.realpathSync(project);
  const entries = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [rel] of entries) {
    const problem = pathProblemIn(rel) ?? (insideRoot(root, rel) ? null : t('apply.symlinkOut'));
    if (problem) throw new ApplyError(`${rel}: ${problem}`, { remaining: entries.map(([r]) => r) });
  }
  const written = [];
  const deleted = [];
  for (let i = 0; i < entries.length; i++) {
    const [rel, content] = entries[i];
    const abs = path.join(root, rel);
    try {
      if (content === null) {
        if (fs.existsSync(abs)) {
          fs.rmSync(abs);
          deleted.push(rel);
          cleanEmptyDirs(root, rel);
        }
      } else {
        writeFileAtomic(abs, content);
        written.push(rel);
      }
    } catch (e) {
      throw new ApplyError(`${rel}: ${e.message}`, { written, deleted, remaining: entries.slice(i).map(([r]) => r) });
    }
  }
  return { written, deleted };
}
