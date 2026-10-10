import { t } from './i18n.js';

// 서버에 저장하는 경로와 내용의 규칙. 서버의 쓰기와 CLI 의 가져오기가 같이 쓴다.

export const MAX_FILE_BYTES = 1024 * 1024;
export const TEXT_EXTENSIONS = ['.md', '.json', '.toml', '.yaml', '.yml', '.txt'];

const ROOTS = ['rules/', 'skills/', 'agents/', 'mcp/'];
const EXACT = ['docs/authoring.md', 'docs/management.md'];
const ROOTS_MESSAGE = () => t('paths.badRoot');
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 확장자가 텍스트로 다루는 것인가. 대소문자는 가리지 않는다. */
export function isTextPath(p) {
  const dot = p.lastIndexOf('.');
  const slash = p.lastIndexOf('/');
  return dot > slash && TEXT_EXTENSIONS.includes(p.slice(dot).toLowerCase());
}

/** 최상위 규칙만 본다. 가져오기가 저장소의 다른 파일(package.json 등)을 조용히 건너뛸 때 쓴다. */
export function inStoreRoots(p) {
  return EXACT.includes(p) || ROOTS.some(r => p.startsWith(r));
}

/**
 * 저장 경로의 첫 문제.
 * @param {string} p
 * @returns {string | null}
 */
export function pathProblem(p) {
  if (typeof p !== 'string' || p === '') return t('paths.empty');
  if (p.startsWith('/')) return t('paths.absolute');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return t('paths.badChar');
  const parts = p.split('/');
  if (parts.some(s => s === '')) return t('paths.emptySegment');
  if (parts.some(s => s === '.' || s === '..')) return t('paths.dots');
  if (parts.some(s => s.startsWith('.'))) return t('paths.hidden');
  if (!inStoreRoots(p)) return ROOTS_MESSAGE();
  return null;
}

/**
 * 내용의 첫 문제.
 * @param {string} p
 * @param {Buffer} content
 * @returns {string | null}
 */
export function contentProblem(p, content) {
  if (content.length > MAX_FILE_BYTES) return t('paths.tooBig');
  if (isTextPath(p)) {
    try {
      utf8.decode(content);
    } catch {
      return t('paths.notUtf8');
    }
  }
  return null;
}

/**
 * 쓰기 하나를 검사한다. changes 를 반영한 뒤의 경로 집합으로 파일·디렉터리 충돌을 본다.
 * @param {Record<string, Buffer | null>} changes 경로 → 새 내용(null 은 삭제). 경로는 이미 NFC 다
 * @param {Iterable<string>} existing 지금 있는 파일 경로
 * @returns {{ path: string, message: string }[]}
 */
export function writeProblems(changes, existing) {
  const out = [];
  for (const [p, c] of Object.entries(changes)) {
    const pp = pathProblem(p);
    if (pp) {
      out.push({ path: p, message: pp });
      continue;
    }
    if (c !== null) {
      const cp = contentProblem(p, c);
      if (cp) out.push({ path: p, message: cp });
    }
  }
  if (out.length > 0) return out;

  const after = new Set(existing);
  for (const [p, c] of Object.entries(changes)) {
    if (c === null) after.delete(p);
    else after.add(p);
  }
  for (const [p, c] of Object.entries(changes)) {
    if (c === null) continue;
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      if (after.has(prefix)) out.push({ path: p, message: t('paths.parentIsFile', { path: prefix }) });
    }
    for (const q of after) {
      if (q.startsWith(`${p}/`)) {
        out.push({ path: p, message: t('paths.isDir', { path: p }) });
        break;
      }
    }
  }
  return out;
}
