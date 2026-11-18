import fs from 'node:fs';
import path from 'node:path';
import { readBlock, writeBlock } from './gitignore-block.js';
import { writeFileAtomic } from './apply.js';
import { MAIN_WORKTREE } from './personal.js';

// 개인 범위에서만 나오는 생성물은 커밋되는 .gitignore 가 아니라 git 공용 디렉터리의 info/exclude 에 적는다 — 작업자마다
// 다른 경로가 커밋되는 파일을 바꾸지 않게. 같은 클론의 워크트리가 이 파일을 함께 쓰므로 블록은 단위·워크트리마다 따로 둔다
// (브랜치마다 프로젝트 선택이 달라 개인 경로도 다르다 — 한 블록을 나눠 쓰면 서로 덮는다). 각 워크트리는 자기 블록만 읽고 쓴다.
// 패턴은 워크트리 루트 기준이라 다른 워크트리에도 걸리지만 그 경로의 추적되지 않은 파일을 숨길 뿐이다. 작업 트리 밖이라 applyFiles 를 거치지 않는다.

const PREFIX_START = '# START guideline personal files ';
const PREFIX_END = '# END guideline personal files ';

/** 블록 표시에 쓰는 단위 경로. 루트 단위는 `.`. */
const unitLabel = unitRel => (unitRel === '' ? '.' : unitRel);

/**
 * 단위·워크트리의 개인 블록 표시: `# START guideline personal files <단위 경로> @<워크트리 id>`.
 * @param {string} unitRel git 루트 기준 단위 경로(`/` 구분, 루트 단위는 '')
 * @param {string} worktree personal.js worktreeId(메인은 `.`)
 * @returns {{ start: string, end: string }}
 */
export function excludeMarkers(unitRel, worktree) {
  const tail = `${unitLabel(unitRel)} @${worktree}`;
  return { start: `${PREFIX_START}${tail}`, end: `${PREFIX_END}${tail}` };
}

/** 단위 기준 경로 → 워크트리 루트 기준 패턴(`/<단위 경로>/<파일>`, 루트 단위면 `/<파일>`). */
export function excludePattern(unitRel, p) {
  return unitRel === '' ? `/${p}` : `/${unitRel}/${p}`;
}

/** excludePattern 의 반대. 이 단위의 패턴이 아니면 null. */
export function unitPathOf(unitRel, pattern) {
  const prefix = excludePattern(unitRel, '');
  return pattern.startsWith(prefix) && pattern.length > prefix.length ? pattern.slice(prefix.length) : null;
}

const excludeFile = common => path.join(common, 'info', 'exclude');

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 살아 있는 워크트리 id: 메인과 `<공용>/worktrees/` 에 등록된 링크 워크트리(git worktree list 가 아는 것). */
function liveWorktrees(common) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(common, 'worktrees'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  } catch {
    names = [];
  }
  return new Set([MAIN_WORKTREE, ...names.map(n => encodeURIComponent(n))]);
}

/** 없어진 워크트리의 개인 블록을 지운 글자. 블록 표시는 `<단위> @<id>` 이고 id 에는 공백·`@` 가 없다. */
function pruneDead(text, common) {
  const live = liveWorktrees(common);
  let out = text;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.startsWith(PREFIX_START)) continue;
    const tail = line.slice(PREFIX_START.length);
    const at = tail.lastIndexOf(' @');
    if (at === -1 || live.has(tail.slice(at + 2))) continue;
    out = writeBlock(out, [], { start: line, end: `${PREFIX_END}${tail}` });
  }
  return out;
}

/**
 * 이 워크트리의 단위 블록에 지금 적힌 패턴들.
 * @param {{ common: string, unitRel: string, worktree: string }} opts
 * @returns {string[]}
 */
export function readExclude({ common, unitRel, worktree }) {
  return readBlock(readText(excludeFile(common)), excludeMarkers(unitRel, worktree));
}

/** 이 워크트리의 단위 블록이 paths 와 다른가(status 의 apply 할 일). */
export function excludeStale({ common, unitRel, worktree, paths }) {
  const cur = readText(excludeFile(common));
  return writeBlock(cur, paths, excludeMarkers(unitRel, worktree)) !== (cur ?? '');
}

/**
 * `<common>/info/exclude` 에서 이 워크트리의 단위 블록을 paths 로 바꾸고, 없어진 워크트리의 블록을 지운다(블록 밖 줄·다른 블록은 그대로).
 * 바뀔 때만 쓰고, info/ 가 없으면 만든다.
 * @param {{ common: string, unitRel: string, worktree: string, paths: string[] }} opts paths 는 워크트리 루트 기준 패턴
 * @returns {{ changed: boolean }}
 */
export function writeExclude({ common, unitRel, worktree, paths }) {
  const file = excludeFile(common);
  const cur = readText(file);
  const next = pruneDead(writeBlock(cur, paths, excludeMarkers(unitRel, worktree)), common);
  if (next === (cur ?? '')) return { changed: false };
  writeFileAtomic(file, next);
  return { changed: true };
}
