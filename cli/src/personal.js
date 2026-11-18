import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';
import { gitCommonDir, runGit } from './projects.js';
import { isBlockKey, isWithin, withAncestors } from './blocks.js';

export class LocalError extends Error {}

export const LOCAL_FILE = 'local.json';

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = list => [...new Set(list)].sort(byStr);

/**
 * @typedef {{ add: string[], remove: string[] }} LocalSource  실제 이름(별칭 전)의 블록 키
 * @typedef {{ version: 1, sources: Record<string, LocalSource> }} Local
 */

/**
 * 이 단위의 개인 저장소 폴더: `<git 공용 디렉터리>/guideline/units/<단위 키>`. 워크트리끼리 같은 곳을 쓴다.
 * 단위 키는 git 루트 단위면 `%root`, 그 밖은 루트에서 단위까지의 `/` 구분 상대경로를 `encodeURIComponent` 한 것이다.
 * `%root` 는 `encodeURIComponent` 결과로 나올 수 없어(`%` 는 늘 `%25` 가 된다) 단위마다 키가 다르다.
 * dir 과 root 를 둘 다 realpath 한다. git 저장소가 아니거나 dir 이 root 밖이면 null. 폴더는 만들지 않는다(writeLocal 이 만든다).
 * @param {{ dir: string, root: string }} unit
 * @param {import('./projects.js').GitRunner} [git]
 * @returns {string | null}
 */
export function personalStore(unit, git = runGit) {
  return personalPlace(unit, git)?.store ?? null;
}

/** 메인 워크트리의 id. 링크 워크트리의 이름(디렉터리 이름)은 `.` 일 수 없어 겹치지 않는다. */
export const MAIN_WORKTREE = '.';

/**
 * dir 이 든 워크트리의 id: 링크 워크트리면 `<공용>/worktrees/<이름>` 의 이름을 encodeURIComponent 한 것(공백·`@` 가 없다),
 * 메인 워크트리(git 디렉터리가 공용 디렉터리)면 MAIN_WORKTREE. info/exclude 의 개인 블록을 워크트리마다 나눌 때 쓴다.
 */
export function worktreeId(dir, common, git = runGit) {
  const r = git(['rev-parse', '--path-format=absolute', '--git-dir'], dir);
  const out = r.status === 0 ? r.stdout.trim() : '';
  let own;
  try {
    own = fs.realpathSync(out);
  } catch {
    return MAIN_WORKTREE;
  }
  if (own === common) return MAIN_WORKTREE;
  const rel = path.relative(path.join(common, 'worktrees'), own);
  return encodeURIComponent(rel.split(path.sep).join('/'));
}

/**
 * personalStore 와 같은 판정으로, 저장소 폴더와 함께 git 공용 디렉터리, 단위 경로(git 루트 기준, `/` 구분, 루트 단위는 ''),
 * 워크트리 id 를 준다. 조합이 `<공용>/info/exclude` 의 단위·워크트리 블록을 쓸 때 쓴다.
 * @param {{ dir: string, root: string }} unit
 * @param {import('./projects.js').GitRunner} [git]
 * @returns {{ common: string, unitRel: string, store: string, worktree: string } | null}
 */
export function personalPlace(unit, git = runGit) {
  const common = gitCommonDir(unit.dir, git);
  if (!common) return null;
  const rel = path.relative(fs.realpathSync(unit.root), fs.realpathSync(unit.dir));
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const unitRel = rel.split(path.sep).join('/');
  const key = unitRel === '' ? '%root' : encodeURIComponent(unitRel);
  return { common, unitRel, store: path.join(common, 'guideline', 'units', key), worktree: worktreeId(unit.dir, common, git) };
}

/** @returns {Local} 파일이 없으면 빈 개인 선택 */
export function readLocal(store) {
  const file = path.join(store, LOCAL_FILE);
  if (!fs.existsSync(file)) return { version: 1, sources: {} };
  const bad = () => new LocalError(t('local.badFile', { file }));
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw bad();
  }
  const okList = v => Array.isArray(v) && v.every(isBlockKey);
  if (!data || data.version !== 1 || !data.sources || typeof data.sources !== 'object' || Array.isArray(data.sources)) throw bad();
  const sources = {};
  for (const [name, s] of Object.entries(data.sources)) {
    if (!s || typeof s !== 'object' || !okList(s.add) || !okList(s.remove)) throw bad();
    sources[name] = { add: uniqSorted(s.add), remove: uniqSorted(s.remove) };
  }
  return { version: 1, sources };
}

/** 출처 이름과 블록 키를 정렬·중복 제거해 쓴다. */
export function writeLocal(store, local) {
  const sources = {};
  for (const name of Object.keys(local.sources).sort(byStr)) {
    const s = local.sources[name];
    sources[name] = { add: uniqSorted(s.add), remove: uniqSorted(s.remove) };
  }
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, LOCAL_FILE), `${JSON.stringify({ version: 1, sources }, null, 2)}\n`);
}

const WHY_RANK = ['required', 'canceled', 'already-chosen', 'no-effect'];

/**
 * 매니페스트에 개인 선택을 입힌 출처별 항목(실제 이름, 별칭 전).
 * 출처마다 `items = withAncestors((items ∪ add) − remove − remove 의 자손)`. 필수 블록과 그 조상을 빼려는 remove 는 무시한다.
 * 실제로 적용되는 것만 알린다:
 * - added: 결과 items 에 있고 프로젝트 items 에 없던 개인 add(자동으로 채운 조상은 넣지 않는다).
 * - removed: 프로젝트 items 에 있었는데 결과에서 빠진 것(remove 한 스택의 자손 포함).
 * - ignored / ignoredWhy: 적용되지 않은 개인 항목과 이유 — required(필수를 빼려 함), canceled(add 를 remove 가 상쇄),
 *   already-chosen(프로젝트가 이미 가진 것을 add), no-effect(아무것도 못 뺀 remove).
 * orphans: 매니페스트에 없는 출처의 개인 항목. sources 와 섞지 않는다(소비자는 sources 만 출처로 다룬다).
 * @param {import('./manifest.js').Manifest} manifest
 * @param {Local} local
 * @returns {{
 *   sources: Record<string, { items: string[], added: string[], removed: string[], ignored: string[], ignoredWhy: Record<string, 'required' | 'canceled' | 'already-chosen' | 'no-effect'> }>,
 *   orphans: Record<string, LocalSource>,
 * }}
 */
export function effectiveItems(manifest, local) {
  const sources = {};
  for (const [name, src] of Object.entries(manifest.sources)) {
    const mine = local.sources[name] ?? { add: [], remove: [] };
    const guarded = new Set(withAncestors(src.required ?? []));
    const drop = mine.remove.filter(k => !guarded.has(k));
    const base = [...new Set([...src.items, ...mine.add])];
    const items = withAncestors(base.filter(k => !drop.some(r => isWithin(k, r))));
    const kept = new Set(items);
    const chosen = new Set(src.items);

    const why = {};
    const flag = (k, reason) => {
      if (!why[k] || WHY_RANK.indexOf(reason) < WHY_RANK.indexOf(why[k])) why[k] = reason;
    };
    for (const k of mine.remove) {
      if (guarded.has(k)) flag(k, 'required');
      else if (!base.some(b => isWithin(b, k) && !kept.has(b))) flag(k, 'no-effect');
    }
    for (const k of mine.add) {
      if (chosen.has(k)) {
        if (kept.has(k)) flag(k, 'already-chosen');
      } else if (!kept.has(k)) flag(k, 'canceled');
    }
    sources[name] = {
      items,
      added: uniqSorted(mine.add.filter(k => kept.has(k) && !chosen.has(k))),
      removed: src.items.filter(k => !kept.has(k)).sort(byStr),
      ignored: Object.keys(why).sort(byStr),
      ignoredWhy: Object.fromEntries(Object.keys(why).sort(byStr).map(k => [k, why[k]])),
    };
  }
  const orphans = {};
  for (const [name, s] of Object.entries(local.sources)) {
    if (!(name in manifest.sources)) orphans[name] = { add: [...s.add], remove: [...s.remove] };
  }
  return { sources, orphans };
}
