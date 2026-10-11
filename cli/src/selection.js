// 서버와 폼 화면이 함께 쓴다. 브라우저에서도 돌아야 하므로 아무것도 import 하지 않는다.

/** 프로젝트에 있는 상태. 체크를 풀면 제거다. */
const PRESENT = ['same', 'different', 'moved', 'present'];
/** 갱신 토글을 둘 수 있는 상태. */
const UPDATABLE = ['different', 'moved', 'present'];
/** 잠금 상태 중 갱신 토글을 둘 수 있는 것과 처음부터 켤 것, 덮어쓰기 토글을 둘 것. */
const LOCK_UPDATABLE = ['upstream', 'gone'];
const LOCK_UPDATE_ON = ['upstream', 'gone'];
const LOCK_OVERWRITE = ['local', 'both'];

/** 폼의 체크 상태 키. */
export function itemKey(item) {
  return `${item.kind}:${item.id}`;
}

/** 판정 직후의 체크 상태. 프로젝트에 있는 것과 원본에서 사라진 것이 켜져 있다. 잠금에서 원본만 바뀐 것은 갱신이 켜져 있다. */
export function defaultChoice(item) {
  const choice = { checked: item.state === 'orphan' || PRESENT.includes(item.state), update: LOCK_UPDATE_ON.includes(item.lockState) };
  return LOCK_OVERWRITE.includes(item.lockState) ? { ...choice, overwrite: false } : choice;
}

/** 갱신 토글을 둘 수 있는가. */
export function canUpdate(item) {
  return item.lockState ? LOCK_UPDATABLE.includes(item.lockState) : UPDATABLE.includes(item.state);
}

/** 덮어쓰기 토글을 둘 수 있는가(프로젝트에서 고친 잠금 항목). */
export function canOverwrite(item) {
  return LOCK_OVERWRITE.includes(item.lockState);
}

/**
 * 한 항목의 action. 결과에 내지 않을 항목이면 null.
 * @param {{ state: string }} item
 * @param {{ checked: boolean, update?: boolean }} choice
 * @returns {'add' | 'update' | 'remove' | 'keep' | null}
 */
export function actionOf(item, choice) {
  if (item.state === 'blocked') return null;
  if (item.state === 'orphan') return choice.checked ? null : 'remove';
  if (!choice.checked) return PRESENT.includes(item.state) ? 'remove' : null;
  if (item.state === 'missing' || item.state === 'unknown') return 'add';
  if (item.state === 'same') return 'keep';
  return choice.update ? 'update' : 'keep';
}

/**
 * 결과 JSON 의 items. choices 에 없는 항목은 defaultChoice 를 쓴다.
 * @param {object[]} items inspect 의 items
 * @param {Record<string, { checked: boolean, update?: boolean }>} choices
 * @returns {object[]}
 */
export function selectionItems(items, choices) {
  const out = [];
  for (const item of items) {
    const choice = choices[itemKey(item)] ?? defaultChoice(item);
    const action = actionOf(item, choice);
    if (!action) continue;
    const overwrite = action !== 'remove' && canOverwrite(item) && choice.overwrite === true;
    out.push({ ...item, action, ...(overwrite ? { overwrite: true } : {}) });
  }
  return out;
}

/** 더함·갱신·제거 개수. */
export function summarize(items, choices) {
  const counts = { add: 0, update: 0, remove: 0 };
  for (const it of selectionItems(items, choices)) {
    if (Object.hasOwn(counts, it.action)) counts[it.action]++;
  }
  return counts;
}

/**
 * pick 이 stdout 에 내는 결과.
 * @param {{ docsRoot: string, project: object, inspection: { items: object[], overrides: object[] }, choices: object }} opts
 */
export function buildResult({ docsRoot, project, inspection, choices }) {
  return {
    version: 1,
    docsRoot,
    project,
    items: selectionItems(inspection.items, choices),
    overrides: inspection.overrides,
    // 원본 경고로 반영할 수 없는 항목. items 에서 빠지므로, 에이전트가 사본·색인을 그대로 두고 보고하게 따로 낸다.
    blocked: inspection.items
      .filter(i => i.state === 'blocked')
      .map(({ kind, id, stack, reason }) => ({ kind, id, stack, reason })),
  };
}

/**
 * 서버 폼의 결과. 서버가 폼 본문의 항목과 화면의 체크로 계산한다.
 * @param {{ revision: number, items: object[], choices: object, project: { form: string, agents: string[] } | null }} opts
 */
export function buildSelection({ revision, items, choices, project }) {
  return {
    version: 1,
    revision,
    project,
    items: selectionItems(items, choices).map(({ kind, id, action, overwrite, state, lockState }) => ({
      kind, id, action, ...(overwrite ? { overwrite } : {}), state, ...(lockState ? { lockState } : {}),
    })),
    blocked: items.filter(i => i.state === 'blocked').map(({ kind, id, stack, reason }) => ({ kind, id, stack, reason })),
  };
}

/**
 * 항목·경로 id 의 블록 키(rules/<스택>, skills/<이름>, agents/<이름>.md, mcp/<이름>). 블록이 아니면 null.
 * sources.js 의 unitOf 와 같다 — 이 파일은 브라우저에서도 돌아 import 하지 않고 복제한다(테스트가 둘을 묶는다).
 * @param {string} id
 */
export function blockKey(id) {
  const parts = id.split('/');
  if (parts.length < 2 || !parts[1]) return null;
  if (parts[0] === 'rules' || parts[0] === 'skills' || parts[0] === 'mcp') return `${parts[0]}/${parts[1]}`;
  if (parts[0] === 'agents' && parts.length === 2 && parts[1].endsWith('.md')) return id;
  return null;
}

const STEP_OF_KIND = { rule: 'rules', setup: 'rules', mcp: 'mcp', subagent: 'agents', skill: 'skills' };
const STEP_OF_DIR = { rules: 'rules', mcp: 'mcp', agents: 'agents', skills: 'skills' };

/**
 * 폼 항목이 놓일 단계. 원본에서 사라진 항목은 경로 앞 조각으로 정하고, 모르면 지침 단계.
 * @param {{ kind: string, id: string }} item
 * @returns {'rules' | 'mcp' | 'agents' | 'skills'}
 */
export function stepOf(item) {
  return STEP_OF_KIND[item.kind] ?? STEP_OF_DIR[item.id.split('/')[0]] ?? 'rules';
}

/**
 * units 가 (간접으로) 필요로 하는 블록. units 자신은 빼고, 중복 없이 처음 만난 순서로. 순환은 이미 본 블록에서 끝난다.
 * @param {string[]} units
 * @param {Record<string, string[]>} requires
 * @returns {string[]}
 */
export function requiredClosure(units, requires) {
  const start = new Set(units);
  const seen = new Set(units);
  const out = [];
  const queue = [...units];
  while (queue.length) {
    for (const need of requires[queue.shift()] ?? []) {
      if (seen.has(need)) continue;
      seen.add(need);
      if (!start.has(need)) out.push(need);
      queue.push(need);
    }
  }
  return out;
}

/**
 * units 가 필요로 하는 블록을 켠다. 실제로 골라진 블록에서만 넓힌다 — 켤 수 없는 블록(반영 불가·사라짐)을
 * 거쳐서 그 너머를 켜면, 필요로 하는 쪽이 골라지지 않아 풀릴 계기가 없는 블록이 반영된다.
 * @param {string[]} units 막 골라진 블록(골라지지 않은 것은 출발점이 되지 않는다)
 * @param {Record<string, string[]>} requires
 * @param {{ isChosen: (unit: string) => boolean, turnOn: (unit: string) => boolean }} ops turnOn 은 켰으면 true
 * @returns {{ by: string, needs: string }[]} 켠 블록과 그것을 직접 필요로 한 블록
 */
export function pullRequired(units, requires, { isChosen, turnOn }) {
  const seen = new Set(units);
  const queue = units.filter(isChosen);
  const out = [];
  while (queue.length) {
    const by = queue.shift();
    for (const needs of requires[by] ?? []) {
      if (seen.has(needs)) continue;
      seen.add(needs);
      if (isChosen(needs)) queue.push(needs);
      else if (turnOn(needs)) {
        out.push({ by, needs });
        queue.push(needs);
      }
    }
  }
  return out;
}

/**
 * 골라진 블록이 필요로 하는데 골라지지 않은 것.
 * @param {Set<string>} chosen
 * @param {Record<string, string[]>} requires
 * @returns {{ unit: string, needs: string }[]}
 */
export function missingRequires(chosen, requires) {
  const out = [];
  for (const unit of chosen) {
    for (const needs of requires[unit] ?? []) if (!chosen.has(needs)) out.push({ unit, needs });
  }
  return out;
}

/**
 * unit 을 풀 때 함께 풀 블록: 의존성으로 자동으로 켰고(auto), 사람이 건드리지 않았고(touched 아님),
 * 남는 골라진 블록이 (간접으로도) 필요로 하지 않는 것. 함께 풀리는 블록끼리의 의존은 남기는 이유가 되지 않는다.
 * @param {string} unit
 * @param {{ chosen: Set<string>, auto: Set<string>, touched: Set<string>, requires: Record<string, string[]> }} state
 * @returns {string[]}
 */
export function releasable(unit, { chosen, auto, touched, requires }) {
  const candidates = requiredClosure([unit], requires).filter(u => chosen.has(u) && auto.has(u) && !touched.has(u));
  let released = new Set(candidates);
  for (;;) {
    const remaining = [...chosen].filter(u => u !== unit && !released.has(u));
    const keep = new Set([...remaining, ...requiredClosure(remaining, requires)]);
    const next = new Set(candidates.filter(u => !keep.has(u)));
    if (next.size === released.size) return [...next];
    released = next;
  }
}
