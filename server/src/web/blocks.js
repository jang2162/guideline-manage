// 블록(스택·스킬·서브에이전트·MCP)과 화면 주소. 저장 경로를 화면 주소로 바꾸는 일은 모두 여기서 한다.
// 카탈로그가 인정하는 블록 안의 경로는 블록 상세로, docs/ 문서는 문서 화면으로 간다. 그 밖은 화면이 없다(웹은 이 서비스로 만든 것만 다룬다).
import { hrefFor } from './layout.js';
import { DOC_PATH } from '../../../cli/src/store-paths.js';

/** 웹에서 이름 바꾸기·삭제를 막는 문서. 작성 규칙과 프로젝트 관리 지침에 덧붙는 문서라 에이전트도 읽는다. */
export const PROTECTED_DOCS = ['docs/authoring.md', 'docs/management.md'];

/** 문서 화면 주소. */
export function docHref(p) {
  return `/docs/${encodeURIComponent(p.slice('docs/'.length))}`;
}

export const KINDS = ['stack', 'skill', 'agent', 'mcp'];
export const PREFIX = { stack: '/s/', skill: '/skills/', agent: '/agents/', mcp: '/mcp/' };
export const DIR = { stack: 'rules', skill: 'skills', agent: 'agents', mcp: 'mcp' };
/** 블록 종류 → 상단 탭 키와 목록 주소. */
export const TAB = { stack: 'stacks', skill: 'skills', agent: 'agents', mcp: 'mcp' };
export const LIST_HREF = { stack: '/', skill: '/skills', agent: '/agents', mcp: '/mcp' };

/** 카탈로그 요약에서 종류별 블록 이름. */
export function namesOf(summary, kind) {
  if (kind === 'stack') return summary.stacks.map(s => s.name);
  if (kind === 'skill') return summary.skills;
  if (kind === 'agent') return summary.subagents;
  return summary.mcp.map(m => m.name);
}

/**
 * 저장 경로가 속한 블록. 카탈로그에 없는 블록(뼈대 스택, 목록에서 빠진 항목)이면 null.
 * @param {string} p
 * @param {ReturnType<typeof import('../../../cli/src/summary.js').catalogSummary>} summary
 * @returns {{ kind: string, name: string, rel: string } | null}
 */
export function blockOf(p, summary) {
  const segs = p.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  if (segs[0] === 'agents') {
    if (segs.length !== 2 || !segs[1].endsWith('.md')) return null;
    const name = segs[1].slice(0, -'.md'.length);
    return summary.subagents.includes(name) ? { kind: 'agent', name, rel: '' } : null;
  }
  const kind = KINDS.find(k => k !== 'agent' && DIR[k] === segs[0]);
  if (!kind || !namesOf(summary, kind).includes(segs[1])) return null;
  return { kind, name: segs[1], rel: segs.slice(2).join('/') };
}

/** 블록의 저장 디렉터리. 서브에이전트는 파일 하나라 agents 다. */
export function blockDir(kind, name) {
  return kind === 'agent' ? DIR.agent : `${DIR[kind]}/${name}`;
}

/** 블록 설정 페이지 주소. 블록 안 파일 주소(/s/<이름>/<파일>)와 겹치지 않게 /settings/<종류>/<이름> 이다. */
export function settingsHref(kind, name) {
  return `/settings/${kind}/${encodeURIComponent(name)}`;
}

/** 블록의 frontmatter(표시 이름·분류)를 두는 파일. */
export function metaFile(kind, name) {
  return { stack: `rules/${name}/README.md`, skill: `skills/${name}/SKILL.md`, agent: `agents/${name}.md`, mcp: `mcp/${name}/README.md` }[kind];
}

const KIND_OF_DIR = { rules: 'stack', skills: 'skill', agents: 'agent', mcp: 'mcp' };

/** 블록 키(rules/<스택>, skills/<이름>, agents/<이름>.md, mcp/<이름>) → { kind, name }. 블록 키가 아니면 null. */
export function blockOfKey(key) {
  const i = key.indexOf('/');
  const kind = KIND_OF_DIR[key.slice(0, i)];
  if (!kind || i < 0) return null;
  const rest = key.slice(i + 1);
  if (kind === 'agent') return rest.endsWith('.md') && !rest.includes('/') ? { kind, name: rest.slice(0, -'.md'.length) } : null;
  return rest && !rest.includes('/') ? { kind, name: rest } : null;
}

/** { kind, name } → 블록 키. */
export function keyOfBlock(kind, name) {
  return kind === 'agent' ? `agents/${name}.md` : `${DIR[kind]}/${name}`;
}

/** 블록 상세 주소. rel 은 블록 안 파일(서브에이전트는 무시한다). */
export function blockHref(kind, name, rel = '') {
  const base = hrefFor(PREFIX[kind], name);
  return rel && kind !== 'agent' ? `${base}/${rel.split('/').map(encodeURIComponent).join('/')}` : base;
}

/**
 * 저장 경로의 화면 주소: 블록 안이면 블록 상세, docs/ 이면 문서 화면, 그 밖은 null.
 * isFile 을 주면 파일이 아닌 경로(디렉터리, 지운 파일)는 블록 첫 화면이나 문서 목록으로 보낸다. 상세는 파일 주소만 열기 때문이다.
 * @param {(p: string) => boolean} [isFile]
 * @returns {string | null}
 */
export function viewHref(p, summary, isFile) {
  const b = blockOf(p, summary);
  const file = !isFile || isFile(p);
  if (b) return blockHref(b.kind, b.name, file ? b.rel : '');
  if (p === 'docs' || DOC_PATH.test(p)) return file && DOC_PATH.test(p) ? docHref(p) : '/docs';
  return null;
}

/**
 * 블록 디렉터리 아래 모든 파일의 블록 안 경로(하위 디렉터리 포함, 이름순). 서브에이전트는 빈 배열.
 * @param {{ headHashes: () => Map<string, string> }} store
 */
export function blockFiles(store, kind, name) {
  if (kind === 'agent') return [];
  const prefix = `${blockDir(kind, name)}/`;
  return [...store.headHashes().keys()]
    .filter(p => p.startsWith(prefix))
    .map(p => p.slice(prefix.length))
    .filter(rel => !rel.split('/').some(seg => seg.startsWith('.')))
    .sort();
}
