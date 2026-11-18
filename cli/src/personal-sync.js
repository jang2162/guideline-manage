import fs from 'node:fs';
import path from 'node:path';
import { applyFiles, writeFileAtomic, ApplyError } from './apply.js';
import { LOCK, readLock, lockText, ManifestError, qualify } from './manifest.js';
import { diskReader, itemStates } from './project-state.js';
import { render } from './render/index.js';
import { virtualize, toRealLock, showId } from './workspace.js';
import { effectiveItems } from './personal.js';
import { withAncestors } from './blocks.js';
import { t } from './i18n.js';

// 개인 사본: 개인이 더한 블록(프로젝트 선택에 없는 것)의 받은 파일을 개인 저장소(<store>/.guideline/)에 원본 모양으로 둔다.
// 잠금은 <store>/guideline-lock.json. 개인 사본은 고치지 않으므로(propose 대상이 아니다) 받을 때마다 덮는다.

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 출처마다 개인 사본으로 받을 블록(실제 이름): 실제로 적용되는 개인 더함과 그 조상 중 프로젝트 선택에 없는 것.
 * 조상까지 받는 이유: 하위 스택만 개인으로 더하면 조합이 그 조상 스택도 고른 것으로 보는데, 프로젝트가 그 조상을 고르지 않았으면
 * 사본이 프로젝트 .guideline/ 에 없다.
 * @param {import('./manifest.js').Manifest} manifest
 * @param {import('./personal.js').Local} local
 * @returns {Record<string, string[]>}
 */
export function personalTargets(manifest, local) {
  const eff = effectiveItems(manifest, local);
  const out = {};
  for (const [name, e] of Object.entries(eff.sources)) {
    const chosen = new Set(manifest.sources[name].items);
    out[name] = withAncestors(e.added).filter(k => !chosen.has(k));
  }
  return out;
}

/** 개인 사본 대상만 담은 매니페스트(출처는 프로젝트 매니페스트 그대로 — 받지 못한 출처를 가리고 빠진 출처를 정리하게). */
function personalManifest(manifest, local) {
  const targets = personalTargets(manifest, local);
  const sources = {};
  for (const [name, s] of Object.entries(manifest.sources)) sources[name] = { ...s, items: targets[name] ?? [], required: [] };
  return { ...manifest, sources };
}

/**
 * 개인 사본을 받은 원본으로 맞춘다. 디스크는 읽기만 한다.
 * 프로젝트가 같은 블록을 고르게 되면 그 블록은 대상에서 빠져 개인 사본·잠금 항목이 지워진다(프로젝트 사본이 이긴다).
 * trees 에 없는 출처(받지 못함)의 개인 사본·잠금은 그대로 둔다.
 * @param {{ store: string, manifest: import('./manifest.js').Manifest, local: import('./personal.js').Local,
 *   trees: Map<string, { tree: import('./tree.js').Tree, server?: string }>, revisions: Record<string, number>, nested?: boolean }} opts
 * @returns {{ files: Record<string, Buffer | null>, lock: import('./manifest.js').Lock, todos: object[] }} files 는 store 기준 경로
 */
export function syncPersonal({ store, manifest, local, trees, revisions, nested = false }) {
  const previous = readLock(store);
  const pm = personalManifest(manifest, local);
  const failed = Object.keys(manifest.sources).filter(n => !trees.has(n));
  const v = virtualize({ manifest: pm, lock: previous, trees });
  // 개인 사본은 고치지 않으므로 늘 덮는다(force). 관리 지침 추가분은 프로젝트 사본에만 있다.
  const rendered = render({
    tree: v.tree, revision: 0, manifest: v.view, lock: v.viewLock, project: diskReader(store), force: true, nested, management: {},
  });
  const got = Object.fromEntries(Object.entries(revisions).filter(([n]) => trees.has(n)));
  const lock = toRealLock({ viewLock: rendered.lock, sources: v.sources, revisions: got, previous, keep: failed });
  return { files: rendered.files, lock, todos: rendered.todos };
}

/**
 * update·pick 이 프로젝트를 반영한 뒤 같은 trees 로 개인 사본을 받아 store 에 쓴다. 할 일을 돌려준다.
 * 개인 사본 대상도 지난 개인 잠금도 없으면 아무것도 하지 않는다. 실패해도 프로젝트 반영은 되돌리지 않고 할 일로 알린다.
 * @param {{ personal: { store: string, local: import('./personal.js').Local }, manifest: import('./manifest.js').Manifest,
 *   trees: Map<string, object>, revisions: Record<string, number>, nested?: boolean }} opts
 * @returns {object[]}
 */
export function writePersonal({ personal, manifest, trees, revisions, nested = false }) {
  const { store, local } = personal;
  const lockFile = path.join(store, LOCK);
  const wanted = Object.values(personalTargets(manifest, local)).some(list => list.length > 0);
  if (!wanted && !fs.existsSync(lockFile)) return [];
  try {
    const r = syncPersonal({ store, manifest, local, trees, revisions, nested });
    // applyFiles 는 store 를 realpath 하므로 먼저 만든다
    fs.mkdirSync(store, { recursive: true });
    applyFiles(store, r.files);
    writeFileAtomic(lockFile, lockText(r.lock));
    return r.todos;
  } catch (e) {
    if (!(e instanceof ApplyError || e instanceof ManifestError || e?.code)) throw e;
    return [{ kind: 'personal-sync', item: null, message: t('todo.personalSyncFailed', { store, reason: e.message }) }];
  }
}

/**
 * status 가 보일 개인 범위: 개인 더함·뺌·필수라 무시된 뺌(실제 이름, 출처가 둘 이상이면 `<출처>:<id>`)과 개인 사본 상태.
 * 개인 사본 상태는 받은 trees(최신) 기준으로 개인 잠금·store 디스크를 견준다. 개인 잠금을 읽을 수 없으면 items 는 비고 할 일.
 * @returns {{ added: string[], removed: string[], ignored: string[], items: { id: string, state: string }[], todos: object[] }}
 */
export function personalStatus({ store, manifest, local, trees, nested = false }) {
  const eff = effectiveItems(manifest, local);
  const many = Object.keys(manifest.sources).length > 1;
  const show = (name, k) => (many ? qualify(name, k) : k);
  const added = [];
  const removed = [];
  const ignored = [];
  for (const name of Object.keys(eff.sources).sort(byStr)) {
    const e = eff.sources[name];
    added.push(...e.added.map(k => show(name, k)));
    removed.push(...e.removed.map(k => show(name, k)));
    ignored.push(...e.ignored.filter(k => e.ignoredWhy[k] === 'required').map(k => show(name, k)));
  }
  const todos = [];
  let lock;
  try {
    lock = readLock(store);
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    todos.push({ kind: 'personal-sync', item: null, message: t('todo.personalSyncFailed', { store, reason: e.message }) });
    return { added, removed, ignored, items: [], todos };
  }
  const pm = personalManifest(manifest, local);
  const v = virtualize({ manifest: pm, lock, trees });
  const viewLock = v.viewLock ?? { version: 1, revision: 1, sources: {}, outputs: [] };
  const { states } = itemStates({ tree: v.tree, reader: diskReader(store), manifest: v.view, lock: viewLock, nested, management: {} });
  const items = [...states].map(([id, state]) => ({ id: showId(id, v.sources, many), state }));
  return { added, removed, ignored, items, todos };
}
