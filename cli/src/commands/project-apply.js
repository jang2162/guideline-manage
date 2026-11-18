import fs from 'node:fs';
import path from 'node:path';
import { expandPath, runGit } from '../projects.js';
import { MANIFEST } from '../manifest.js';
import { layoutOf, RULER_TOML } from '../layout.js';
import { unitInfo, rootNestedOn, nestedOffTodo } from '../unit.js';
import { revisionLabel } from './project-update.js';
import {
  composeWithStray, composeInputs, writeComposedOrFail, rulerStep, report, defaultRunRuler, openProject, subUnits, composeSubUnits, revisionTodos,
} from './sync-common.js';
import { preparePackage } from '../migrate-layout.js';
import { t } from '../i18n.js';

/**
 * 서버 없이 .guideline/ 에서 생성물을 조합해 쓰고 git 루트에서 ruler 를 돈다. 클론·새 워크트리 직후, prepare 에서 쓴다.
 * dir(단위 디렉터리)를 주지 않으면 --project, 그것도 없으면 cwd. 0 완료, 1 쓰기 실패, 2 받은 적 없음·이전 전 배치·단위 문제
 * (루트가 guideline 프로젝트가 아니면 조합한 하위 단위가 하나도 없을 때).
 * git 루트에서 부르면 git 이 추적하는 하위 단위(guideline-lock.json 이 있는 디렉터리)도 조합한 뒤 ruler 를 한 번 돈다 — ruler 는
 * nested 로 하위 단위까지 돌므로, 루트의 prepare 하나로 클론의 모든 단위가 채워져야 한다. 루트가 guideline 프로젝트가 아니어도
 * (guideline.json 이 없어도) 하위 단위가 있으면 그것들을 조합한다.
 * @returns {Promise<number>}
 */
export async function projectApply({
  dir: given, project, json = false, env = process.env, out = console.log, err = console.error, cwd = process.cwd(), runRuler = defaultRunRuler, git = runGit,
}) {
  const dir = given ?? (project !== undefined ? expandPath(project) : cwd);
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, MANIFEST))) {
    const unit = unitInfo(dir, git);
    const subs = unit.nested ? [] : subUnits(unit.root, git);
    if (subs.length) return applyUnitsOnly({ root: unit.root, subs, json, env, out, err, runRuler, git });
  }
  const opened = openProject({ dir, err });
  if (opened.code !== undefined) return opened.code;
  const { manifest, lock } = opened;
  const layout = layoutOf(lock, dir);
  if (layout === 'ruler') {
    err(t('apply.needsUpdate'));
    return 2;
  }
  if (layout === 'none') {
    err(t('update.notYet'));
    return 2;
  }

  const unit = unitInfo(dir, git);
  const inputs = composeInputs({ project: dir, unit, git });
  const { files, todos, exclude } = composeWithStray({ project: dir, nested: unit.nested, manifest, personal: inputs.personal });
  todos.unshift(...inputs.todos, ...revisionTodos(inputs, manifest, lock));
  // prepare 가 아직 ruler apply 를 부르면 고친다(guideline-manage 를 설치한 뒤 처음 apply 에서 바뀐다)
  const prep = preparePackage({ project: dir, root: unit.root });
  todos.push(...prep.todos);
  const w = writeComposedOrFail(dir, { ...files, ...prep.files }, err, exclude);
  if (w.failed) return 1;
  if (unit.nested && !rootNestedOn(unit.root)) todos.push(nestedOffTodo(unit.root));
  const subs = unit.nested ? null : composeSubUnits({ root: unit.root, subs: subUnits(unit.root, git), err, git });
  if (subs) {
    w.written.push(...subs.written);
    w.deleted.push(...subs.deleted);
    todos.push(...subs.todos);
    if (subs.composed.length && !rootNestedOn(unit.root)) todos.push(nestedOffTodo(unit.root));
  }
  // apply 는 ruler apply 를 대신하므로 바뀐 것이 없어도 ruler 를 돈다(에이전트 파일만 지워진 경우).
  rulerStep({ root: unit.root, env, runRuler, todos });
  report({ result: { revision: revisionLabel(lock.revisions), written: w.written, deleted: w.deleted, todos }, json, out });
  return subs?.failed ? 1 : 0;
}

/** 루트가 guideline 프로젝트가 아닌 모노레포: 하위 단위만 조합하고 루트에서 ruler 를 돈다(루트의 ruler.toml 은 프로젝트가 둔 것). */
function applyUnitsOnly({ root, subs, json, env, out, err, runRuler, git }) {
  const r = composeSubUnits({ root, subs, err, git });
  const todos = [...r.todos];
  // 이 루트는 guideline 이 ruler.toml 을 조합하지 않는다: ruler 가 읽는 것은 프로젝트가 둔 RULER_TOML 뿐이다. 그것이 없으면 ruler 를 돌지
  // 않고 root-ruler-toml 이 그것을 두라고 하므로 nested-off 는 내지 않는다
  const hasToml = fs.existsSync(path.join(root, ...RULER_TOML.split('/')));
  if (r.composed.length && hasToml && !rootNestedOn(root, RULER_TOML)) todos.push(nestedOffTodo(root, RULER_TOML));
  if (r.composed.length) rulerStep({ root, env, runRuler, todos, rootIsUnit: false });
  // 단위마다 리비전: 출처가 하나면 「단위 r1」, 여럿이면 「단위:출처 r1」
  const revision = {};
  for (const { rel, lock } of r.composed) {
    const names = Object.keys(lock.revisions);
    for (const n of names) revision[names.length === 1 ? rel : `${rel}:${n}`] = lock.revisions[n];
  }
  report({ result: { revision, written: r.written, deleted: r.deleted, todos }, json, out });
  // 조합한 단위가 하나도 없으면(모두 옛 배치 등) 단위 하나에서 apply 할 수 없을 때와 같은 2
  return r.failed ? 1 : r.composed.length ? 0 : 2;
}
