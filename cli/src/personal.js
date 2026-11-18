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
 * 단위 키는 git 루트에서 단위까지의 상대경로(`/` 는 `__`), 루트 단위는 `_root`. git 저장소가 아니면 null.
 * 폴더는 만들지 않는다(writeLocal 이 만든다).
 * @param {{ dir: string, root: string }} unit
 * @param {import('./projects.js').GitRunner} [git]
 * @returns {string | null}
 */
export function personalStore(unit, git = runGit) {
  const common = gitCommonDir(unit.dir, git);
  if (!common) return null;
  const rel = path.relative(unit.root, fs.realpathSync(unit.dir));
  const key = rel === '' ? '_root' : rel.split(path.sep).join('__');
  return path.join(common, 'guideline', 'units', key);
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

/**
 * 매니페스트에 개인 선택을 입힌 출처별 항목(실제 이름, 별칭 전).
 * 출처마다 `withAncestors((items ∪ add) − remove − remove 의 자손)`. 필수 블록과 그 조상을 빼려는 remove 는 무시한다(ignored).
 * 매니페스트에 없는 출처의 개인 항목은 모두 버리고 그 출처 이름 아래 ignored 로만 남긴다.
 * added: 매니페스트에 없던 것을 더한 개인 항목, removed: 실제로 받아들인 remove.
 * @param {import('./manifest.js').Manifest} manifest
 * @param {Local} local
 * @returns {{ sources: Record<string, { items: string[], added: string[], removed: string[], ignored: string[] }> }}
 */
export function effectiveItems(manifest, local) {
  const sources = {};
  for (const [name, src] of Object.entries(manifest.sources)) {
    const mine = local.sources[name] ?? { add: [], remove: [] };
    const guarded = new Set(withAncestors(src.required ?? []));
    const removed = uniqSorted(mine.remove.filter(k => !guarded.has(k)));
    const ignored = uniqSorted(mine.remove.filter(k => guarded.has(k)));
    const added = uniqSorted(mine.add.filter(k => !src.items.includes(k)));
    const kept = [...new Set([...src.items, ...mine.add])].filter(k => !removed.some(r => isWithin(k, r)));
    sources[name] = { items: withAncestors(kept), added, removed, ignored };
  }
  for (const [name, s] of Object.entries(local.sources)) {
    if (!(name in manifest.sources)) sources[name] = { items: [], added: [], removed: [], ignored: uniqSorted([...s.add, ...s.remove]) };
  }
  return { sources };
}
