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
import { migrateLayout, preparePackage } from '../migrate-layout.js';
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

/** 이 단위의 생성물을 조합한다(디스크는 읽기만). ruler.toml 은 ruler.project.toml 에서 만든다. */
export function composeUnit({ project, nested, manifest }) {
  return compose({ project, manifest, nested, rulerAgentsEnabled: rulerAgentsEnabled(project) });
}

/**
 * 조합하고, 조합 전에 .ruler/ruler.toml 이 없었으면(클론 직후 등) 그 사이 ruler 가 남긴 떠돌이 CLAUDE.md 도 다룬다.
 * @returns {{ files: Record<string, Buffer | null>, todos: object[] }}
 */
export function composeWithStray({ project, nested, manifest }) {
  const hadToml = fs.existsSync(path.join(project, ...RULER_TOML.split('/')));
  const composed = composeUnit({ project, nested, manifest });
  const files = { ...composed.files };
  const todos = [...composed.todos];
  if (!hadToml) strayRulerOutput(project, files, todos, String(files[RULER_TOML] ?? ''));
  return { files, todos };
}

/** 조합한 것을 쓴다. 실패하면 오류를 내고 { failed: ApplyError }. */
export function writeComposedOrFail(project, files, err) {
  try {
    return applyFiles(project, files);
  } catch (e) {
    if (!(e instanceof ApplyError)) throw e;
    err(t('apply.writeFailed', { reason: e.message }));
    if (e.written.length) err(t('apply.writtenSoFar', { files: e.written.join(', ') }));
    return { failed: e };
  }
}

/**
 * git 루트에서 ruler apply. 못 하면 할 일을 더한다. 루트에 .ruler/ruler.toml 이 없으면 돌지 않는다 — ruler 는 그것이 없으면
 * 모든 에이전트로 돌아 CLAUDE.md 등을 만들고 nested 도 꺼진 채로 돈다. 새 배치에서 그것은 커밋되지 않은 생성물이라, 클론 직후
 * 중첩 단위에서 부르면 루트에는 아직 없다.
 */
export function rulerStep({ root, env, runRuler, todos }) {
  if (!fs.existsSync(path.join(root, ...RULER_TOML.split('/')))) {
    todos.push({ kind: 'root-apply', item: null, message: t('todo.rootApply', { root }) });
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
 * @returns {{ code: number, written: string[], deleted: string[], todos: object[] }}
 */
export function finishApply({
  project, root = project, nested = false, result, manifest, lock = result.lock, env = process.env, runRuler = defaultRunRuler, err = console.error,
}) {
  let todos = [...result.todos];
  let applied;
  try {
    applied = applyFiles(project, result.files);
  } catch (e) {
    if (!(e instanceof ApplyError)) throw e;
    err(t('apply.writeFailed', { reason: e.message }));
    if (e.written.length) err(t('apply.writtenSoFar', { files: e.written.join(', ') }));
    err(t('apply.lockNotWritten'));
    return { code: 1, written: e.written, deleted: e.deleted, todos };
  }
  writeFileAtomic(path.join(project, MANIFEST), manifestText(manifest));
  writeFileAtomic(path.join(project, LOCK), lockText(lock));
  const composed = composeWithStray({ project, nested, manifest });
  todos = mergeTodos(todos, composed.todos);
  const w = writeComposedOrFail(project, composed.files, err);
  if (w.failed) {
    err(t('apply.composeNotWritten'));
    return { code: 1, written: [...applied.written, ...w.failed.written], deleted: [...applied.deleted, ...w.failed.deleted], todos };
  }
  applied = { written: [...applied.written, ...w.written], deleted: [...applied.deleted, ...w.deleted] };
  if (nested && !rootNestedOn(root)) todos.push(nestedOffTodo(root));
  if (applied.written.length || applied.deleted.length) rulerStep({ root, env, runRuler, todos });
  return { code: 0, ...applied, todos };
}

/**
 * 옛 배치(잠금 v1·v2, 잠금 없는 0.10 이전)면 반영 전에 새 배치로 옮긴다: 잠금 리비전 원본으로 사본을 .guideline/ 에 되돌려 쓰고,
 * package.json 의 prepare 를 고치고, 매니페스트·잠금(v3)을 쓰고, 생성물을 조합한 뒤(.gitignore 블록) 옛 사본을 git 추적에서 뺀다.
 * 새 배치면 아무것도 하지 않는다. 실패하면 { code }.
 * @returns {Promise<{ lock: object | null, todos: object[] } | { code: number }>}
 */
export async function migrateIfOld({ dir, unit, manifest, lock, env, home, fetchImpl, git, err }) {
  if (!manifest || layoutOf(lock, dir) !== 'ruler') return { lock, todos: [] };
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
  const composed = composeWithStray({ project: dir, nested: unit.nested, manifest });
  if (writeComposedOrFail(dir, composed.files, err).failed) {
    err(t('apply.composeNotWritten'));
    // 잠금은 이미 v3 라 다음 update 는 이전을 건너뛴다 — 지금 추적에서 빼지 않으면 옛 사본이 영영 추적에 남는다.
    // 블록은 다음 apply 가 쓴다. 그 전에 git add -A 로 다시 넣지 않게 apply 먼저 하라고 알린다.
    untrackOld();
    todos.push({ kind: 'apply', item: null, message: t('todo.applyBeforeCommit') });
    printTodos(todos, err);
    return { code: 1 };
  }
  untrackOld();
  return { lock: m.lock, todos };
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
