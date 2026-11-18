// 서버와 폼 화면이 함께 쓴다. 브라우저에서도 돌아야 하므로 ./blocks.js 말고는 import 하지 않는다.
import { blockKey, ancestorKeys, isWithin, withAncestors } from './blocks.js';

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
export function buildSelection({ revision, items, choices, project, required }) {
  const chosen = selectionItems(items, choices);
  return {
    version: 1,
    revision,
    project,
    items: chosen.map(({ kind, id, action, overwrite, state, lockState }) => ({
      kind, id, action, ...(overwrite ? { overwrite } : {}), state, ...(lockState ? { lockState } : {}),
    })),
    blocked: items.filter(i => i.state === 'blocked').map(({ kind, id, stack, reason }) => ({ kind, id, stack, reason })),
    ...(Array.isArray(required) ? { required: keptRequired(required, chosen) } : {}),
  };
}

/**
 * 필수 중 결과에 남는 블록(조상 포함) 안의 것. 매니페스트는 필수가 items 안에 있어야 하므로, 풀린 블록의 필수는 버린다.
 * @param {string[]} required
 * @param {object[]} chosen selectionItems 결과
 */
function keptRequired(required, chosen) {
  const kept = new Set(withAncestors(chosen.filter(i => i.action !== 'remove').map(i => blockKey(i.id)).filter(Boolean)));
  return [...new Set(required)].filter(k => kept.has(k)).sort();
}

/** 개인 모드에서 블록 하나에 고를 수 있는 것: 프로젝트 선택 그대로·더함·뺌. */
export const PERSONAL_CHOICES = ['keep', 'add', 'remove'];

/**
 * 개인 폼 payload 의 판정 재료. inProject: 프로젝트가 받는 블록(조상 포함), guarded: 필수와 그 조상(개인이 뺄 수 없다).
 * @param {{ chosen: string[], required: string[] }} personal
 */
export function personalBasis(personal) {
  return { inProject: new Set(withAncestors(personal.chosen ?? [])), guarded: new Set(withAncestors(personal.required ?? [])) };
}

/**
 * 개인 폼의 제출 결과. 키는 모두 폼이 받은 이름(별칭을 입힌 가상 키)이다.
 * - 프로젝트에 있는 블록의 더함, 없는 블록의 뺌은 아무것도 바꾸지 않으므로 버린다.
 * - 필수와 그 조상의 뺌은 rejected(서버는 이것이 있으면 제출을 거절한다).
 * - 뺀 스택 아래의 프로젝트 블록도 뺀다. 뺀 스택 아래의 더함은 버린다.
 * - 더한 하위 스택의 조상 중 프로젝트에 없는 것을 더한다.
 * @param {{ personal: { chosen: string[], required: string[] }, choices: Record<string, string>, saveDefault?: boolean }} opts
 * @returns {{ mode: 'personal', add: string[], remove: string[], saveDefault: boolean, rejected: string[] }}
 */
export function personalSelection({ personal, choices, saveDefault = false }) {
  const { inProject, guarded } = personalBasis(personal);
  const want = v => Object.entries(choices ?? {}).filter(([, c]) => c === v).map(([k]) => k);
  const rejected = want('remove').filter(k => guarded.has(k));
  const cut = want('remove').filter(k => inProject.has(k) && !guarded.has(k));
  const remove = [...inProject].filter(k => cut.some(r => isWithin(k, r)));
  const add = withAncestors(want('add').filter(k => !inProject.has(k) && !cut.some(r => isWithin(k, r)))).filter(k => !inProject.has(k));
  return { mode: 'personal', add: add.sort(), remove: remove.sort(), saveDefault: saveDefault === true, rejected: rejected.sort() };
}

/**
 * 개인 폼의 초기 상태: payload 의 add·remove(이 프로젝트의 개인 선택이나 머신 기본값) 중 의미 있는 것만.
 * 뺄 수 없는 것(필수와 그 조상, personalSelection 이 rejected 로 따로 낸다)은 그대로 둔다. 없는 블록은 'keep' 이다.
 * @param {{ chosen: string[], required: string[], add: string[], remove: string[] }} personal
 * @returns {Record<string, 'add' | 'remove'>}
 */
export function personalChoices(personal) {
  const choices = Object.fromEntries([...(personal.add ?? []).map(k => [k, 'add']), ...(personal.remove ?? []).map(k => [k, 'remove'])]);
  const r = personalSelection({ personal, choices });
  return Object.fromEntries([...r.add.map(k => [k, 'add']), ...r.remove.map(k => [k, 'remove'])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export { blockKey };

const STEP_OF_KIND = { rule: 'rules', setup: 'rules', mcp: 'mcp', subagent: 'agents', skill: 'skills' };
const STEP_OF_DIR = { rules: 'rules', mcp: 'mcp', agents: 'agents', skills: 'skills' };

/**
 * 폼 항목이 놓일 단계. 원본에서 사라진 항목은 경로 앞 조각으로 정하고(새 배치 사본 .guideline/<조각>/ 은 그 다음 조각), 모르면 지침 단계.
 * @param {{ kind: string, id: string }} item
 * @returns {'rules' | 'mcp' | 'agents' | 'skills'}
 */
export function stepOf(item) {
  const parts = item.id.split('/');
  return STEP_OF_KIND[item.kind] ?? STEP_OF_DIR[parts[0] === '.guideline' ? parts[1] : parts[0]] ?? 'rules';
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

/**
 * 폼 지침 단계의 스택 나무 순서: 부모 바로 아래에 자식을, 깊이와 함께. 형제는 받은 순서를 지킨다.
 * 이름순 정렬만으로는 `base-x` 가 `base` 와 `base/browser` 사이에 끼므로 parent 로 나무를 만든다.
 * parent 가 없거나 목록에 없으면 최상위로 둔다.
 * @template {{ name: string, parent?: string | null }} S
 * @param {S[]} stacks
 * @returns {{ stack: S, depth: number }[]}
 */
export function stackRows(stacks) {
  const names = new Set(stacks.map(s => s.name));
  const kids = new Map();
  const roots = [];
  for (const s of stacks) {
    if (s.parent && names.has(s.parent)) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
    else roots.push(s);
  }
  const out = [];
  const walk = (s, depth) => {
    out.push({ stack: s, depth });
    for (const k of kids.get(s.name) ?? []) walk(k, depth + 1);
  };
  for (const s of roots) walk(s, 0);
  return out;
}

/**
 * 하위 스택 unit 을 고를 때 함께 켤 조상: 아직 골라지지 않은 조상, 가까운 것부터.
 * @param {string} unit
 * @param {Set<string>} chosen
 * @returns {string[]}
 */
export function ancestorsToChoose(unit, chosen) {
  return ancestorKeys(unit).filter(a => !chosen.has(a));
}

/**
 * 스택 unit 을 풀 때 함께 풀릴 골라진 자손(자기 자신 제외).
 * @param {string} unit
 * @param {Set<string>} chosen
 * @returns {string[]}
 */
export function chosenDescendants(unit, chosen) {
  return [...chosen].filter(u => u !== unit && isWithin(u, unit));
}

/**
 * 하위 스택 unit 을 푼 뒤 함께 풀 조상, 가까운 것부터. 조상으로 켰고(ancestor), 사람이 만지지 않았고, 골라져 있고,
 * 골라진 다른 자손이 없고, 남는 골라진 블록이 (간접으로도) 필요로 하지 않는 것만. 하나라도 걸리면 거기서 멈춘다
 * — 남는 조상은 그 위 조상을 붙잡기 때문이다. releasable 과 같은 불변식: 자동 해제는 남는 블록이 필요로 하는 것을 풀지 않는다.
 * @param {string} unit 막 풀린 하위 스택
 * @param {{ chosen: Set<string>, ancestor: Set<string>, touched: Set<string>, requires: Record<string, string[]> }} state chosen 은 unit 을 푼 뒤
 * @returns {string[]}
 */
export function releasableAncestors(unit, { chosen, ancestor, touched, requires }) {
  const left = new Set(chosen);
  const out = [];
  for (const a of ancestorKeys(unit)) {
    if (!ancestor.has(a) || touched.has(a) || !left.has(a)) break;
    if (chosenDescendants(a, left).length) break;
    left.delete(a);
    if (requiredClosure([...left], requires).includes(a)) break;
    out.push(a);
  }
  return out;
}
