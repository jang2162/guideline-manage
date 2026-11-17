import { expandPath, runGit } from '../projects.js';
import { layoutOf } from '../layout.js';
import { unitInfo, rootNestedOn, nestedOffTodo } from '../unit.js';
import { openProject, revisionLabel } from './project-update.js';
import { composeWithStray, writeComposedOrFail, rulerStep, report, defaultRunRuler } from './sync-common.js';
import { preparePackage } from '../migrate-layout.js';
import { t } from '../i18n.js';

/**
 * 서버 없이 .guideline/ 에서 생성물을 조합해 쓰고 git 루트에서 ruler 를 돈다. 클론·새 워크트리 직후, prepare 에서 쓴다.
 * dir(단위 디렉터리)를 주지 않으면 --project, 그것도 없으면 cwd. 0 완료, 1 쓰기 실패, 2 받은 적 없음·이전 전 배치·단위 문제.
 * @returns {Promise<number>}
 */
export async function projectApply({
  dir: given, project, json = false, env = process.env, out = console.log, err = console.error, cwd = process.cwd(), runRuler = defaultRunRuler, git = runGit,
}) {
  const dir = given ?? (project !== undefined ? expandPath(project) : cwd);
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
  const { files, todos } = composeWithStray({ project: dir, nested: unit.nested, manifest });
  // prepare 가 아직 ruler apply 를 부르면 고친다(guideline-manage 를 설치한 뒤 처음 apply 에서 바뀐다)
  const prep = preparePackage({ project: dir, root: unit.root });
  todos.push(...prep.todos);
  const w = writeComposedOrFail(dir, { ...files, ...prep.files }, err);
  if (w.failed) return 1;
  if (unit.nested && !rootNestedOn(unit.root)) todos.push(nestedOffTodo(unit.root));
  // apply 는 ruler apply 를 대신하므로 바뀐 것이 없어도 ruler 를 돈다(에이전트 파일만 지워진 경우).
  rulerStep({ root: unit.root, env, runRuler, todos });
  report({ result: { revision: revisionLabel(lock.revisions), written: w.written, deleted: w.deleted, todos }, json, out });
  return 0;
}
