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
