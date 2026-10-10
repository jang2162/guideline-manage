import fs from 'node:fs';
import path from 'node:path';
import { expandPath } from '../projects.js';
import { remoteClient, loadRevision, explain, ServerError } from '../remote.js';
import { getToken } from '../credentials.js';
import { fetchSources, virtualize, showId } from '../workspace.js';
import { realOf } from '../sources.js';
import { openProject } from './project-update.js';
import { localChanges, toApiChange, toRealChanges } from '../propose.js';
import { unifiedDiff } from '../diff.js';
import { printTodos } from '../todos.js';
import { folderChanges, SOURCE_MARK } from './source.js';
import { t } from '../i18n.js';

export const PROPOSE_DENIED = server => t('propose.denied', { server });
const KIND = c => (c.content === null ? t('change.delete') : c.base === null ? t('change.add') : t('change.modify'));
const textOr = buf => (buf === null ? '' : buf.includes(0) ? null : buf.toString('utf8'));

/**
 * 변경 묶음을 보이거나(dry-run) 제안으로 보낸다. propose 와 propose --from 이 같이 쓴다.
 * @returns {Promise<number>}
 */
export async function sendProposal({ client, server, title, message, project, changes, todos, dryRun, json, out, err, baseTree }) {
  if (changes.length === 0) {
    if (json) out(JSON.stringify({ changes: [], todos }, null, 2));
    else {
      out(t('propose.nothing'));
      printTodos(todos, out);
    }
    return 0;
  }
  const listed = changes.map(c => ({ path: c.path, kind: c.content === null ? 'delete' : c.base === null ? 'add' : 'modify' }));
  if (dryRun) {
    if (json) {
      out(JSON.stringify({ changes: listed, todos }, null, 2));
      return 0;
    }
    out(t('propose.dryRunHeader', { n: changes.length }));
    for (const c of changes) {
      out(`  ${KIND(c)}  ${c.path}`);
      const before = textOr(baseTree.read(c.path));
      const after = textOr(c.content);
      if (before !== null && after !== null) out(unifiedDiff(before, after, { aLabel: t('diff.source'), bLabel: t('diff.proposal') }));
    }
    printTodos(todos, out);
    return 0;
  }
  let r;
  try {
    r = await client.createProposal({ title, description: message ?? '', project, changes: changes.map(toApiChange) });
  } catch (e) {
    if (e instanceof ServerError && e.status === 403) {
      err(PROPOSE_DENIED(server));
      return 1;
    }
    err(explain(e, server));
    return 1;
  }
  if (json) out(JSON.stringify({ id: r.id, url: r.url, changes: listed, todos }, null, 2));
  else {
    out(t('propose.sent', { id: r.id, url: r.url }));
    for (const c of changes) out(`  ${KIND(c)}  ${c.path}`);
    printTodos(todos, out);
  }
  return 0;
}

/**
 * 이 단위 디렉터리에서 고친 사본을 원본 모양으로 되돌려 제안한다. 잠금은 바꾸지 않는다.
 * @returns {Promise<number>}
 */
export async function propose({
  project, server, source, from, title, message, only, dryRun = false, json = false,
  env = process.env, out = console.log, err = console.error, fetchImpl = fetch, home, cwd = process.cwd(),
}) {
  if (from !== undefined) {
    const folder = path.resolve(cwd, expandPath(from));
    let mark;
    try {
      mark = JSON.parse(fs.readFileSync(path.join(folder, SOURCE_MARK), 'utf8'));
    } catch {
      err(t('propose.notSourceFolder', { folder, mark: SOURCE_MARK }));
      return 2;
    }
    if (!title && !dryRun) {
      err(t('propose.titleNeeded'));
      return 2;
    }
    const url = (server ?? mark.server).replace(/\/+$/, '');
    const token = getToken(url, { env, home });
    if (!token) {
      err(t('common.loginNeeded', { url }));
      return 1;
    }
    const client = remoteClient({ server: url, token, fetchImpl });
    let base;
    try {
      base = await loadRevision(client, mark.revision);
    } catch (e) {
      err(explain(e, url));
      return 1;
    }
    return sendProposal({
      client, server: url, title, message, project: null, changes: folderChanges({ base, folder }), todos: [], dryRun, json, out, err, baseTree: base,
    });
  }
  const dir = project !== undefined ? expandPath(project) : cwd;
  const opened = openProject({ dir, server, source, err, needManifest: false });
  if (opened.code !== undefined) return opened.code;
  const { manifest, lock } = opened;
  if (!manifest || !lock) {
    err(t('propose.notYet'));
    return 2;
  }
  // 기준은 잠금의 리비전이다. 출처가 하나라도 받지 못하면 그 출처의 변경은 올리지 않는다.
  const { trees, failures } = await fetchSources({ manifest, lock, latest: new Set(), env, home, fetchImpl });
  for (const f of failures) err(`${f.source}: ${f.message}`);
  if (trees.size === 0) return 1;
  const v = virtualize({ manifest, lock, trees });
  const show = id => showId(id, v.sources, v.many);
  const onlySet = only ? new Set(only.flatMap(id => (id.includes(':') ? [id] : v.sources.map(s => `${s.name}:${id}`)))) : null;
  const wanted = onlySet ? new Set(v.view.items.filter(id => {
    const r = realOf(id, v.sources);
    return r && onlySet.has(`${r.source}:${r.id}`);
  })) : null;
  const { changes, todos } = localChanges({ base: v.tree, project: dir, lock: v.viewLock, only: wanted });
  const shown = todos.map(t => (t.item ? { ...t, item: show(t.item) } : t));
  const bySource = toRealChanges({ changes, sources: v.sources, trees });
  const targets = v.sources.map(s => s.name).filter(n => source === undefined || n === source);
  const many = v.sources.length > 1;
  const projectName = path.basename(dir);
  let code = failures.length ? 1 : 0;
  let sentAny = false;
  for (const name of targets) {
    const list = bySource.get(name) ?? [];
    if (many && list.length === 0) continue;
    sentAny = true;
    const { server: url, client, tree: base } = trees.get(name);
    const prefix = many ? line => out(`${name}: ${line}`) : out;
    const c = await sendProposal({
      client, server: url, title: title ?? t('propose.defaultTitle', { project: projectName }), message, project: projectName,
      changes: list, todos: many ? [] : shown, dryRun, json, out: prefix, err, baseTree: base,
    });
    if (c !== 0) code = c;
  }
  if (many) {
    if (!sentAny) out(t('propose.nothing'));
    printTodos(shown, out);
  }
  return code;
}
