import fs from 'node:fs';
import path from 'node:path';
import { inspect, itemDiff } from './inspect.js';
import { currentPart, blockedReason } from './render/index.js';
import { desiredOutputs, desiredPart, isRootOnly, ROOT_ONLY_REASON } from './render/outputs.js';
import { desiredCopies } from './render/copies.js';
import { sha256, itemHash, treeHashes } from './hashes.js';
import { expandBlocks } from './catalog.js';
import { blockKey, isBlockKey } from './blocks.js';
import { itemKey } from './selection.js';
import { AGENTS } from './manifest.js';
import { rulerTomlText } from './layout.js';
import { t } from './i18n.js';

const RULE = /^rules\/(.+)\/(\d{2}-[a-z0-9][a-z0-9-]*\.md)$/;
const SETUP = /^rules\/(.+)\/SETUP\.md$/;
const DIFF_ITEM_MAX = 64 * 1024;
const DIFF_TOTAL_MAX = 1024 * 1024;
const keyOf = o => `${o.path}\0${o.key ?? ''}`;

/** 잠금이 말하는 배치. 잠금 version 3 이면 새 배치(.guideline/ 사본). */
const lockLayout = lock => (lock?.version === 3 ? 'guideline' : 'ruler');

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

/** ruler 설정(.ruler/ruler.project.toml, 없으면 ruler.toml)의 [agents] 표에 enabled = true 가 있는가. */
export function rulerAgentsEnabled(project) {
  const text = rulerTomlText(project);
  if (text === null) return false;
  let inAgents = false;
  for (const l of text.replace(/\r\n/g, '\n').split('\n')) {
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

/** 매니페스트가 없는 기존 프로젝트의 에이전트: ruler 설정(.ruler/ruler.project.toml, 없으면 ruler.toml)의 default_agents. */
export function inferAgents(project) {
  const text = rulerTomlText(project);
  const m = text === null ? null : /^\s*default_agents\s*=\s*\[([^\]]*)\]/m.exec(text);
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

/** 지침 파일·세팅 문서·스택 키의 스택 경로. 원본에서 통째로 사라진 스택은 스택 키(`rules/gone`)로 남아 있다. */
const stackOf = id => RULE.exec(id)?.[1] ?? SETUP.exec(id)?.[1]
  ?? (id.startsWith('rules/') && isBlockKey(id) ? id.slice('rules/'.length) : null);

/**
 * 매니페스트 항목마다 잠금 기준 상태와, 잠금 출력마다 디스크 상태.
 * 디스크 사본이 최신 원본으로 만든 것과 같으면(제안이 수락된 뒤) 그 출력은 current 로 본다.
 * 매니페스트의 스택 키는 입구에서 그 스택의 파일로 펼친다. 상태는 파일 id 마다 낸다(원본에 없는 스택 키는 그대로 removed).
 * 새 배치(layout guideline)면 잠금 출력이 .guideline/ 사본이고, 최신 원본으로 만든 것도 사본(원본 바이트)이다.
 * layout 을 주지 않으면 잠금 version 3 이 새 배치다(가상 잠금은 version 을 잃으므로 명령은 layout 을 넘긴다).
 * @returns {{ states: Map<string, string>, outputs: object[] }}
 */
export function itemStates({ tree, reader, manifest, lock, nested = false, management = {}, layout = lockLayout(lock) }) {
  const hashes = treeHashes(tree);
  const items = expandBlocks(tree, manifest.items);
  const live = items.filter(id => itemHash(hashes, id) !== null && !blockedReason(tree, id, nested));
  const desired = layout === 'guideline' ? desiredCopies : desiredOutputs;
  const want = new Map(desired({ tree, manifest, items: live, rulerAgentsEnabled: reader.rulerAgentsEnabled, management }).outputs
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
  for (const id of items) {
    const h = itemHash(hashes, id);
    if (h === null) {
      states.set(id, 'removed');
      continue;
    }
    if (!Object.hasOwn(lock.sources, id)) {
      // 지침 파일·세팅 문서는 이미 있는 사본을 받아들이므로 충돌하지 않는다 — 잠금에 없으면 고른 스택에 새로 생긴 것이라 update 가 쓴다.
      // 나머지는 첫 반영에서 이미 있는 것과 충돌해 원본 해시를 남기지 않은 항목이다.
      states.set(id, RULE.test(id) || SETUP.test(id) ? 'upstream' : 'unsynced');
      continue;
    }
    const mine = outputs.filter(o => o.items.includes(id));
    const upstream = lock.sources[id] !== h;
    const local = mine.some(o => o.state === 'local');
    const gone = mine.some(o => o.state === 'gone');
    states.set(id, local && upstream ? 'both' : local ? 'local' : gone ? 'gone' : upstream ? 'upstream' : 'current');
  }
  // 고른 스택에서 원본이 뺀 파일: 펼친 items 에 없지만 잠금에 있다. update 가 지우므로(고친 사본이면 남기고 leftover) 할 일 없는
  // upstream, 프로젝트에서 고쳤으면 both. 원본에 남아 있는 스택(펼쳐진 키)의 바로 그 스택 파일만 본다 — 통째로 사라진 하위 스택은
  // 그 키가 removed 로 남고 render 가 사본을 그대로 두므로, 부모 스택이 있다고 여기서 upstream 으로 보이면 안 된다.
  const chosen = new Set(items);
  const expanded = new Set(manifest.items.filter(k => k.startsWith('rules/') && !chosen.has(k)));
  for (const id of Object.keys(lock.sources).sort()) {
    if (chosen.has(id) || !expanded.has(blockKey(id) ?? '')) continue;
    const local = outputs.some(o => o.items.includes(id) && o.state === 'local');
    states.set(id, local ? 'both' : 'upstream');
  }
  return { states, outputs };
}

/** status·update 가 내는 할 일(잠금 상태에서 나오는 것). */
export function statusTodos(states, show = id => id) {
  const todos = [];
  for (const [id, s] of states) {
    if (s === 'removed') todos.push({ kind: 'removed-upstream', item: show(id), message: t('todo.removedUpstream', { item: show(id) }) });
    if (s === 'unsynced') todos.push({ kind: 'conflict', item: show(id), message: t('todo.unsynced', { item: show(id) }) });
  }
  return todos;
}

/**
 * 폼에 올릴 항목. 잠금에 있는 항목은 잠금 상태(lockState)로, 나머지는 0.10 비교로 판정한다.
 * 중첩 단위면 루트 전용 항목은 막는다. 새 배치면 .guideline/ 사본과 원본을 비교한다.
 * @param {{ tree: object, project: string | null, manifest: object | null, lock: object | null, reader: object | null, nested?: boolean,
 *   layout?: 'ruler' | 'guideline' | 'none' }} opts
 */
export function formItems({ tree, project, manifest, lock, reader, nested = false, management = {}, layout = lockLayout(lock) }) {
  const ins = inspect(tree, project, { layout });
  const block = items => (nested
    ? items.map(i => (isRootOnly(i.id) && i.kind !== 'orphan' ? { ...i, state: 'blocked', reason: ROOT_ONLY_REASON() } : i))
    : items);
  if (!manifest || !lock) return { ...ins, items: block(ins.items) };
  const { states } = itemStates({ tree, reader, manifest, lock, nested, management, layout });
  // 잠금이 아는 사본은 고아가 아니다(원본에서 사라진 항목으로 올라간다). 새 배치의 스킬·MCP 고아는 디렉터리라 그 아래 출력을 본다.
  const inLock = id => lock.outputs.some(o => o.path === id || o.path.startsWith(`${id}/`));
  const items = ins.items
    .filter(i => i.kind !== 'orphan' || !inLock(i.id))
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
export function formPayload({
  tree, revision, projectPath, isNew, agents, status, manifest, lock, nested = false, rootStacks = [], management = {}, layout = lockLayout(lock),
}) {
  const project = isNew ? null : projectPath;
  const { items, overrides } = formItems({ tree, project, manifest, lock, reader: project ? diskReader(project) : null, nested, management, layout });
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
    // 스택 단위 선택(하위 스택)을 아는 폼 본문. 이것을 모르는 옛 서버는 응답에 formVersion 을 싣지 않는다.
    formVersion: 2,
    project: {
      name: path.basename(projectPath), path: projectPath, form: 'ruler', instructionFiles: [],
      agents, isNew, gitRepo: status.gitRepo, dirty: status.dirty, nested, rootStacks,
    },
    items,
    overrides,
    diffs,
  };
}
