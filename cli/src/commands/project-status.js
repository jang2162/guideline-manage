import { expandPath, runGit } from '../projects.js';
import { diskReader, itemStates, newFiles, statusTodos, STATE_ORDER, stateLabel } from '../project-state.js';
import { unitInfo, rootNestedOn, nestedOffTodo } from '../unit.js';
import { printTodos } from '../todos.js';
import { fetchSources, virtualize, showId, protectedPaths } from '../workspace.js';
import { openProject, revisionLabel } from './project-update.js';
import { t } from '../i18n.js';

/**
 * 반영한 지침이 서버 최신과 같은지, 프로젝트에서 고친 것이 있는지 본다. 출처마다 최신과 비교한다.
 * @returns {Promise<number>}
 */
export async function projectStatus({
  project, server, source, json = false, env = process.env, out = console.log, err = console.error, fetchImpl = fetch, home, cwd = process.cwd(), git = runGit,
}) {
  const dir = project !== undefined ? expandPath(project) : cwd;
  const opened = openProject({ dir, server, source, err, needManifest: false });
  if (opened.code !== undefined) return opened.code;
  const { manifest, lock } = opened;
  if (!manifest || !lock) {
    out(t('status.notYet'));
    return 0;
  }
  // --source 면 그 출처만 받는다. 나머지는 받지 못한 출처처럼 다뤄 그 잠금과 공유 생성물을 비교에서 뺀다.
  const only = source !== undefined ? [source] : undefined;
  const { trees, failures } = await fetchSources({ manifest, lock, latest: new Set(Object.keys(manifest.sources)), only, env, home, fetchImpl });
  for (const f of failures) err(`${f.source}: ${f.message}`);
  if (trees.size === 0) return 1;

  const unfetched = Object.keys(manifest.sources).filter(n => !trees.has(n));
  const v = virtualize({ manifest, lock, trees, protect: protectedPaths({ manifest, lock, failed: unfetched }) });
  const unit = unitInfo(dir, git);
  const { states, outputs } = itemStates({ tree: v.tree, reader: diskReader(dir), manifest: v.view, lock: v.viewLock, nested: unit.nested, management: v.management });
  const show = id => showId(id, v.sources, v.many);
  const fresh = newFiles(v.tree, v.view);
  const todos = [...statusTodos(states, fresh, show), ...v.problems];
  if (unit.nested && !rootNestedOn(unit.root)) todos.push(nestedOffTodo(unit.root));
  const head = revisionLabel(Object.fromEntries([...trees].map(([name, t]) => [name, t.revision])));
  const applied = revisionLabel(Object.fromEntries([...trees.keys()].map(name => [name, lock.revisions[name] ?? 0])));
  const code = failures.length ? 1 : 0;
  if (json) {
    out(JSON.stringify({
      revision: applied,
      head,
      items: [...states].map(([id, state]) => ({ id: show(id), state })),
      outputs: outputs.map(o => ({ path: o.path, ...(o.key ? { key: o.key } : {}), state: o.state })),
      newFiles: fresh.map(show),
      todos,
    }, null, 2));
    return code;
  }
  const label = r => (typeof r === 'object' ? Object.entries(r).map(([n, x]) => `${n} r${x}`).join(', ') : `r${r}`);
  out(t('status.header', { dir, applied: label(applied), head: label(head) }));
  const counts = {};
  for (const s of states.values()) counts[s] = (counts[s] ?? 0) + 1;
  out(`  ${STATE_ORDER.filter(k => counts[k]).map(k => `${stateLabel(k)} ${counts[k]}`).join(' · ')}`);
  for (const [id, s] of states) if (s !== 'current') out(`  ${stateLabel(s)}  ${show(id)}`);
  for (const o of outputs) if (o.items.length === 0 && o.state !== 'current') out(`  ${stateLabel(o.state)}  ${o.path}`);
  if (fresh.length) {
    out(t('status.newFiles'));
    for (const f of fresh) out(`  ${show(f)}`);
  }
  printTodos(todos, out);
  return code;
}
