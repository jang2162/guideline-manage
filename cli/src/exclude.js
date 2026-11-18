import fs from 'node:fs';
import path from 'node:path';
import { readBlock, writeBlock } from './gitignore-block.js';
import { writeFileAtomic } from './apply.js';

// 개인 범위에서만 나오는 생성물은 커밋되는 .gitignore 가 아니라 git 공용 디렉터리의 info/exclude 에 적는다 — 작업자마다
// 다른 경로가 커밋되는 파일을 바꾸지 않게. 같은 클론의 워크트리가 이 파일을 함께 쓰므로 패턴은 워크트리 루트 기준이고,
// 단위마다 따로 블록을 둔다. 작업 트리 밖이라 applyFiles 를 거치지 않는다.

/** 블록 표시에 쓰는 단위 경로. 루트 단위는 `.`. */
const unitLabel = unitRel => (unitRel === '' ? '.' : unitRel);

/**
 * 단위의 개인 블록 표시.
 * @param {string} unitRel git 루트 기준 단위 경로(`/` 구분, 루트 단위는 '')
 * @returns {{ start: string, end: string }}
 */
export function excludeMarkers(unitRel) {
  return { start: `# START guideline personal files ${unitLabel(unitRel)}`, end: `# END guideline personal files ${unitLabel(unitRel)}` };
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

/**
 * 단위 블록에 지금 적힌 패턴들.
 * @param {{ common: string, unitRel: string }} opts
 * @returns {string[]}
 */
export function readExclude({ common, unitRel }) {
  return readBlock(readText(excludeFile(common)), excludeMarkers(unitRel));
}

/** writeExclude 가 쓸 것이 있는가(블록이 paths 와 다른가). */
export function excludeStale({ common, unitRel, paths }) {
  const cur = readText(excludeFile(common));
  return writeBlock(cur, paths, excludeMarkers(unitRel)) !== (cur ?? '');
}

/**
 * `<common>/info/exclude` 의 단위 블록을 paths 로 바꿔 쓴다(블록 밖 줄·다른 단위 블록은 그대로). 바뀔 때만 쓰고, info/ 가 없으면 만든다.
 * @param {{ common: string, unitRel: string, paths: string[] }} opts paths 는 워크트리 루트 기준 패턴
 * @returns {{ changed: boolean }}
 */
export function writeExclude({ common, unitRel, paths }) {
  const file = excludeFile(common);
  const cur = readText(file);
  const next = writeBlock(cur, paths, excludeMarkers(unitRel));
  if (next === (cur ?? '')) return { changed: false };
  writeFileAtomic(file, next);
  return { changed: true };
}
