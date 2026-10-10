import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyFiles, writeFileAtomic, ApplyError } from '../apply.js';
import { MANIFEST, LOCK, manifestText, lockText } from '../manifest.js';
import { printTodos } from '../todos.js';
import { rootNestedOn, nestedOffTodo } from '../unit.js';
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
 * 렌더링 결과를 단위 디렉터리에 쓰고, 매니페스트·잠금을 마지막에 쓴 뒤 git 루트에서 ruler apply 를 돈다.
 * @returns {{ code: number, written: string[], deleted: string[], todos: object[] }}
 */
export function finishApply({ project, root = project, nested = false, result, manifest, lock = result.lock, env = process.env, runRuler = defaultRunRuler, err = console.error }) {
  const todos = [...result.todos];
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
  if (nested && !rootNestedOn(root)) todos.push(nestedOffTodo(root));
  if (applied.written.length || applied.deleted.length) {
    const bin = findRuler(root, env);
    if (!bin) {
      todos.push({ kind: 'ruler-apply', item: null, message: t('todo.rulerMissing', { root }) });
    } else if (runRuler(bin, root) !== 0) {
      todos.push({ kind: 'ruler-apply', item: null, message: t('todo.rulerFailed', { bin }) });
    }
  }
  return { code: 0, ...applied, todos };
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
