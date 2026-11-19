import fs from 'node:fs';
import path from 'node:path';
import { expandPath, runGit, gitRoot } from '../projects.js';
import { MANIFEST, readManifest } from '../manifest.js';
import { NAME } from '../sources.js';
import { readRole, writeRole, roleFile } from '../role.js';
import { personalPlace, readLocal, writeLocal, LocalError } from '../personal.js';
import { printTodos } from '../todos.js';
import { projectApply } from './project-apply.js';
import { composeInputs, roleDefinedAnywhere, subUnits, defaultRunRuler } from './sync-common.js';
import { t } from '../i18n.js';

/**
 * guideline role: 이 워크트리의 역할을 보이고(action 없음), 정하고(use), 이 단위의 역할 정의를 지운다(remove).
 * 역할 파일은 워크트리에 하나라 use 는 실행한 단위와 상관없이 git 루트의 apply 와 같은 범위로 반영한다.
 * 0 완료, 1 반영 실패, 2 인자·이름·정의 문제(git 저장소가 아님 포함).
 * @returns {Promise<number>}
 */
export async function role({
  action, name, none = false, project, json = false, env = process.env, out = console.log, err = console.error, cwd = process.cwd(),
  runRuler = defaultRunRuler, git = runGit,
}) {
  const dir = project !== undefined ? expandPath(project) : cwd;
  if (action !== undefined && action !== 'use' && action !== 'remove') {
    err(t('role.unknownAction', { action }));
    return 2;
  }
  if (none && action !== 'use') {
    err(t('role.useArgs'));
    return 2;
  }
  const root = fs.existsSync(dir) && roleFile(dir, git) !== null ? gitRoot(dir, git) : null;
  if (!root) {
    err(t('role.notGit'));
    return 2;
  }
  if (action === undefined) return show({ dir, root, json, out, git });
  if (action === 'remove') return remove({ dir, root, name, json, out, err, git });

  if ((name === undefined) === !none) {
    err(t('role.useArgs'));
    return 2;
  }
  if (!none && !NAME.test(name)) {
    err(t('role.badName', { name }));
    return 2;
  }
  if (!none && !roleDefinedAnywhere(root, name, git)) {
    err(t('role.notDefined', { name }));
    return 2;
  }
  // 지난 역할로 펼친 선택: 그 역할만 더했던 ruler 출력(MCP·스킬)을 이번 조합이 에이전트 설정에서 지운다. 루트가 guideline 단위가
  // 아니면 하위 단위는 nested 조합이라 이것을 쓰지 않는다
  const prior = priorAt(root, git);
  writeRole(dir, none ? null : name, git);
  return projectApply({ dir: root, json, env, out, err, runRuler, git, prior });
}

/** git 루트 단위의 지금(역할을 바꾸기 전) 펼친 개인 선택. 루트가 guideline 단위가 아니거나 읽을 수 없으면 null. */
function priorAt(root, git) {
  if (!fs.existsSync(path.join(root, MANIFEST))) return null;
  try {
    return composeInputs({ project: root, unit: { root }, manifest: readManifest(root), git }).personal?.local ?? null;
  } catch {
    return null; // 깨진 매니페스트는 뒤이은 apply 가 알린다
  }
}

/** 이 워크트리의 git 루트와 그 아래 하위 단위마다 정의된 역할. 루트는 guideline 단위일 때만. 읽을 수 없는 local.json 은 빈 목록. */
function unitRoles(root, git) {
  const rels = [...(fs.existsSync(path.join(root, MANIFEST)) ? [''] : []), ...subUnits(root, git)];
  return rels.map(rel => {
    const place = personalPlace({ dir: path.join(root, ...rel.split('/').filter(Boolean)), root }, git);
    let roles = [];
    try {
      if (place) roles = Object.keys(readLocal(place.store).roles ?? {}).sort();
    } catch (e) {
      if (!(e instanceof LocalError)) throw e;
    }
    return { unit: rel === '' ? '.' : rel, roles };
  });
}

function show({ dir, root, json, out, git }) {
  const r = readRole(dir, git);
  const units = unitRoles(root, git);
  if (json) {
    out(JSON.stringify({ role: r.name, bad: r.bad, units }, null, 2));
    return 0;
  }
  out(r.bad ? t('role.bad') : r.name ? t('role.current', { name: r.name }) : t('role.noRole'));
  if (units.length) {
    out(t('role.unitsHeading'));
    for (const u of units) out(t('role.unitLine', { unit: u.unit, roles: u.roles.length ? u.roles.join(', ') : t('role.noRoles') }));
  }
  return 0;
}

/** 이 단위의 local.json 에서 역할 정의를 지운다. 반영은 하지 않는다 — 이 워크트리가 그 역할이면 apply 할 일 하나. */
function remove({ dir, root, name, json, out, err, git }) {
  if (name === undefined) {
    err(t('role.removeArgs'));
    return 2;
  }
  const place = personalPlace({ dir, root }, git);
  const unit = place?.unitRel || '.';
  let local;
  try {
    local = place ? readLocal(place.store) : null;
  } catch (e) {
    if (!(e instanceof LocalError)) throw e;
    err(e.message);
    return 2;
  }
  if (!local || !Object.hasOwn(local.roles ?? {}, name)) {
    err(t('role.notDefinedHere', { unit, name }));
    return 2;
  }
  const roles = { ...local.roles };
  delete roles[name];
  writeLocal(place.store, { ...local, roles });
  const todos = readRole(dir, git).name === name
    ? [{ kind: 'apply', item: null, scope: 'personal', message: t('todo.roleRemovedApply', { name }) }]
    : [];
  if (json) {
    out(JSON.stringify({ removed: name, todos }, null, 2));
    return 0;
  }
  out(t('role.removed', { unit, name }));
  printTodos(todos, out);
  return 0;
}
