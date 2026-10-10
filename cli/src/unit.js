import fs from 'node:fs';
import path from 'node:path';
import { gitRoot, runGit } from './projects.js';
import { readManifest } from './manifest.js';
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

/** git 루트의 .ruler/ruler.toml 에 nested = true 가 있는가. */
export function rootNestedOn(root) {
  const f = path.join(root, '.ruler', 'ruler.toml');
  return fs.existsSync(f) && /^\s*nested\s*=\s*true\s*(?:#.*)?$/m.test(fs.readFileSync(f, 'utf8'));
}

export const nestedOffTodo = root => ({
  kind: 'nested-off', item: null,
  message: t('todo.nestedOff', { root }),
});

/** git 루트 단위가 받은 스택. 중첩 단위의 폼에서 「루트에 이미 있음」 을 보일 때 쓴다. */
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
