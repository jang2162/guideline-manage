import fs from 'node:fs';
import path from 'node:path';
import { inspect, itemDiff } from './inspect.js';
import { currentPart, blockedReason } from './render/index.js';
import { desiredOutputs, desiredPart, isRootOnly, ROOT_ONLY_REASON } from './render/outputs.js';
import { sha256, itemHash, treeHashes } from './hashes.js';
import { stackFiles, stackSetup } from './catalog.js';
import { itemKey } from './selection.js';
import { AGENTS } from './manifest.js';
import { t } from './i18n.js';

const RULE = /^rules\/([^/]+)\/(\d{2}-[a-z0-9][a-z0-9-]*\.md)$/;
const SETUP = /^rules\/([^/]+)\/SETUP\.md$/;
const DIFF_ITEM_MAX = 64 * 1024;
const DIFF_TOTAL_MAX = 1024 * 1024;
const keyOf = o => `${o.path}\0${o.key ?? ''}`;

/** 상태 이름의 순서(요약 줄). */
export const STATE_ORDER = ['current', 'upstream', 'local', 'both', 'gone', 'removed', 'unsynced'];

const STATE_LABELS = {
  current: () => t('state.current'), upstream: () => t('state.upstream'), local: () => t('state.local'), both: () => t('state.both'),
  gone: () => t('state.gone'), removed: () => t('state.removed'), unsynced: () => t('state.unsynced'),
};

/** 상태의 사용자용 이름. */
export function stateLabel(state) {
  return STATE_LABELS[state]?.() ?? state;
}

/** .ruler/ruler.toml 의 [agents] 표에 enabled = true 가 있는가. */
export function rulerAgentsEnabled(project) {
  const file = path.join(project, '.ruler', 'ruler.toml');
  if (!fs.existsSync(file)) return false;
  let inAgents = false;
  for (const l of fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const h = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(l);
    if (h) {
      inAgents = h[1].trim() === 'agents';
      continue;
    }
    if (inAgents && /^\s*enabled\s*=\s*true\s*(?:#.*)?$/.test(l)) return true;
  }
  return false;
}

/** render 가 쓰는 디스크 읽기. */
export function diskReader(project) {
  const abs = rel => path.join(project, ...rel.split('/'));
  return {
    read(rel) {
      try {
        return fs.readFileSync(abs(rel));
      } catch {
        return null;
      }
    },
    exists: rel => fs.existsSync(abs(rel)),
    rulerAgentsEnabled: rulerAgentsEnabled(project),
  };
}

/** 매니페스트가 없는 기존 프로젝트의 에이전트: .ruler/ruler.toml 의 default_agents. */
export function inferAgents(project) {
  const file = path.join(project, '.ruler', 'ruler.toml');
  const m = fs.existsSync(file) ? /^\s*default_agents\s*=\s*\[([^\]]*)\]/m.exec(fs.readFileSync(file, 'utf8')) : null;
  const list = m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).filter(a => AGENTS.includes(a)) : [];
  return list.length ? [...new Set(list)] : ['claude', 'codex'];
}

export function kindOf(id) {
  if (SETUP.test(id)) return 'setup';
  if (id.startsWith('rules/')) return 'rule';
  if (id.startsWith('skills/')) return 'skill';
  if (id.startsWith('agents/')) return 'subagent';
  return 'mcp';
}

const stackOf = id => RULE.exec(id)?.[1] ?? SETUP.exec(id)?.[1] ?? null;

/**
 * 매니페스트 항목마다 잠금 기준 상태와, 잠금 출력마다 디스크 상태.
 * 디스크 사본이 최신 원본으로 만든 것과 같으면(제안이 수락된 뒤) 그 출력은 current 로 본다.
 * @returns {{ states: Map<string, string>, outputs: object[] }}
 */
export function itemStates({ tree, reader, manifest, lock, nested = false, management = {} }) {
  const hashes = treeHashes(tree);
  const live = manifest.items.filter(id => itemHash(hashes, id) !== null && !blockedReason(tree, id, nested));
  const want = new Map(desiredOutputs({ tree, manifest, items: live, rulerAgentsEnabled: reader.rulerAgentsEnabled, management }).outputs
    .map(d => [keyOf(d), desiredPart(d)]));
  const outputs = lock.outputs.map(o => {
    const cur = currentPart(reader, o);
    let state = 'local';
    if (cur === null) state = 'gone';
    else if (sha256(cur) === o.hash) state = 'current';
    else if (want.has(keyOf(o)) && Buffer.from(cur).equals(Buffer.from(want.get(keyOf(o))))) state = 'current';
    return { ...o, state };
  });
  const states = new Map();
  for (const id of manifest.items) {
    const h = itemHash(hashes, id);
    if (h === null) {
      states.set(id, 'removed');
      continue;
    }
    // 첫 반영에서 이미 있는 것과 충돌해 원본 해시를 남기지 않은 항목
    if (!Object.hasOwn(lock.sources, id)) {
      states.set(id, 'unsynced');
      continue;
    }
    const mine = outputs.filter(o => o.items.includes(id));
    const upstream = lock.sources[id] !== h;
    const local = mine.some(o => o.state === 'local');
    const gone = mine.some(o => o.state === 'gone');
    states.set(id, local && upstream ? 'both' : local ? 'local' : gone ? 'gone' : upstream ? 'upstream' : 'current');
  }
  return { states, outputs };
}

/** 매니페스트에 지침 파일이 있는 스택의, 고르지 않은 지침 파일·세팅 문서. */
export function newFiles(tree, manifest) {
  const chosen = new Set(manifest.items);
  const stacks = [...new Set(manifest.items.map(stackOf).filter(Boolean))].sort();
  const out = [];
  for (const s of stacks) {
    for (const f of stackFiles(s, tree)) if (!chosen.has(f)) out.push(f);
    if (stackSetup(s, tree) && !chosen.has(`rules/${s}/SETUP.md`)) out.push(`rules/${s}/SETUP.md`);
  }
  return out;
}

/** status·update 가 내는 할 일(잠금 상태에서 나오는 것). */
export function statusTodos(states, fresh, show = id => id) {
  const todos = [];
  for (const [id, s] of states) {
    if (s === 'removed') todos.push({ kind: 'removed-upstream', item: show(id), message: t('todo.removedUpstream', { item: show(id) }) });
    if (s === 'unsynced') todos.push({ kind: 'conflict', item: show(id), message: t('todo.unsynced', { item: show(id) }) });
  }
  for (const f of fresh) todos.push({ kind: 'new-file', item: show(f), message: t('todo.newFile', { item: show(f) }) });
  return todos;
}

/**
 * 폼에 올릴 항목. 잠금에 있는 항목은 잠금 상태(lockState)로, 나머지는 0.10 비교로 판정한다.
 * 중첩 단위면 루트 전용 항목은 막는다.
 * @param {{ tree: object, project: string | null, manifest: object | null, lock: object | null, reader: object | null, nested?: boolean }} opts
 */
export function formItems({ tree, project, manifest, lock, reader, nested = false, management = {} }) {
  const ins = inspect(tree, project);
  const block = items => (nested
    ? items.map(i => (isRootOnly(i.id) && i.kind !== 'orphan' ? { ...i, state: 'blocked', reason: ROOT_ONLY_REASON() } : i))
    : items);
  if (!manifest || !lock) return { ...ins, items: block(ins.items) };
  const { states } = itemStates({ tree, reader, manifest, lock, nested, management });
  const lockPaths = new Set(lock.outputs.map(o => o.path));
  const items = ins.items
    .filter(i => i.kind !== 'orphan' || !lockPaths.has(i.id))
    .map(i => {
      const ls = states.get(i.id);
      if (!ls || ls === 'unsynced' || i.state === 'blocked') return i;
      return { ...i, state: ls === 'current' ? 'same' : 'different', lockState: ls };
    });
  for (const [id, ls] of states) {
    if (ls !== 'removed') continue;
    const stack = stackOf(id);
    items.push({ kind: kindOf(id), id, ...(stack ? { stack } : {}), state: 'present', lockState: 'removed' });
  }
  return { ...ins, items: block(items) };
}

/**
 * 서버 폼에 올리는 본문. MCP 는 inspect·itemDiff 가 키 경로만 내므로 값이 실리지 않는다.
 */
export function formPayload({ tree, revision, projectPath, isNew, agents, status, manifest, lock, nested = false, rootStacks = [], management = {} }) {
  const project = isNew ? null : projectPath;
  const { items, overrides } = formItems({ tree, project, manifest, lock, reader: project ? diskReader(project) : null, nested, management });
  const diffs = {};
  let total = 0;
  if (project) {
    for (const it of items) {
      if (!['different', 'moved'].includes(it.state) || !it.where) continue;
      let d;
      try {
        d = itemDiff(tree, project, it);
      } catch {
        continue;
      }
      const size = JSON.stringify(d).length;
      if (size > DIFF_ITEM_MAX || total + size > DIFF_TOTAL_MAX) d = { files: [{ path: it.id, diff: t('diff.tooBig') }] };
      else total += size;
      diffs[itemKey(it)] = d;
    }
  }
  return {
    revision,
    project: {
      name: path.basename(projectPath), path: projectPath, form: 'ruler', instructionFiles: [],
      agents, isNew, gitRepo: status.gitRepo, dirty: status.dirty, nested, rootStacks,
    },
    items,
    overrides,
    diffs,
  };
}
