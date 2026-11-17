import fs from 'node:fs';
import path from 'node:path';

/** 프로젝트 배치의 경로와 판정. 받은 지침은 .guideline/ 에 원본 모양으로, .ruler/ 의 지침 부분은 apply 가 조합한다. */

export const GUIDE_DIR = '.guideline';
export const PROJECT_TOML = '.ruler/ruler.project.toml';
export const RULER_TOML = '.ruler/ruler.toml';
export const BLOCK_START = '# START guideline generated files';
export const BLOCK_END = '# END guideline generated files';

const COPY_PREFIX = `${GUIDE_DIR}/`;
/** .guideline/ 아래에서 지침 id 의 사본이 아닌 자리. */
const NOT_COPY = ['overrides/', 'management/'];

/** 지침 id(`rules/base/00-a.md`) 의 프로젝트 사본 경로. */
export const copyPath = id => `${COPY_PREFIX}${id}`;

/** copyPath 의 역. 사본 경로가 아니면 null. */
export function idOfCopy(file) {
  if (!file.startsWith(COPY_PREFIX)) return null;
  const id = file.slice(COPY_PREFIX.length);
  return id === '' || NOT_COPY.some(p => id.startsWith(p)) ? null : id;
}

export const overridePath = (stack, file = 'override.md') => `${COPY_PREFIX}overrides/${stack}/${file}`;

export const managementCopy = source => `${COPY_PREFIX}management/${source}.md`;

/** ruler 설정 본문. ruler.project.toml 이 있으면 그것, 없으면 ruler.toml(이전 전 배치), 둘 다 없으면 null. */
export function rulerTomlText(project) {
  for (const rel of [PROJECT_TOML, RULER_TOML]) {
    const file = path.join(project, ...rel.split('/'));
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return null;
}

/** .ruler/ 바로 아래에 폴더(스택 사본)가 있는가. */
function hasRulerFolder(project) {
  try {
    return fs.readdirSync(path.join(project, '.ruler'), { withFileTypes: true }).some(e => e.isDirectory());
  } catch {
    return false;
  }
}

/**
 * 프로젝트가 어느 배치인가. 잠금 version 3 이면 guideline, 잠금 v1·v2 이면 ruler.
 * 잠금이 없으면 디스크를 본다: 매니페스트가 있고 .ruler/ 아래 폴더(스택 사본)가 있으면 잠금 도입 전(0.10 이전)의 ruler, 아니면 none.
 * @param {{ version: number } | null} lock
 * @returns {'guideline' | 'ruler' | 'none'}
 */
export function layoutOf(lock, project) {
  if (lock) return lock.version === 3 ? 'guideline' : 'ruler';
  return fs.existsSync(path.join(project, 'guideline.json')) && hasRulerFolder(project) ? 'ruler' : 'none';
}
