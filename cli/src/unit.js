import fs from 'node:fs';
import path from 'node:path';
import { gitRoot, runGit } from './projects.js';
import { readManifest } from './manifest.js';
import { rulerTomlText, PROJECT_TOML, RULER_TOML } from './layout.js';
import { unitOf, unitName, finalUnit } from './sources.js';
import { t } from './i18n.js';

export const NOT_RULER = dir => t('unit.notRuler', { dir });
export const INSTRUCTIONS_GONE = () => t('unit.instructionsForm');

/**
 * 단위 디렉터리와 그 git 루트. git 저장소가 아니면 루트는 단위 자신이다.
 * @param {string} dir
 * @returns {{ dir: string, root: string, nested: boolean }}
 */
export function unitInfo(dir, git = runGit) {
  const real = fs.realpathSync(dir);
  const root = gitRoot(dir, git) ?? real;
  return { dir, root, nested: root !== real };
}

/** 프로젝트 쪽 명령을 할 수 없는 이유. 없으면 null. */
export function unitProblem(dir, manifest) {
  if (manifest && manifest.form !== 'ruler') return INSTRUCTIONS_GONE();
  if (!fs.existsSync(path.join(dir, '.ruler'))) return NOT_RULER(dir);
  return null;
}

/** git 루트의 ruler 설정(.ruler/ruler.project.toml, 없으면 ruler.toml)에 nested = true 가 있는가. */
export function rootNestedOn(root) {
  return /^\s*nested\s*=\s*true\s*(?:#.*)?$/m.test(rulerTomlText(root) ?? '');
}

/** nested = true 를 켤 자리: 루트에 ruler.toml 만 있으면(이전 전 배치) 그것, 아니면 ruler.project.toml. */
export const nestedOffTodo = root => ({
  kind: 'nested-off', item: null,
  message: t('todo.nestedOff', {
    root,
    file: !fs.existsSync(path.join(root, ...PROJECT_TOML.split('/'))) && fs.existsSync(path.join(root, ...RULER_TOML.split('/'))) ? RULER_TOML : PROJECT_TOML,
  }),
});

/** git 루트 단위가 받은 스택(별칭을 입힌 경로, 하위 스택은 `web/neo`). 중첩 단위의 폼에서 「루트에 이미 있음」 을 보일 때 쓴다. */
export function rootStacks(root) {
  let m = null;
  try {
    m = readManifest(root);
  } catch {
    return [];
  }
  if (!m) return [];
  const stacks = Object.values(m.sources).flatMap(src => src.items.map(i => {
    const u = unitOf(i);
    return u?.startsWith('rules/') ? unitName(finalUnit(u, src.aliases)) : null;
  }));
  return [...new Set(stacks.filter(Boolean))].sort();
}
