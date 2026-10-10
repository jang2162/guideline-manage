import { expandPath, runGit } from '../projects.js';
import { readManifest, readLock, ManifestError } from '../manifest.js';
import { diskReader, newFiles } from '../project-state.js';
import { unitInfo, unitProblem } from '../unit.js';
import { render } from '../render/index.js';
import { fetchSources, virtualize, toRealLock, aliasMoveTodos, showId, protectedPaths, manifestClashes } from '../workspace.js';
import { finishApply, report } from './sync-common.js';
import { t } from '../i18n.js';

/**
 * 프로젝트의 매니페스트·잠금을 읽고 단위 검사를 한다. 문제가 있으면 { code }.
 * --server 는 출처가 하나일 때만 그 출처의 주소를 바꾼다.
 */
export function openProject({ dir, server, source, err, needManifest = true }) {
  let manifest;
  let lock;
  try {
    manifest = readManifest(dir);
    lock = readLock(dir);
  } catch (e) {
    if (!(e instanceof ManifestError)) throw e;
    err(e.message);
    return { code: 1 };
  }
  if (!manifest && needManifest) {
    err(t('update.notYet'));
    return { code: 2 };
  }
  const problem = unitProblem(dir, manifest);
  if (problem) {
    err(problem);
    return { code: 2 };
  }
  if (!manifest) return { manifest, lock };
  // 손으로 고친 매니페스트로 이름이 겹치면 한쪽 사본이 다른 쪽을 덮는다 — 아무것도 하지 않는다
  const clashes = manifestClashes(manifest);
  if (clashes.length) {
    for (const m of clashes) err(m);
    return { code: 2 };
  }
  const names = Object.keys(manifest.sources);
  if (source !== undefined && !names.includes(source)) {
    err(t('update.unknownSource', { name: source, names: names.join(', ') }));
    return { code: 2 };
  }
  if (server !== undefined) {
    if (names.length > 1 && source === undefined) {
      err(t('common.serverWithManySources'));
      return { code: 2 };
    }
    manifest.sources[source ?? names[0]].server = server;
  }
  return { manifest, lock };
}

/**
 * 매니페스트의 항목 그대로 서버 최신으로 다시 반영한다. 프로젝트에서 고친 출력은 건너뛴다(--force 면 덮어쓴다).
 * 출처마다 받고, 받지 못한 출처는 잠금 그대로 두고 나머지를 반영한 뒤 1 을 낸다.
 * @returns {Promise<number>}
 */
export async function projectUpdate({
  project, server, source, force = false, json = false, env = process.env, out = console.log, err = console.error,
  fetchImpl = fetch, home, cwd = process.cwd(), runRuler, git = runGit,
}) {
  const dir = project !== undefined ? expandPath(project) : cwd;
  const opened = openProject({ dir, server, source, err });
  if (opened.code !== undefined) return opened.code;
  const { manifest, lock } = opened;
  const latest = new Set(source !== undefined ? [source] : Object.keys(manifest.sources));
  const { trees, failures } = await fetchSources({ manifest, lock, latest, env, home, fetchImpl });
  for (const f of failures) err(`${f.source}: ${f.message}`);
  if (trees.size === 0) return 1;

  const failed = failures.map(f => f.source);
  const protect = protectedPaths({ manifest, lock, failed });
  const v = virtualize({ manifest, lock, trees, protect });
  const unit = unitInfo(dir, git);
  const decisions = Object.fromEntries(v.view.items.map(id => [id, { action: 'keep' }]));
  const rendered = render({
    tree: v.tree, revision: 0, manifest: v.view, lock: v.viewLock, project: diskReader(dir), decisions, force, nested: unit.nested, management: v.management,
  });
  for (const p of protect) delete rendered.files[p];
  const revisions = Object.fromEntries([...trees].map(([name, t]) => [name, t.revision]));
  const realLock = toRealLock({ viewLock: rendered.lock, sources: v.sources, revisions, previous: lock, keep: failed, protect });
  rendered.todos.push(...v.problems, ...aliasMoveTodos({ previous: lock, next: realLock, project: dir }));
  const show = id => showId(id, v.sources, v.many);
  for (const f of newFiles(v.tree, v.view)) {
    rendered.todos.push({ kind: 'new-file', item: show(f), message: t('todo.newFile', { item: show(f) }) });
  }
  const done = finishApply({ project: dir, root: unit.root, nested: unit.nested, result: rendered, manifest, lock: realLock, env, runRuler, err });
  report({ result: { ...done, revision: revisionLabel(revisions) }, json, out });
  return failures.length && done.code === 0 ? 1 : done.code;
}

/** 출처가 하나면 그 리비전 숫자, 여럿이면 { 출처: 리비전 }. */
export function revisionLabel(revisions) {
  const names = Object.keys(revisions);
  return names.length === 1 ? revisions[names[0]] : revisions;
}
