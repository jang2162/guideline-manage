import { sha256, normalized, itemHash, treeHashes } from '../hashes.js';
import { desiredOutputs, desiredPart, RULER_TOML_BASE, NESTED_TOML_BASE, isRootOnly, ROOT_ONLY_REASON } from './outputs.js';
import { setTable, tableSlice, parseKeyPath } from '../toml-table.js';
import { readTier } from '../tiers.js';
import { readText } from '../tree.js';
import { stackOverrides } from '../catalog.js';
import { t } from '../i18n.js';

const RULE = /^rules\/([^/]+)\/(\d{2}-[a-z0-9][a-z0-9-]*\.md)$/;
const SETUP = /^rules\/([^/]+)\/SETUP\.md$/;
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const keyOf = o => `${o.path}\0${o.key ?? ''}`;
const label = o => (o.key ? `${o.path} (${o.key})` : o.path);
const lf = s => s.replace(/\r\n/g, '\n');

/** 반영할 수 없는 이유. 없으면 null. */
export function blockedReason(tree, id, nested = false) {
  if (nested && isRootOnly(id)) return ROOT_ONLY_REASON();
  const m = RULE.exec(id) ?? SETUP.exec(id);
  if (!m) return null;
  if (stackOverrides(m[1], tree).warnings.length) return t('inspect.overrideTableWarning', { stack: m[1] });
  return RULE.test(id) ? (readTier(readText(tree, id)).warning ?? null) : null;
}

/**
 * 공유 파일(ruler.toml) 글자에서 출력 하나의 몫. 없으면 null.
 * @param {string | null} text
 * @param {{ key?: string }} output
 */
export function partOfText(text, output) {
  return text === null ? null : tableSlice(text, parseKeyPath(output.key));
}

/**
 * 프로젝트에서 출력 하나의 지금 내용. 파일이면 CRLF 를 맞춘 내용, TOML 이면 그 표.
 * @param {{ read: (rel: string) => Buffer | null }} project
 */
export function currentPart(project, output) {
  const raw = project.read(output.path);
  if (raw === null) return null;
  if (!output.key) return normalized(output.path, raw);
  return partOfText(lf(raw.toString('utf8')), output);
}

const setPart = (text, output, value) => setTable(text ?? '', parseKeyPath(output.key), value);

/**
 * 원본·매니페스트·잠금·디스크·결정을 합쳐 쓸 파일, 새 잠금, 할 일을 낸다. 디스크에 쓰지 않는다.
 * 경로는 모두 단위 디렉터리 기준이다.
 * @param {{ tree: import('../tree.js').Tree, revision: number, manifest: import('../manifest.js').Manifest,
 *   lock: import('../manifest.js').Lock | null, project: { read: Function, exists: Function, rulerAgentsEnabled: boolean },
 *   decisions?: Record<string, { action?: string, overwrite?: boolean, state?: string, reason?: string }>,
 *   force?: boolean, orphans?: string[], nested?: boolean }} opts
 */
export function render({ tree, revision, manifest, lock = null, project, decisions = {}, force = false, orphans = [], nested = false, management = {} }) {
  const hashes = treeHashes(tree);
  const prevSources = lock?.sources ?? {};
  const prevOutputs = lock?.outputs ?? [];
  const todos = [];
  const sources = {};
  const renderable = [];
  const carried = new Set();

  for (const id of manifest.items) {
    const h = itemHash(hashes, id);
    if (h === null) {
      carried.add(id);
      todos.push({ kind: 'removed-upstream', item: id, message: t('todo.removedUpstream', { item: id }) });
      continue;
    }
    const reason = blockedReason(tree, id, nested) ?? (decisions[id]?.state === 'blocked' ? (decisions[id].reason ?? t('render.sourceWarning')) : null);
    if (reason) {
      carried.add(id);
      todos.push({ kind: 'blocked', item: id, message: t('todo.blocked', { item: id, reason }) });
      continue;
    }
    renderable.push(id);
    sources[id] = h;
  }
  for (const id of carried) if (prevSources[id]) sources[id] = prevSources[id];

  // 잠금이 모르는 채로 체크를 푼 항목(0.10 방식에서 옮길 때). 잠금에 있는 출력은 아래의 지난 잠금 정리가 지운다.
  const unlockedRemovals = Object.entries(decisions)
    .filter(([id, d]) => d.action === 'remove' && !manifest.items.includes(id) && !prevOutputs.some(o => o.items.includes(id)))
    .map(([id]) => id)
    .filter(id => itemHash(hashes, id) !== null && !(nested && isRootOnly(id)))
    .sort();
  const leftover = (id, where) => todos.push({
    kind: 'leftover', item: id, message: t('todo.leftoverEdited', { where }),
  });

  // ruler.toml 은 글자로 고쳐 나가다가 마지막에 바뀌었으면 쓴다.
  const TOML = '.ruler/ruler.toml';
  const raw = project.read(TOML);
  const original = raw === null ? null : lf(raw.toString('utf8'));
  let toml = original ?? (nested ? NESTED_TOML_BASE : RULER_TOML_BASE)(manifest.agents);

  const { outputs: desired, todos: more } = desiredOutputs({ tree, manifest, items: renderable, rulerAgentsEnabled: project.rulerAgentsEnabled, management });
  todos.push(...more);
  for (const id of renderable) {
    const m = SETUP.exec(id);
    if (m && prevSources[id] !== sources[id]) {
      todos.push({ kind: 'setup', item: id, message: t('todo.setup', { stack: m[1] }) });
    }
  }

  const files = {};
  const outputs = [];
  const prevByKey = new Map(prevOutputs.map(o => [keyOf(o), o]));
  const desiredKeys = new Set(desired.map(keyOf));
  const fileNow = p => {
    const b = project.read(p);
    return b === null ? null : normalized(p, b);
  };

  for (const d of desired) {
    const prev = prevByKey.get(keyOf(d));
    const want = desiredPart(d);
    const cur = d.key ? partOfText(toml, d) : fileNow(d.path);
    const allowUpdate = force || d.items.some(i => decisions[i]?.action === 'update' || decisions[i]?.overwrite);
    const allowOverwrite = force || d.items.some(i => decisions[i]?.overwrite);
    const record = (hash, adopted = false) => outputs.push({ path: d.path, ...(d.key ? { key: d.key } : {}), items: d.items, hash, ...(adopted ? { adopted: true } : {}) });

    let act;
    if (cur !== null && eq(cur, want)) act = 'record';
    else if (prev) act = cur === null || sha256(cur) === prev.hash || allowOverwrite ? 'write' : 'skip';
    else if (cur === null || d.owned || allowUpdate) act = 'write';
    else if (d.adopt) act = 'record';
    else act = 'conflict';

    if (act === 'write') {
      if (d.kind === 'file') files[d.path] = want;
      else {
        const r = setPart(toml, d, d.entry);
        if (r.conflict) {
          todos.push({ kind: 'conflict', item: d.items[0] ?? null, message: `${label(d)}: ${r.conflict}` });
          if (prev) outputs.push(prev);
          else for (const i of d.items) delete sources[i];
          continue;
        }
        toml = r.text;
      }
      record(sha256(want));
    } else if (act === 'record') {
      // 잠금 없이 받기 전부터 원본과 다른 사본: 프로젝트에서 고친 것인지 옛 판인지 모른다
      record(sha256(want), !eq(cur, want));
    } else if (act === 'skip') {
      outputs.push(prev);
      for (const i of d.items) {
        if (prev.items.includes(i) && prevSources[i]) sources[i] = prevSources[i];
        else delete sources[i];
      }
      todos.push({
        kind: 'skipped', item: d.items[0] ?? null,
        message: prev.adopted
          ? t('todo.skippedAdopted', { what: label(d), id: d.items[0] })
          : t('todo.skipped', { what: label(d) }),
      });
    } else {
      todos.push({ kind: 'conflict', item: d.items[0] ?? null, message: t('todo.conflict', { what: label(d) }) });
      for (const i of d.items) delete sources[i];
    }
  }

  // 지난 잠금에 있었는데 이번에 바라지 않는 출력은 지운다. 그대로 둘 항목의 출력은 남긴다.
  for (const o of prevOutputs) {
    if (desiredKeys.has(keyOf(o))) continue;
    if (o.items.some(i => carried.has(i))) {
      outputs.push(o);
      continue;
    }
    if (!o.key) {
      const cur = fileNow(o.path);
      if (cur === null) continue;
      // 폼에서 「풀면 지움」 에 동의한 항목이 아니면(별칭 변경, 손으로 뺀 항목) 프로젝트에서 고친 사본은 지우지 않는다
      const consented = o.items.some(i => decisions[i]?.action === 'remove');
      if (!consented && !force && sha256(cur) !== o.hash) {
        todos.push({ kind: 'leftover', item: null, message: t('todo.leftoverDropped', { path: o.path }) });
        continue;
      }
      files[o.path] = null;
      continue;
    }
    const r = setPart(toml, o, null);
    if (!r.conflict) toml = r.text;
  }

  // 잠금이 모르는 사본은 항목 단위로, 그 항목의 사본이 모두 원본으로 만든 것과 같을 때만 지운다.
  // 하나라도 다르면 프로젝트에서 고친 것일 수 있어 그 항목은 하나도 지우지 않는다.
  if (unlockedRemovals.length > 0) {
    const { outputs: gone } = desiredOutputs({ tree, manifest, items: unlockedRemovals, rulerAgentsEnabled: project.rulerAgentsEnabled });
    const byItem = new Map();
    const ownedLeft = new Set();
    for (const d of gone) {
      if (desiredKeys.has(keyOf(d))) continue;
      const cur = d.key ? partOfText(toml, d) : fileNow(d.path);
      if (cur === null) continue;
      if (d.owned) {
        ownedLeft.add(label(d));
        continue;
      }
      for (const id of d.items) {
        if (!byItem.has(id)) byItem.set(id, []);
        byItem.get(id).push({ d, same: eq(cur, desiredPart(d)) });
      }
    }
    for (const [id, list] of byItem) {
      const differ = list.filter(x => !x.same);
      if (differ.length > 0) {
        leftover(id, differ.map(x => label(x.d)).join(', '));
        continue;
      }
      for (const { d } of list) {
        if (!d.key) files[d.path] = null;
        else {
          const r = setPart(toml, d, null);
          if (!r.conflict) toml = r.text;
        }
      }
    }
    for (const where of [...ownedLeft].sort()) {
      todos.push({ kind: 'leftover', item: null, message: t('todo.leftoverGenerated', { where }) });
    }
  }
  for (const p of orphans) files[p] = null;
  if (toml !== original) files[TOML] = Buffer.from(toml);

  return { files, lock: { version: 1, revision, sources, outputs }, todos };
}
