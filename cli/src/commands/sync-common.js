import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyFiles, writeFileAtomic, ApplyError } from '../apply.js';
import { MANIFEST, LOCK, manifestText, lockText, manifestVersionOnDisk } from '../manifest.js';
import { printTodos } from '../todos.js';
import { rootNestedOn, nestedOffTodo } from '../unit.js';
import { compose } from '../compose.js';
import { rulerAgentsEnabled } from '../project-state.js';
import { RULER_TOML, layoutOf } from '../layout.js';
import { strayRulerOutput } from '../stray.js';
import { fetchSources } from '../workspace.js';
import { migrateLayout, preparePackage, readOnlyPrepareTodos } from '../migrate-layout.js';
import { personalPlace, readLocal, LocalError } from '../personal.js';
import { writeExclude, readExclude } from '../exclude.js';
import { writePersonal } from '../personal-sync.js';
import { runGit } from '../projects.js';
import { t } from '../i18n.js';

/** 프로젝트의 node_modules/.bin/ruler 나 PATH 의 ruler. 없으면 null. 내려받아 실행하지 않는다. */
export function findRuler(project, env = process.env) {
  const local = path.join(project, 'node_modules', '.bin', 'ruler');
  if (fs.existsSync(local)) return local;
  for (const dir of String(env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'ruler');
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // 다음 경로
    }
  }
  return null;
}

/** @returns {number} 종료 코드 */
export function defaultRunRuler(bin, cwd) {
  return spawnSync(bin, ['apply'], { cwd, stdio: 'inherit' }).status ?? 1;
}

/**
 * 동기화 할 일에 조합 할 일을 더한다. 같은 할 일(종류·항목·문구)은 한 번만, 조합의 no-copy 는 동기화가 그 항목(그 안의 파일 포함)에
 * 이미 이유를 낸 것이면 뺀다 — 막힘·mcp-build 처럼 동기화가 사본을 쓰지 않은 이유가 더 정확하다.
 */
export function mergeTodos(syncTodos, composeTodos) {
  const seen = new Set(syncTodos.map(x => `${x.kind}\0${x.item ?? ''}\0${x.message}`));
  const within = (id, key) => id === key || id.startsWith(`${key}/`);
  const out = [...syncTodos];
  for (const x of composeTodos) {
    if (seen.has(`${x.kind}\0${x.item ?? ''}\0${x.message}`)) continue;
    if (x.kind === 'no-copy' && syncTodos.some(s => s.item && within(s.item, x.item))) continue;
    out.push(x);
  }
  return out;
}

/**
 * 조합에 넘길 이 단위의 개인 겹. 모든 조합 호출자(update·pick·apply·하위 단위·status)가 이것으로 같은 personal 을 얻는다 —
 * 하나라도 빠뜨리면 그 명령은 개인 겹 없이 조합해 개인 생성물을 지우고, status 는 apply 할 일을 영영 낸다.
 * git 저장소가 아니면 personal 은 null(개인 범위를 지원하지 않는다). 개인 선택 파일이 깨졌으면 null 과 할 일 — 그 사이 info/exclude 와
 * 개인 생성물은 건드리지 않는다(블록을 읽지 않으니 지우지도 않는다).
 * @param {{ project: string, unit: { root: string }, git?: import('../projects.js').GitRunner }} opts project 는 단위 디렉터리
 * @returns {{ personal: { local: object, store: string, common: string, unitRel: string, worktree: string } | null, todos: object[] }}
 */
export function composeInputs({ project, unit, git = runGit }) {
  const place = personalPlace({ dir: project, root: unit.root }, git);
  if (!place) return { personal: null, todos: [] };
  try {
    return { personal: { ...place, local: readLocal(place.store) }, todos: [] };
  } catch (e) {
    if (!(e instanceof LocalError)) throw e;
    return { personal: null, todos: [{ kind: 'local-bad', item: null, message: t('todo.localBad', { reason: e.message }) }] };
  }
}

/** 이 단위의 생성물을 조합한다(디스크는 읽기만). ruler.toml 은 ruler.project.toml 에서 만든다. personal 은 composeInputs 의 것. */
export function composeUnit({ project, nested, manifest, personal = null }) {
  return compose({ project, manifest, nested, rulerAgentsEnabled: rulerAgentsEnabled(project), personal });
}

/**
 * 조합하고, 조합 전에 .ruler/ruler.toml 이 없었으면(클론 직후 등) 그 사이 ruler 가 남긴 떠돌이 CLAUDE.md 도 다룬다.
 * exclude 는 writeComposedOrFail 에 넘길 info/exclude 쓰기(개인 겹이 없으면 null).
 * @returns {{ files: Record<string, Buffer | null>, todos: object[], exclude: { common: string, unitRel: string, worktree: string, paths: string[] } | null }}
 */
export function composeWithStray({ project, nested, manifest, personal = null }) {
  const hadToml = fs.existsSync(path.join(project, ...RULER_TOML.split('/')));
  const composed = composeUnit({ project, nested, manifest, personal });
  const files = { ...composed.files };
  const todos = [...composed.todos];
  if (!hadToml) strayRulerOutput(project, files, todos, String(files[RULER_TOML] ?? ''));
  const exclude = personal && composed.exclude
    ? { common: personal.common, unitRel: personal.unitRel, worktree: personal.worktree, paths: composed.exclude.paths }
    : null;
  return { files, todos, exclude };
}

/**
 * 조합한 것을 쓴다. exclude 를 주면 info/exclude 의 이 워크트리 단위 블록도 쓴다(작업 트리 밖이라 applyFiles 를 거치지 않는다).
 * 개인 생성물이 블록 밖에 있는 틈(git status 에 보이고 git add -A 로 커밋될 수 있다)이 없게: 블록이 늘기만 하면 파일보다 먼저 쓰고,
 * 줄면 (이전 ∪ 이번) 을 먼저 쓴 뒤 파일 쓰기가 성공하면 이번 것으로 줄인다 — 지울 파일을 지우지 못해도 블록에 남는다.
 * 실패하면 오류를 내고 { failed: ApplyError }.
 */
export function writeComposedOrFail(project, files, err, exclude = null) {
  let shrink = false;
  const excluded = paths => {
    try {
      writeExclude({ ...exclude, paths });
      return true;
    } catch (e) {
      err(t('apply.excludeFailed', { reason: e.message }));
      return false;
    }
  };
  if (exclude) {
    const before = readExclude(exclude);
    shrink = before.some(p => !exclude.paths.includes(p));
    if (!excluded(shrink ? [...before, ...exclude.paths] : exclude.paths)) {
      return { failed: new ApplyError(t('apply.excludeFailed', { reason: '' }), { remaining: Object.keys(files) }) };
    }
  }
  let w;
  try {
    w = applyFiles(project, files);
  } catch (e) {
    if (!(e instanceof ApplyError)) throw e;
    err(t('apply.writeFailed', { reason: e.message }));
    if (e.written.length) err(t('apply.writtenSoFar', { files: e.written.join(', ') }));
    return { failed: e };
  }
  if (shrink && !excluded(exclude.paths)) return { failed: new ApplyError(t('apply.excludeFailed', { reason: '' }), { written: w.written, deleted: w.deleted }) };
  return w;
}

/**
 * git 루트에서 ruler apply. 못 하면 할 일을 더한다. 루트에 .ruler/ruler.toml 이 없으면 돌지 않는다 — ruler 는 그것이 없으면
 * 모든 에이전트로 돌아 CLAUDE.md 등을 만들고 nested 도 꺼진 채로 돈다. 새 배치에서 그것은 커밋되지 않은 생성물이라, 클론 직후
 * 중첩 단위에서 부르면 루트에는 아직 없다.
 */
export function rulerStep({ root, env, runRuler, todos, rootIsUnit = true }) {
  if (!fs.existsSync(path.join(root, ...RULER_TOML.split('/')))) {
    // 루트가 guideline 프로젝트가 아니면 그 ruler.toml 은 프로젝트가 둘 것이다 — 「루트에서 apply」 는 답이 아니다
    todos.push(rootIsUnit
      ? { kind: 'root-apply', item: null, message: t('todo.rootApply', { root }) }
      : { kind: 'root-ruler-toml', item: null, message: t('todo.rootRulerToml', { root }) });
    return;
  }
  const bin = findRuler(root, env);
  if (!bin) {
    todos.push({ kind: 'ruler-apply', item: null, message: t('todo.rulerMissing', { root }) });
  } else if (runRuler(bin, root) !== 0) {
    todos.push({ kind: 'ruler-apply', item: null, message: t('todo.rulerFailed', { bin }) });
  }
}

/**
 * 렌더링 결과(.guideline/ 사본)를 단위 디렉터리에 쓰고, 매니페스트·잠금을 쓴 뒤 .guideline/ 에서 생성물을 조합해 쓰고
 * git 루트에서 ruler apply 를 돈다 — 조합이 .ruler/ruler.toml 을 쓴 뒤에만 ruler 를 돌아야 모든 에이전트 몫(CLAUDE.md 등)이 생기지 않는다.
 * migration 은 이번 실행에서 먼저 한 이전(migrateIfOld)의 결과다. 이전이 있었으면 이 단계에서 쓴 것이 없어도 ruler 를 돈다 —
 * 이전이 바꾼 관리 지침이 AGENTS.md 에 들어가야 한다. 쓴/지운 목록에도 합친다.
 * sync({ trees, revisions }) 를 주면(update·pick) 프로젝트를 쓴 뒤 같은 원본으로 개인 사본도 받아 개인 저장소에 쓰고 그다음 조합한다.
 * @returns {{ code: number, written: string[], deleted: string[], todos: object[] }}
 */
export function finishApply({
  project, root = project, nested = false, result, manifest, lock = result.lock, env = process.env, runRuler = defaultRunRuler, err = console.error,
  migration = null, git = runGit, sync = null,
}) {
  let todos = [...result.todos];
  const pre = migration ?? { written: [], deleted: [] };
  const merged = (written, deleted) => ({ written: union(pre.written, written), deleted: union(pre.deleted, deleted) });
  let applied;
  try {
    applied = applyFiles(project, result.files);
  } catch (e) {
    if (!(e instanceof ApplyError)) throw e;
    err(t('apply.writeFailed', { reason: e.message }));
    if (e.written.length) err(t('apply.writtenSoFar', { files: e.written.join(', ') }));
    err(t('apply.lockNotWritten'));
    return { code: 1, ...merged(e.written, e.deleted), todos };
  }
  writeFileAtomic(path.join(project, MANIFEST), manifestText(manifest));
  writeFileAtomic(path.join(project, LOCK), lockText(lock));
  const inputs = composeInputs({ project, unit: { root }, git });
  if (sync && inputs.personal) todos = mergeTodos(todos, writePersonal({ personal: inputs.personal, manifest, nested, ...sync }));
  const composed = composeWithStray({ project, nested, manifest, personal: inputs.personal });
  todos = mergeTodos(todos, [...inputs.todos, ...composed.todos]);
  const w = writeComposedOrFail(project, composed.files, err, composed.exclude);
  if (w.failed) {
    err(t('apply.composeNotWritten'));
    return { code: 1, ...merged([...applied.written, ...w.failed.written], [...applied.deleted, ...w.failed.deleted]), todos };
  }
  applied = merged([...applied.written, ...w.written], [...applied.deleted, ...w.deleted]);
  if (nested && !rootNestedOn(root)) todos.push(nestedOffTodo(root));
  if (migration || applied.written.length || applied.deleted.length) rulerStep({ root, env, runRuler, todos });
  // prepare 가 아직 ruler apply 만 부르면 해결될 때까지 알린다(이전 때 한 번이면 놓친다). 바꾸는 것은 apply 의 몫이다.
  todos = mergeTodos(todos, readOnlyPrepareTodos({ project, root }));
  return { code: 0, ...applied, todos };
}

/**
 * pick --local 의 마무리: 커밋되는 파일(매니페스트·잠금·.guideline/ 사본)은 쓰지 않고, 받은 원본으로 개인 사본을 맞춘 뒤
 * 개인 겹을 넣어 생성물을 조합해 쓰고 ruler 를 돈다. 개인 선택(local.json)은 이미 써 두었어야 한다 — 조합이 그것을 다시 읽는다.
 * @param {{ project: string, root?: string, nested?: boolean, manifest: object, sync: { trees: Map<string, object>, revisions: Record<string, number> },
 *   todos?: object[], env?: object, runRuler?: Function, err?: Function, git?: Function }} opts
 * @returns {{ code: number, written: string[], deleted: string[], todos: object[] }}
 */
export function finishPersonal({
  project, root = project, nested = false, manifest, sync, todos: before = [], env = process.env, runRuler = defaultRunRuler, err = console.error, git = runGit,
}) {
  const inputs = composeInputs({ project, unit: { root }, git });
  let todos = [...before, ...inputs.todos];
  if (inputs.personal) todos = mergeTodos(todos, writePersonal({ personal: inputs.personal, manifest, nested, ...sync }));
  const composed = composeWithStray({ project, nested, manifest, personal: inputs.personal });
  todos = mergeTodos(todos, composed.todos);
  const w = writeComposedOrFail(project, composed.files, err, composed.exclude);
  if (w.failed) {
    err(t('apply.composeNotWritten'));
    return { code: 1, written: w.failed.written ?? [], deleted: w.failed.deleted ?? [], todos };
  }
  if (nested && !rootNestedOn(root)) todos.push(nestedOffTodo(root));
  if (w.written.length || w.deleted.length) rulerStep({ root, env, runRuler, todos });
  todos = mergeTodos(todos, readOnlyPrepareTodos({ project, root }));
  return { code: 0, written: w.written, deleted: w.deleted, todos };
}

/** 순서를 지키며 합친다(같은 경로는 한 번). */
const union = (a, b) => [...new Set([...a, ...b])];

/**
 * 옛 배치(잠금 v1·v2, 잠금 없는 0.10 이전)면 반영 전에 새 배치로 옮긴다: 잠금 리비전 원본으로 사본을 .guideline/ 에 되돌려 쓰고,
 * package.json 의 prepare 를 고치고, 매니페스트·잠금(v3)을 쓰고, 생성물을 조합한 뒤(.gitignore 블록) 옛 사본을 git 추적에서 뺀다.
 * 새 배치면 아무것도 하지 않는다(migration 은 null). 옮겼으면 migration 에 쓴/지운 파일 — finishApply 가 보고에 합치고 ruler 를 돈다.
 * 실패하면 { code }.
 * @returns {Promise<{ lock: object | null, todos: object[], migration: { written: string[], deleted: string[] } | null } | { code: number }>}
 */
export async function migrateIfOld({ dir, unit, manifest, lock, env, home, fetchImpl, git, err }) {
  if (!manifest || layoutOf(lock, dir) !== 'ruler') return { lock, todos: [], migration: null };
  const { trees, failures } = await fetchSources({ manifest, lock, latest: new Set(), env, home, fetchImpl });
  if (failures.length) {
    for (const f of failures) err(`${f.source}: ${f.message}`);
    return { code: 1 };
  }
  const m = migrateLayout({ project: dir, manifest, lock, trees, git, nested: unit.nested });
  if (m.error) {
    err(m.error);
    return { code: 1 };
  }
  const prep = preparePackage({ project: dir, root: unit.root, hook: true });
  const w = writeComposedOrFail(dir, { ...m.files, ...prep.files }, err);
  if (w.failed) {
    err(t('apply.lockNotWritten'));
    return { code: 1 };
  }
  writeFileAtomic(path.join(dir, MANIFEST), manifestText(manifest));
  writeFileAtomic(path.join(dir, LOCK), lockText(m.lock));
  const todos = [{ kind: 'migrated', item: null, message: t('migrate.done') }, ...m.todos, ...prep.todos];
  const untrack = m.notes.untrack;
  const untrackOld = () => {
    if (untrack.length && git(['rm', '--cached', '--quiet', '--', ...untrack], dir).status !== 0) {
      todos.push({ kind: 'untracked', item: null, message: t('todo.untrackMigrated', { paths: untrack.join(' '), dir }) });
    }
  };
  // .gitignore 블록을 먼저 써야 추적에서 뺀 생성물이 다시 커밋되지 않는다
  const inputs = composeInputs({ project: dir, unit, git });
  const composed = composeWithStray({ project: dir, nested: unit.nested, manifest, personal: inputs.personal });
  todos.push(...inputs.todos);
  const c = writeComposedOrFail(dir, composed.files, err, composed.exclude);
  if (c.failed) {
    err(t('apply.composeNotWritten'));
    // 잠금은 이미 v3 라 다음 update 는 이전을 건너뛴다 — 지금 추적에서 빼지 않으면 옛 사본이 영영 추적에 남는다.
    // 블록은 다음 apply 가 쓴다. 그 전에 git add -A 로 다시 넣지 않게 apply 먼저 하라고 알린다.
    untrackOld();
    todos.push({ kind: 'apply', item: null, message: t('todo.applyBeforeCommit') });
    printTodos(todos, err);
    return { code: 1 };
  }
  untrackOld();
  return { lock: m.lock, todos, migration: { written: union(w.written, c.written), deleted: union(w.deleted, c.deleted) } };
}

/**
 * 이전한 뒤 반영까지 가지 못하고 끝날 때(받기 실패, 폼 취소): 이전이 쓴 관리 지침이 AGENTS.md 에 들어가게 ruler 를 돌고 할 일을 낸다.
 * @param {{ moved: { todos: object[], migration: object | null }, root: string, env?: object, runRuler?: Function, err: Function }} opts
 */
export function finishMigrationOnly({ moved, root, env = process.env, runRuler = defaultRunRuler, err }) {
  const todos = [...moved.todos];
  if (moved.migration) rulerStep({ root, env, runRuler, todos });
  printTodos(todos, err);
}

/** 읽은 매니페스트가 v1·v2 였으면(이번에 v3 로 쓴다) 알리는 할 일. */
export function manifestV3Todos(dir) {
  const v = manifestVersionOnDisk(dir);
  return v !== null && v < 3 ? [{ kind: 'manifest-v3', item: null, message: t('migrate.manifestV3') }] : [];
}

/** 반영 결과를 낸다. json 이면 stdout 에 JSON 하나만. */
export function report({ result, json, out }) {
  if (json) {
    out(JSON.stringify({ revision: result.revision, written: result.written, deleted: result.deleted, todos: result.todos }, null, 2));
    return;
  }
  const rev = typeof result.revision === 'object'
    ? Object.entries(result.revision).map(([name, r]) => `${name} r${r}`).join(', ')
    : `r${result.revision}`;
  out(t('apply.done', { rev, written: result.written.length, deleted: result.deleted.length }));
  for (const p of result.written) out(t('apply.writeLine', { path: p }));
  for (const p of result.deleted) out(t('apply.deleteLine', { path: p }));
  printTodos(result.todos, out);
}
