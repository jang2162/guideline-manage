import fs from 'node:fs';
import path from 'node:path';
import { applyFiles, writeFileAtomic, ApplyError } from './apply.js';
import { LOCK, readLock, lockText, ManifestError, qualify, splitQualified } from './manifest.js';
import { diskReader, itemStates } from './project-state.js';
import { render } from './render/index.js';
import { virtualize, toRealLock, showId } from './workspace.js';
import { effectiveItems, projectFinalOwners, shadowedAdds, reportedShadows } from './personal.js';
import { withAncestors } from './blocks.js';
import { finalUnit } from './sources.js';
import { t } from './i18n.js';

// 개인 사본: 개인이 더한 블록(프로젝트 선택에 없는 것)의 받은 파일을 개인 저장소(<store>/.guideline/)에 원본 모양으로 둔다.
// 잠금은 <store>/guideline-lock.json. 개인 사본은 고치지 않으므로(propose 대상이 아니다) 받을 때마다 덮는다.

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 출처(이 매니페스트의 것)마다 개인 사본으로 받을 블록(실제 이름): local.json 의 공통 더함 ∪ 모든 역할의 더함과 그 조상 전부.
 * 지금 워크트리의 역할로 거르지 않는다 — 개인 저장소는 역할이 다른 워크트리끼리 함께 쓰므로, 어느 워크트리에서 받아도 같은 사본이 유지된다. 지금 워크트리의 프로젝트
 * 선택으로 거르지 않는다 — 개인 저장소는 워크트리끼리 함께 쓰는데 프로젝트 선택은 브랜치마다 달라, 한 워크트리에서 프로젝트가 고른
 * 블록이 다른 워크트리에서는 개인 사본으로만 들어온다. 「프로젝트가 같은 블록을 고르면 개인 사본을 쓰지 않는다」 는 조합(personalTree
 * 의 주인 판정, 다른 출처 가려짐은 shadowedAdds)이 워크트리마다 정한다.
 * 조상까지 받는 이유: 하위 스택만 개인으로 더하면 조합이 그 조상 스택도 고른 것으로 보는데, 프로젝트가 그 조상을 고르지 않았으면
 * 사본이 프로젝트 .guideline/ 에 없다.
 * @param {import('./manifest.js').Manifest} manifest
 * @param {import('./personal.js').Local} local
 * @returns {Record<string, string[]>}
 */
export function personalTargets(manifest, local) {
  const out = {};
  const layers = [local.sources, ...Object.values(local.roles ?? {}).map(r => r.sources)];
  for (const name of Object.keys(manifest.sources)) out[name] = withAncestors(layers.flatMap(l => l[name]?.add ?? []));
  return out;
}

/**
 * 개인 사본 대상 중 이 워크트리의 조합이 실제로 개인 사본에서 읽는 것: 적용되는 개인 더함과 그 조상 중 최종 이름(별칭을 입힌 것)을
 * 이 워크트리의 프로젝트 선택이 (어느 출처로든) 갖지 않은 것. 리비전 차이는 이것이 있는 출처만 알린다.
 */
function usedTargets(manifest, local) {
  const eff = effectiveItems(manifest, local);
  const owners = projectFinalOwners(manifest);
  const hidden = shadowedAdds(manifest, eff);
  const out = {};
  for (const [name, e] of Object.entries(eff.sources)) {
    const aliases = manifest.sources[name].aliases ?? {};
    const off = new Set(hidden.filter(x => x.source === name).flatMap(x => x.below));
    out[name] = withAncestors(e.added.filter(k => !off.has(k))).filter(k => !owners.has(finalUnit(k, aliases)));
  }
  return out;
}

/** 개인 잠금을 읽을 수 없을 때의 할 일 — update 를 다시 돌려도 같은 파일에서 또 실패하므로 그 파일을 지우라고 한다. */
function lockBadTodo(store, e) {
  return { kind: 'personal-sync', item: null, message: t('todo.personalLockBad', { file: path.join(store, LOCK), reason: e.message }) };
}

/**
 * 개인 사본 render 의 할 일에 개인임을 드러낸다(scope: 'personal'). 세팅과 원본에서 사라짐은 할 일 자체가 달라 문구를 바꾼다 —
 * 개인 범위 스택의 세팅은 커밋되는 파일을 바꾸지 않는다(사용자 결정 A), 개인 더함은 pick --local 에서 해제한다.
 * 나머지(막힘 등)는 「개인 사본 —」 을 앞에 붙인다. kind 는 세팅만 setup-personal 로 바꾼다(setup 을 아는 에이전트가 일반 세팅으로
 * 처리하지 않게). item 은 그대로라 mergeTodos 의 no-copy 정리는 같이 된다.
 */
function personalRenderTodo(x) {
  if (x.kind === 'setup') {
    const stack = /^rules\/(.+)\/SETUP\.md$/.exec(x.item)?.[1] ?? x.item;
    return { kind: 'setup-personal', item: x.item, scope: 'personal', message: t('todo.setupPersonal', { stack }) };
  }
  if (x.kind === 'removed-upstream') return { ...x, scope: 'personal', message: t('todo.removedUpstreamPersonal', { item: x.item }) };
  return { ...x, scope: 'personal', message: t('todo.personalCopyTodo', { message: x.message }) };
}

/**
 * 개인 사본 대상만 담은 매니페스트. 출처는 프로젝트 매니페스트의 것에, local.json 에만 있는 출처(다른 브랜치의 매니페스트에만 있는 출처)를
 * 항목 없이 더한다 — 그 출처는 받지 못한 출처처럼 다뤄져 개인 사본·잠금이 그대로 남는다(local.json 에서 빠질 때까지).
 */
function personalManifest(manifest, local) {
  const targets = personalTargets(manifest, local);
  const sources = {};
  for (const [name, s] of Object.entries(manifest.sources)) sources[name] = { ...s, items: targets[name] ?? [], required: [] };
  for (const name of Object.keys(local.sources)) if (!sources[name]) sources[name] = { server: '', items: [], aliases: {}, required: [] };
  return { ...manifest, sources };
}

/**
 * 개인 사본을 받은 원본으로 맞춘다. 디스크는 읽기만 한다.
 * 개인 사본·잠금 항목은 local.json 에서 그 더함이 빠질 때만 지워진다. 프로젝트가 같은 블록을 골라도 지우지 않는다(다른 워크트리가 쓴다).
 * trees 에 없는 출처(받지 못함, local.json 에만 있는 출처)의 개인 사본·잠금은 그대로 둔다.
 * @param {{ store: string, manifest: import('./manifest.js').Manifest, local: import('./personal.js').Local,
 *   trees: Map<string, { tree: import('./tree.js').Tree, server?: string }>, revisions: Record<string, number>, nested?: boolean }} opts
 * @returns {{ files: Record<string, Buffer | null>, lock: import('./manifest.js').Lock, todos: object[] }} files 는 store 기준 경로
 */
export function syncPersonal({ store, manifest, local, trees, revisions, nested = false }) {
  const previous = readLock(store);
  const pm = personalManifest(manifest, local);
  const failed = Object.keys(pm.sources).filter(n => !trees.has(n));
  const v = virtualize({ manifest: pm, lock: previous, trees });
  // 개인 사본은 고치지 않으므로 늘 덮는다(force). 관리 지침 추가분은 프로젝트 사본에만 있다.
  const rendered = render({
    tree: v.tree, revision: 0, manifest: v.view, lock: v.viewLock, project: diskReader(store), force: true, nested, management: {},
  });
  const got = Object.fromEntries(Object.entries(revisions).filter(([n]) => trees.has(n)));
  const lock = toRealLock({ viewLock: rendered.lock, sources: v.sources, revisions: got, previous, keep: failed });
  return { files: rendered.files, lock, todos: rendered.todos.map(personalRenderTodo) };
}

/**
 * update·pick 이 프로젝트를 반영한 뒤 같은 trees 로 개인 사본을 받아 store 에 쓴다. 할 일을 돌려준다.
 * 개인 사본 대상도 지난 개인 잠금도 없으면 아무것도 하지 않는다. 실패해도 프로젝트 반영은 되돌리지 않고 할 일로 알린다.
 * 대상은 저장된 local.json 전체(saved — 모든 역할 포함)로 정한다. composeInputs 의 local 은 이 워크트리 역할로 펼친 조합용이라
 * 그것으로 정하면 다른 역할의 개인 사본·잠금이 지워진다. saved 가 없으면(local 만 넘긴 호출) local 이 저장된 것이다.
 * @param {{ personal: { store: string, local: import('./personal.js').Local, saved?: import('./personal.js').Local },
 *   manifest: import('./manifest.js').Manifest, trees: Map<string, object>, revisions: Record<string, number>, nested?: boolean }} opts
 * @returns {object[]}
 */
export function writePersonal({ personal, manifest, trees, revisions, nested = false }) {
  const { store } = personal;
  const local = personal.saved ?? personal.local;
  const lockFile = path.join(store, LOCK);
  const wanted = Object.values(personalTargets(manifest, local)).some(list => list.length > 0);
  if (!wanted && !fs.existsSync(lockFile)) return [];
  try {
    readLock(store);
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    return [lockBadTodo(store, e)];
  }
  try {
    const r = syncPersonal({ store, manifest, local, trees, revisions, nested });
    // store 는 보통 writeLocal 이 이미 만들어 두었다. 그래도 local.json 을 손으로 지워 잠금만 남은 정리 실행 등에서 applyFiles 가
    // (store 를 realpath 하므로) 실패하지 않게 먼저 만든다. 지금 테스트로는 가를 수 없는 방어 코드다.
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
 * status 가 보일 개인 범위: 공통 겹의 개인 더함·뺌·필수라 무시된 뺌(실제 이름, 출처가 둘 이상이면 `<출처>:<id>`), 이 워크트리 역할 겹의
 * 같은 것(role), 다른 출처에 가려진 더함(최종 결과로 판정)과 개인 사본 상태.
 * local 은 조합에 쓴 펼친 선택(composeInputs), saved 는 저장된 local.json 전체(개인 사본 대상), layers 는 겹별 결과. saved·layers 가
 * 없으면 local 이 저장된 것이고 겹은 공통 하나다. role 은 역할 이름이 있을 때만(정의가 이 단위에 없으면 defined: false, 목록은 빈 것).
 * 개인 사본 상태는 받은 trees(최신) 기준으로 개인 잠금·store 디스크를 견준다. 개인 잠금을 읽을 수 없으면 items 는 비고 할 일.
 * @returns {{ added: string[], removed: string[], ignored: string[], shadowed: { id: string, by: string }[],
 *   role: { name: string, defined: boolean, added: string[], removed: string[], ignored: string[] } | null,
 *   items: { id: string, state: string }[], todos: object[] }}
 */
export function personalStatus({ store, manifest, local, saved = local, layers = null, role = null, trees, nested = false }) {
  const eff = effectiveItems(manifest, local);
  const many = Object.keys(manifest.sources).length > 1;
  const show = (name, k) => (many ? qualify(name, k) : k);
  const listsOf = e => {
    const out = { added: [], removed: [], ignored: [] };
    for (const name of Object.keys(e.sources).sort(byStr)) {
      const x = e.sources[name];
      out.added.push(...x.added.map(k => show(name, k)));
      out.removed.push(...x.removed.map(k => show(name, k)));
      out.ignored.push(...x.ignored.filter(k => x.ignoredWhy[k] === 'required').map(k => show(name, k)));
    }
    return out;
  };
  const { added, removed, ignored } = listsOf(layers?.common ?? eff);
  const roleShown = role === null ? null : {
    name: role, defined: !!layers?.role, ...(layers?.role ? listsOf(layers.role) : { added: [], removed: [], ignored: [] }),
  };
  const shadowed = reportedShadows(shadowedAdds(manifest, eff), layers?.filled).flatMap(x => [x.key, ...x.below].map(k => ({ id: show(x.source, k), by: x.by })));
  const todos = [];
  let lock;
  try {
    lock = readLock(store);
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    todos.push(lockBadTodo(store, e));
    return { added, removed, ignored, shadowed, role: roleShown, items: [], todos };
  }
  const pm = personalManifest(manifest, saved);
  const v = virtualize({ manifest: pm, lock, trees });
  const viewLock = v.viewLock ?? { version: 1, revision: 1, sources: {}, outputs: [] };
  const { states } = itemStates({ tree: v.tree, reader: diskReader(store), manifest: v.view, lock: viewLock, nested, management: {} });
  const items = [...states].map(([id, state]) => ({ id: showId(id, v.sources, many), state }));
  return { added, removed, ignored, shadowed, role: roleShown, items, todos };
}

/**
 * 개인 잠금과 프로젝트 잠금의 리비전이 출처별로 다르면 알린다(apply·status). 개인 사본은 git 공용 디렉터리에 하나뿐이라 브랜치가
 * 다른 워크트리가 함께 쓴다 — 한 워크트리의 update 가 개인 사본만 올리면 다른 워크트리의 프로젝트 사본과 리비전이 어긋나고,
 * 하위 스택(개인)·부모 스택(프로젝트)이 섞일 때 바꿈이 가리키는 절이 없을 수 있다. 지금 조합이 쓰는 개인 사본이 있는 출처만 본다.
 * 개인 잠금을 읽을 수 없으면 그 할 일 하나.
 * @param {{ store: string, manifest: import('./manifest.js').Manifest, local: import('./personal.js').Local, lock: import('./manifest.js').Lock }} opts
 *   lock 은 프로젝트 잠금
 * @returns {object[]}
 */
export function personalRevisionTodos({ store, manifest, local, lock }) {
  let mine;
  try {
    mine = readLock(store);
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    return [lockBadTodo(store, e)];
  }
  if (!mine) return [];
  const targets = usedTargets(manifest, local);
  const held = new Set(Object.keys(mine.sources).map(q => splitQualified(q).source));
  const todos = [];
  for (const name of Object.keys(targets).sort(byStr)) {
    if (!targets[name].length || !held.has(name)) continue;
    const personal = mine.revisions[name];
    const project = lock?.revisions?.[name];
    if (personal === undefined || project === undefined || personal === project) continue;
    todos.push({ kind: 'personal-revision', item: null, message: t('todo.personalRevision', { source: name, personal, project }) });
  }
  return todos;
}
