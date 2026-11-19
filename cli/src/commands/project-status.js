import { expandPath, runGit } from '../projects.js';
import { diskReader, itemStates, statusTodos, STATE_ORDER, stateLabel } from '../project-state.js';
import { unitInfo, rootNestedOn, nestedOffTodo } from '../unit.js';
import { printTodos } from '../todos.js';
import { fetchSources, virtualize, showId, protectedPaths, missingRequiresTodos } from '../workspace.js';
import { tokenInfo } from '../remote.js';
import { openProject, revisionLabel } from './project-update.js';
import { composeUnit, composeInputs, mergeTodos } from './sync-common.js';
import { excludeStale } from '../exclude.js';
import { personalStatus, personalRevisionTodos } from '../personal-sync.js';
import { preparePackage } from '../migrate-layout.js';
import { layoutOf } from '../layout.js';
import { t } from '../i18n.js';

/** status 가 조합에서 가져와 내는 할 일 종류. */
const COMPOSE_KINDS = new Set(['mcp-conflict', 'no-copy', 'override-unchosen', 'blocked', 'personal-ignored', 'personal-shadowed', 'override-target']);

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
  // 옛 배치는 update 가 옮긴 뒤에 본다(사본 자리가 다르다)
  if (layoutOf(lock, dir) === 'ruler') {
    err(t('apply.needsUpdate'));
    return 2;
  }
  // 생성물이 .guideline/ 에서 조합한 것과 같은지 본다. 서버 없이 하는 판정이라 받기에 실패해도 낸다.
  // apply 가 고칠 prepare 도 낡은 것으로 보고, 고칠 수 없는 prepare(guideline CLI 가 의존성에 없음 등)는 해결될 때까지 알린다.
  const unit = unitInfo(dir, git);
  // apply 와 같은 개인 겹으로 조합해야 개인 생성물을 낡은 것으로 보지 않는다
  const inputs = composeInputs({ project: dir, unit, manifest, git });
  const composed = composeUnit({ project: dir, nested: unit.nested, manifest, personal: inputs.personal });
  const prep = preparePackage({ project: dir, root: unit.root });
  const excludeOld = inputs.personal !== null && excludeStale({ ...inputs.personal, paths: composed.exclude.paths });
  const localTodos = [
    ...(Object.keys(composed.files).length || Object.keys(prep.files).length || excludeOld ? [{ kind: 'apply', item: null, message: t('todo.apply') }] : []),
    ...inputs.todos,
    // 개인 사본과 프로젝트의 리비전이 출처별로 다르면(다른 워크트리의 update 가 개인 사본만 올림) 서버 없이도 알린다
    ...(inputs.personal ? personalRevisionTodos({ store: inputs.personal.store, manifest, local: inputs.personal.local, lock }) : []),
    ...prep.todos.filter(x => x.kind !== 'prepare'),
    // 조합이 낼 할 일 중 프로젝트가 고칠 것(apply·update 를 돌리지 않아도 보이게)
    ...mergeTodos([], composed.todos.filter(x => COMPOSE_KINDS.has(x.kind))),
  ];
  // --source 면 그 출처만 받는다. 나머지는 받지 못한 출처처럼 다뤄 그 잠금과 공유 생성물을 비교에서 뺀다.
  const only = source !== undefined ? [source] : undefined;
  const { trees, failures } = await fetchSources({ manifest, lock, latest: new Set(Object.keys(manifest.sources)), only, env, home, fetchImpl });
  for (const f of failures) err(`${f.source}: ${f.message}`);
  if (trees.size === 0) {
    if (localTodos.length) {
      if (json) out(JSON.stringify({ todos: localTodos }, null, 2));
      else printTodos(localTodos, out);
    }
    return 1;
  }

  const unfetched = Object.keys(manifest.sources).filter(n => !trees.has(n));
  const v = virtualize({ manifest, lock, trees, protect: protectedPaths({ manifest, lock, failed: unfetched }) });
  const { states, outputs } = itemStates({
    tree: v.tree, reader: diskReader(dir), manifest: v.view, lock: v.viewLock, nested: unit.nested, management: v.management,
  });
  const show = id => showId(id, v.sources, v.many);
  // 개인 범위(git 저장소가 아니거나 개인 선택이 깨졌으면 null): 개인 더함·뺌과, 받은 원본 기준 개인 사본 상태
  const personal = inputs.personal
    ? personalStatus({
      store: inputs.personal.store, manifest, local: inputs.personal.local, saved: inputs.personal.saved, layers: inputs.personal.layers,
      role: inputs.personal.role, trees, nested: unit.nested,
    })
    : null;
  // 개인 잠금이 깨졌으면 리비전 비교와 개인 사본 상태가 같은 할 일을 낸다 — mergeTodos 로 한 번만
  const todos = mergeTodos(
    [...localTodos, ...statusTodos(states, show), ...v.problems, ...missingRequiresTodos({ manifest, trees, many: v.many })],
    personal?.todos ?? [],
  );
  if (unit.nested && !rootNestedOn(unit.root)) todos.push(nestedOffTodo(unit.root));
  const head = revisionLabel(Object.fromEntries([...trees].map(([name, t]) => [name, t.revision])));
  const applied = revisionLabel(Object.fromEntries([...trees.keys()].map(name => [name, lock.revisions[name] ?? 0])));
  // 서버가 본 토큰(이름·범위). 출처가 하나면 { name, scope } | null, 여럿이면 출처 이름별.
  const tokens = {};
  for (const [name, x] of trees) tokens[name] = await tokenInfo(x.client);
  const token = revisionLabel(tokens);
  const code = failures.length ? 1 : 0;
  if (json) {
    out(JSON.stringify({
      revision: applied,
      head,
      items: [...states].map(([id, state]) => ({ id: show(id), state })),
      outputs: outputs.map(o => ({ path: o.path, ...(o.key ? { key: o.key } : {}), state: o.state })),
      personal: personal && {
        added: personal.added, removed: personal.removed, ignored: personal.ignored, shadowed: personal.shadowed, items: personal.items,
        role: personal.role,
      },
      todos,
      token,
    }, null, 2));
    return code;
  }
  const label = r => (typeof r === 'object' ? Object.entries(r).map(([n, x]) => `${n} r${x}`).join(', ') : `r${r}`);
  out(t('status.header', { dir, applied: label(applied), head: label(head) }));
  for (const [name, info] of Object.entries(tokens)) {
    if (!info) continue;
    const line = t('status.token', { name: info.name ?? t('status.adminToken'), scope: info.scope });
    out(`  ${trees.size > 1 ? `${name}: ` : ''}${line}`);
  }
  const counts = {};
  for (const s of states.values()) counts[s] = (counts[s] ?? 0) + 1;
  out(`  ${STATE_ORDER.filter(k => counts[k]).map(k => `${stateLabel(k)} ${counts[k]}`).join(' · ')}`);
  for (const [id, s] of states) if (s !== 'current') out(`  ${stateLabel(s)}  ${show(id)}`);
  for (const o of outputs) if (o.items.length === 0 && o.state !== 'current') out(`  ${stateLabel(o.state)}  ${o.path}`);
  if (personal && (personal.added.length || personal.removed.length || personal.items.length || personal.role)) {
    const list = keys => (keys.length ? keys.join(', ') : '-');
    // 다른 출처의 같은 이름에 가려진 더함은 받지 않는다 — 더함 줄에서 그렇게 보인다
    const hiddenBy = new Map(personal.shadowed.map(x => [x.id, x.by]));
    const shown = ids => ids.map(id => (hiddenBy.has(id) ? t('status.personalShadowed', { id, by: hiddenBy.get(id) }) : id));
    const role = personal.role;
    if (role) out(`  ${t('status.role', { name: role.name })}`);
    out(`  ${t('status.personalAdded', { count: personal.added.length, items: list(shown(personal.added)) })}`);
    out(`  ${t('status.personalRemoved', { count: personal.removed.length, items: list(personal.removed) })}`);
    if (role?.defined) {
      out(`  ${t('status.roleAdded', { name: role.name, count: role.added.length, items: list(shown(role.added)) })}`);
      out(`  ${t('status.roleRemoved', { name: role.name, count: role.removed.length, items: list(role.removed) })}`);
    } else if (role && inputs.personal.roleAnywhere) {
      // 어느 단위에도 없으면 role-missing 할 일이 알린다 — 이 단위에만 없는 것은 흔해(모노레포) 줄로만 보인다
      out(`  ${t('status.roleNotHere', { name: role.name })}`);
    }
    for (const { id, state } of personal.items) if (state !== 'current') out(`  ${t('status.personalCopy', { state: stateLabel(state), id })}`);
  }
  printTodos(todos, out);
  return code;
}
