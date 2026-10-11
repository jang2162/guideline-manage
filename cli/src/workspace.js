import fs from 'node:fs';
import path from 'node:path';
import { remoteClient, loadSource, loadRevision, explain } from './remote.js';
import { getToken } from './credentials.js';
import { qualify, splitQualified, readManifest } from './manifest.js';
import { sourceView, mergeViews, toVirtual, realOf, aliasProblems, unitOf, finalUnit, unitName, collisions, collisionMessage } from './sources.js';
import { readText } from './tree.js';
import { blockKeys, elementRequires } from './catalog.js';
import { t } from './i18n.js';

// 여러 출처의 원본을 받아 하나의 가상 원본으로 합치고(렌더링·상태 코드가 그대로 쓰게), 결과 잠금을 출처 붙은 id 로 되돌린다.

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const trim = s => s.replace(/\/+$/, '');

/**
 * 그 서버의 토큰. GUIDELINE_TOKEN 은 출처가 하나일 때만 쓴다 — 여럿이면 어느 서버의 토큰인지 알 수 없다.
 * @param {string} server
 * @param {{ env?: object, home?: string, single?: boolean }} opts
 */
export function tokenFor(server, { env = process.env, home, single = true } = {}) {
  if (single && env.GUIDELINE_TOKEN) return env.GUIDELINE_TOKEN;
  return getToken(server, { env: { ...env, GUIDELINE_TOKEN: '' }, home });
}

/** 출처가 하나면 그 서버 주소. 아니면 null. */
export function soleServer(manifest) {
  const names = Object.keys(manifest?.sources ?? {});
  return names.length === 1 ? trim(manifest.sources[names[0]].server) : null;
}

/**
 * 매니페스트의 이름 겹침을 사용자에게 보일 문장들. 겹치면 렌더링하지 않는다.
 * @param {import('./manifest.js').Manifest} manifest
 * @returns {string[]}
 */
export function manifestClashes(manifest) {
  return collisions(Object.entries(manifest.sources).map(([name, s]) => ({ name, items: s.items, aliases: s.aliases ?? {} })))
    .map(collisionMessage);
}

/**
 * 출처마다 원본 트리를 받는다. latest 에 든 출처는 최신, 나머지는 잠금의 리비전(없으면 최신).
 * only 를 주면 그 출처만 받는다. 한 출처가 실패해도 나머지는 받는다.
 * single 은 매니페스트 전체의 출처가 하나인지다 — 일부만 받을 때도 GUIDELINE_TOKEN 을 다른 서버로 보내지 않게.
 * @param {{ manifest: import('./manifest.js').Manifest, lock: import('./manifest.js').Lock | null, latest: Set<string>,
 *   only?: string[], single?: boolean, env?: object, home?: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ trees: Map<string, { server: string, revision: number, tree: import('./tree.js').Tree, client: object }>,
 *   failures: { source: string, message: string }[] }>}
 */
export async function fetchSources({
  manifest, lock, latest, only, single = Object.keys(manifest.sources).length === 1, env = process.env, home, fetchImpl = fetch,
}) {
  const names = (only ?? Object.keys(manifest.sources)).filter(n => Object.hasOwn(manifest.sources, n)).sort(byStr);
  const trees = new Map();
  const failures = [];
  for (const name of names) {
    const server = trim(manifest.sources[name].server);
    // 토큰이 없으면 없이 부른다. 공개 서버(PUBLIC_READ)는 받아 주고, 비공개면 401 이 로그인 안내가 된다.
    const token = tokenFor(server, { env, home, single });
    const client = remoteClient({ server, token, fetchImpl });
    const rev = lock?.revisions?.[name];
    try {
      if (latest.has(name) || !rev) {
        const src = await loadSource(client);
        trees.set(name, { server, revision: src.revision, tree: src.tree, client });
      } else {
        trees.set(name, { server, revision: rev, tree: await loadRevision(client, rev), client });
      }
    } catch (e) {
      failures.push({ source: name, message: explain(e, server) });
    }
  }
  return { trees, failures };
}

const stackDir = p => /^\.ruler\/([^/]+)\//.exec(p)?.[1] ?? null;
const NOT_STACK = new Set(['skills', 'agents']);

/**
 * 닿지 못한 출처가 있을 때 건드리지 않을 생성물 경로: 그 출처 최종 스택의 색인, 관리 지침, docs/guideline/README.md.
 * 그 출처의 원본 없이 다시 만들면 내용이 빠지기 때문이다. 이 경로들은 렌더링에서 빼고 잠금의 이전 것을 옮긴다.
 * @param {{ manifest: object, lock: object | null, failed: string[] }} opts
 * @returns {Set<string>}
 */
export function protectedPaths({ manifest, lock, failed }) {
  const out = new Set();
  if (!failed.length || !lock) return out;
  const stacks = new Set();
  for (const name of failed) {
    const s = manifest.sources[name];
    for (const id of s?.items ?? []) {
      const u = unitOf(id);
      if (u?.startsWith('rules/')) stacks.add(unitName(finalUnit(u, s.aliases ?? {})));
    }
  }
  for (const o of lock.outputs) {
    if (o.items.length) continue;
    const d = stackDir(o.path);
    if (o.path === '.ruler/guideline.md' || o.path === 'docs/guideline/README.md' || (d && stacks.has(d))) out.add(o.path);
  }
  return out;
}

/**
 * 받은 출처들을 별칭을 입혀 하나의 가상 원본으로 합친다.
 * 잠금은 받은 출처와 매니페스트에서 빠진 출처의 것을 가상 id 로 옮긴다. 받지 못한 출처의 것은 빼서 렌더링이 건드리지 않게 한다.
 * @param {{ manifest: import('./manifest.js').Manifest, lock: import('./manifest.js').Lock | null,
 *   trees: Map<string, { tree: import('./tree.js').Tree, server?: string }> }} opts
 */
export function virtualize({ manifest, lock, trees, protect = new Set() }) {
  const sources = [...trees.keys()].sort(byStr).map(name => ({
    name,
    server: trees.get(name).server ?? manifest.sources[name]?.server,
    items: manifest.sources[name]?.items ?? [],
    aliases: manifest.sources[name]?.aliases ?? {},
  }));
  const byName = new Map(sources.map(s => [s.name, s]));
  // 최종 단위의 주인: 그 단위를 고른 출처(받지 못한 출처 포함). 다른 출처의 같은 이름 단위는 그 출처의 가상 트리에서 뺀다.
  const owner = new Map();
  for (const [name, s] of Object.entries(manifest.sources).sort(([x], [y]) => byStr(x, y))) {
    for (const id of s.items) {
      const u = unitOf(id);
      if (u) {
        const f = finalUnit(u, s.aliases ?? {});
        if (!owner.has(f)) owner.set(f, name);
      }
    }
  }
  const others = name => new Set([...owner].filter(([, o]) => o !== name).map(([f]) => f));
  const tree = mergeViews(sources.map(s => sourceView(trees.get(s.name).tree, s.aliases, others(s.name))));
  const items = sources.flatMap(s => s.items.map(id => toVirtual(id, s.aliases)));
  const view = { version: 1, form: 'ruler', instructionFiles: [], agents: manifest.agents, items };

  let viewLock = null;
  if (lock) {
    // 받지 못한 출처(매니페스트에는 있음)만 뺀다. 매니페스트에서 빠진 출처는 지워야 하므로 별칭 없이 옮긴다.
    const handled = source => byName.has(source) || !Object.hasOwn(manifest.sources, source);
    const toV = q => {
      const { source, id } = splitQualified(q);
      return toVirtual(id, byName.get(source)?.aliases ?? {});
    };
    const vSources = {};
    for (const [q, h] of Object.entries(lock.sources)) if (handled(splitQualified(q).source)) vSources[toV(q)] = h;
    const outputs = lock.outputs
      .filter(o => !protect.has(o.path))
      .filter(o => o.items.length === 0 || o.items.some(i => handled(splitQualified(i).source)))
      .map(o => ({ ...o, items: o.items.map(toV) }));
    viewLock = { version: 1, revision: 1, sources: vSources, outputs };
  }

  const stackSource = {};
  for (const s of sources) {
    for (const id of s.items) {
      const u = unitOf(id);
      if (u?.startsWith('rules/')) stackSource[unitName(finalUnit(u, s.aliases))] = s.name;
    }
  }
  const additions = sources
    .filter(s => s.items.length > 0)
    .map(s => ({ source: s.name, text: readText(trees.get(s.name).tree, 'docs/management.md') }))
    .filter(a => a.text !== null);
  const management = { stackSource: sources.length > 1 ? stackSource : null, additions };
  const problems = sources.flatMap(s => aliasProblems(s, trees.get(s.name).tree));
  const many = Object.keys(manifest.sources).length > 1;
  return { tree, view, viewLock, management, sources, problems, many };
}

/**
 * 렌더링이 낸 가상 잠금을 출처 붙은 id 의 잠금으로. keep 에 든 출처는 previous 의 것을 그대로 옮긴다.
 * @param {{ viewLock: { sources: Record<string, string>, outputs: object[] }, sources: object[], revisions: Record<string, number>,
 *   previous?: import('./manifest.js').Lock | null, keep?: string[] }} opts
 * @returns {import('./manifest.js').Lock}
 */
export function toRealLock({ viewLock, sources, revisions, previous = null, keep = [], protect = new Set() }) {
  const real = id => {
    const r = realOf(id, sources);
    return r ? qualify(r.source, r.id) : null;
  };
  const out = { version: 2, revisions: { ...revisions }, sources: {}, outputs: [] };
  for (const [id, h] of Object.entries(viewLock.sources)) {
    const q = real(id);
    if (q) out.sources[q] = h;
  }
  for (const o of viewLock.outputs) if (!protect.has(o.path)) out.outputs.push({ ...o, items: o.items.map(real).filter(Boolean) });
  if (previous) {
    const kept = new Set(keep);
    for (const name of kept) if (previous.revisions[name]) out.revisions[name] = previous.revisions[name];
    for (const [q, h] of Object.entries(previous.sources)) if (kept.has(splitQualified(q).source)) out.sources[q] = h;
    for (const o of previous.outputs) {
      if (protect.has(o.path) || (o.items.length && o.items.every(i => kept.has(splitQualified(i).source)))) out.outputs.push(o);
    }
  }
  return out;
}


/**
 * 별칭이 바뀌어 사본이 옮겨 간 스택 자리에 남은 바꿈 파일을 알린다. 바꿈은 프로젝트 소유라 옮기지 않는다.
 * @param {{ previous: import('./manifest.js').Lock | null, next: import('./manifest.js').Lock, project: string }} opts
 */
export function aliasMoveTodos({ previous, next, project }) {
  if (!previous) return [];
  const dirs = lock => new Set(lock.outputs.map(o => stackDir(o.path)).filter(d => d && !NOT_STACK.has(d)));
  const now = dirs(next);
  const out = [];
  for (const d of [...dirs(previous)].sort(byStr)) {
    if (now.has(d)) continue;
    const base = path.join(project, '.ruler', d);
    const which = fs.existsSync(path.join(base, 'override.md')) ? 'override.md' : fs.existsSync(path.join(base, 'override.d')) ? 'override.d/' : null;
    if (which) out.push({ kind: 'alias', item: null, message: t('todo.aliasMoved', { dir: d, file: which }) });
  }
  return out;
}

/**
 * 받은 블록이 requires 로 요구하는데 받지 않은 블록을 알리는 할 일. 요구하는 블록 하나에 하나.
 * 출처마다 그 출처의 원본 requires 와 매니페스트의 실제 id(별칭을 입히기 전)로 판정한다 — requires 는 원본 키라
 * 별칭을 입히지 않은 쪽끼리 견줘야 맞고, 다른 출처의 같은 이름 블록은 다른 블록이다.
 * 스택은 그 스택의 파일이 하나라도 받혀 있으면 받은 것이다. 원본에 없는 블록은 pick 으로 더할 수 없으므로 알리지 않는다.
 * @param {{ manifest: import('./manifest.js').Manifest, trees: Map<string, { tree: import('./tree.js').Tree }>, many: boolean }} opts
 */
export function missingRequiresTodos({ manifest, trees, many }) {
  const out = [];
  for (const name of [...trees.keys()].sort(byStr)) {
    const tree = trees.get(name).tree;
    const received = new Set((manifest.sources[name]?.items ?? []).map(unitOf).filter(Boolean));
    const { requires } = elementRequires(tree);
    const exists = blockKeys(tree);
    for (const unit of [...received].sort(byStr)) {
      const missing = (requires[unit] ?? []).filter(k => !received.has(k) && exists.has(k));
      if (!missing.length) continue;
      const item = many ? qualify(name, unit) : unit;
      out.push({ kind: 'missing-requires', item, message: t('todo.missingRequires', { item, missing: missing.join(', ') }), data: { missing } });
    }
  }
  return out;
}

/** 사용자에게 보일 항목 표시. 매니페스트의 출처가 둘 이상이면 `<출처>:<원래 id>`, 하나면 원래 id. */
export function showId(viewId, sources, many = sources.length > 1) {
  const r = realOf(viewId, sources);
  if (!r) return viewId;
  return many ? qualify(r.source, r.id) : r.id;
}

/**
 * 서버 하나를 다루는 명령(source·list)의 서버 주소와 토큰. --source 면 cwd 매니페스트의 그 출처,
 * 아니면 --server > 출처가 하나인 매니페스트 > GUIDELINE_SERVER.
 * @returns {{ url: string | null, token: string | null, error?: string }}
 */
export function serverFor({ flag, sourceName, cwd, env = process.env, home }) {
  let manifest = null;
  try {
    manifest = readManifest(cwd);
  } catch {
    manifest = null;
  }
  const many = Object.keys(manifest?.sources ?? {}).length > 1;
  let url;
  if (sourceName !== undefined) {
    const s = manifest?.sources[sourceName];
    if (!s) return { url: null, token: null, error: t('workspace.unknownSource', { name: sourceName, dir: cwd }) };
    url = trim(s.server);
  } else {
    url = flag ? trim(flag) : soleServer(manifest) ?? (env.GUIDELINE_SERVER ? trim(env.GUIDELINE_SERVER) : null);
  }
  return { url, token: url ? tokenFor(url, { env, home, single: !many }) : null };
}
