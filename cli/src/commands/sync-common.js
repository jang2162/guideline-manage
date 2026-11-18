import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyFiles, writeFileAtomic, ApplyError } from '../apply.js';
import { MANIFEST, LOCK, manifestText, lockText, manifestVersionOnDisk, readManifest, readLock, ManifestError } from '../manifest.js';
import { printTodos } from '../todos.js';
import { rootNestedOn, nestedOffTodo, unitProblem } from '../unit.js';
import { compose, composedPath } from '../compose.js';
import { readBlock } from '../gitignore-block.js';
import { RULER_BLOCK, mcpFileOf, emptyMcpConfig } from '../ruler-outputs.js';
import { rulerAgentsEnabled } from '../project-state.js';
import { RULER_TOML, layoutOf } from '../layout.js';
import { strayRulerOutput } from '../stray.js';
import { fetchSources, manifestClashes } from '../workspace.js';
import { migrateLayout, preparePackage, readOnlyPrepareTodos } from '../migrate-layout.js';
import { personalPlace, readLocal, LocalError } from '../personal.js';
import { writeExclude, readExclude } from '../exclude.js';
import { writePersonal, personalRevisionTodos } from '../personal-sync.js';
import { runGit } from '../projects.js';
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

/** @returns {number} 종료 코드. quiet 면 ruler 의 출력을 보이지 않는다(프로젝트 기준 .gitignore 를 구하는 작업 트리 밖 실행). */
export function defaultRunRuler(bin, cwd, { quiet = false } = {}) {
  return spawnSync(bin, ['apply'], { cwd, stdio: quiet ? 'ignore' : 'inherit' }).status ?? 1;
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
export function rulerStep({ root, env, runRuler, todos, rootIsUnit = true, git = runGit }) {
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
    return;
  }
  // 루트 단위의 개인 겹이 ruler 출력 종류를 바꾸면 ruler 가 커밋되는 .gitignore 의 자기 블록을 바꾼다 — 프로젝트 기준으로 한 번 더 돌려
  // (작업 트리 밖) 그 블록을 구해 두었다가 되돌리고, 개인으로만 생긴 ruler 출력은 이 워크트리의 info/exclude 단위 블록에 적는다.
  const plan = rootIsUnit ? rootRulerPlan(root, git) : null;
  let base = null;
  if (plan?.ruler) {
    base = baselineGitignore({ root, plan: plan.ruler, bin, runRuler });
    if (base === null) todos.push({ kind: 'ruler-apply', item: null, message: t('todo.rulerBaselineFailed', { bin }) });
  }
  if (runRuler(bin, root) !== 0) todos.push({ kind: 'ruler-apply', item: null, message: t('todo.rulerFailed', { bin }) });
  if (plan) settleRulerOutputs({ root, place: plan.place, base, git, todos });
}

/**
 * git 루트 단위의 개인 겹(composeInputs)과, 그것이 ruler 출력 종류를 바꾸면 프로젝트 기준 ruler 입력(compose 의 ruler). 디스크는 읽기만 한다.
 * 루트가 새 배치 guideline 단위가 아니거나 개인 범위가 없으면(git 이 아님·local.json 깨짐) null.
 */
function rootRulerPlan(root, git) {
  const opened = openProject({ dir: root, err: () => {}, needManifest: false });
  if (opened.code !== undefined || !opened.manifest || layoutOf(opened.lock, root) !== 'guideline') return null;
  const inputs = composeInputs({ project: root, unit: { root }, git });
  if (!inputs.personal) return null;
  const composed = composeUnit({ project: root, nested: false, manifest: opened.manifest, personal: inputs.personal });
  return { place: inputs.personal, ruler: composed.ruler };
}

const RULER_SKIP = new Set(['__fixtures__', '__generated__', 'build', 'coverage', 'dist', 'fixtures', 'generated', 'node_modules', 'temp', 'tmp']);

/** ruler 0.3.44 의 findAllRulerDirs 처럼 root 아래 .ruler 폴더들(root 기준 상대 경로). 점으로 시작하는 폴더·흔한 빌드 폴더·다른 git 저장소는 들어가지 않는다. */
function rulerDirs(root) {
  const out = [];
  const walk = rel => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === '.ruler') out.push(r);
      else if (!e.name.startsWith('.') && !RULER_SKIP.has(e.name) && !(rel && fs.statSync(path.join(root, r, '.git'), { throwIfNoEntry: false })?.isDirectory())) walk(r);
    }
  };
  walk('');
  return out;
}

/** dir 에서 위로 stop(그 자신은 빼고)까지 빈 폴더를 지운다. */
function removeEmptyUp(dir, stop) {
  let d = dir;
  while (d.startsWith(`${stop}${path.sep}`)) {
    try {
      if (fs.readdirSync(d).length) return;
      fs.rmdirSync(d);
    } catch {
      return;
    }
    d = path.dirname(d);
  }
}

/**
 * 프로젝트 선택만으로 ruler 를 돌렸을 때의 .gitignore 글자. 작업 트리 밖 임시 폴더에 .ruler 폴더들(루트 것은 ruler 출력 종류를 가르는
 * 생성물을 프로젝트 기준으로 바꿔서)과 .gitignore 를 옮겨 ruler 를 돌린다 — ruler 블록은 출력 종류와 블록 밖 줄로만 정해진다. 실패하면 null.
 */
function baselineGitignore({ root, plan, bin, runRuler }) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guideline-ruler-')));
  try {
    for (const rel of rulerDirs(root)) fs.cpSync(path.join(root, rel), path.join(tmp, rel), { recursive: true, verbatimSymlinks: true });
    const rulerRoot = path.join(tmp, '.ruler');
    for (const p of plan.mine) {
      if (plan.baseline.has(p)) continue;
      const abs = path.join(tmp, ...p.split('/'));
      fs.rmSync(abs, { force: true });
      removeEmptyUp(path.dirname(abs), rulerRoot);
    }
    for (const [p, c] of plan.baseline) writeFileAtomic(path.join(tmp, ...p.split('/')), c);
    const gi = path.join(root, '.gitignore');
    if (fs.existsSync(gi)) fs.copyFileSync(gi, path.join(tmp, '.gitignore'));
    if (runRuler(bin, tmp, { quiet: true }) !== 0) return null;
    try {
      return fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
    } catch {
      return '';
    }
  } catch (e) {
    if (!e?.code) throw e;
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * ruler 를 돈 뒤: 이번 실행의 ruler 블록 중 프로젝트 기준(base, 없으면 지금 블록)에 없는 것을 info/exclude 의 이 워크트리 루트 단위
 * 블록에 적고(조합이 적은 줄은 그대로), 커밋되는 .gitignore 를 프로젝트 기준으로 되돌린다 — 그 순서라 개인 출력이 드러나는 틈이 없다.
 * 지난번에 블록에 적었던 ruler 개인 출력 중 이제 만들지 않는 것(개인 더함 되돌림)은 빈 폴더와 빈 claude·codex·opencode MCP 설정만
 * 지운다. 추적되는 것, 비지 않은 폴더, 서버나 다른 설정이 남은 MCP 설정, 다른 에이전트의 설정, .bak 은 두고 할 일로 알린다.
 */
function settleRulerOutputs({ root, place, base, git, todos }) {
  const giFile = path.join(root, '.gitignore');
  let real = null;
  try {
    real = fs.readFileSync(giFile, 'utf8');
  } catch {
    real = null;
  }
  const now = readBlock(real, RULER_BLOCK);
  const baseBlock = base === null ? now : readBlock(base, RULER_BLOCK);
  const extras = now.filter(p => !baseBlock.includes(p));
  const block = readExclude(place);
  const composedLine = l => composedPath(l.slice(1));
  const before = block.filter(l => !composedLine(l));
  try {
    writeExclude({ ...place, paths: [...block.filter(composedLine), ...extras] });
    if (base !== null && (real ?? '') !== base) writeFileAtomic(giFile, base);
  } catch (e) {
    if (!e?.code) throw e;
    todos.push({ kind: 'ruler-apply', item: null, message: t('todo.rulerIgnoreFailed', { reason: e.message }) });
    return;
  }
  for (const line of before) {
    if (extras.includes(line) || baseBlock.includes(line)) continue;
    const rel = line.slice(1);
    if (!rel || rel.split('/').some(s => s === '' || s === '.' || s === '..') || /[*?[\\]/.test(rel)) continue;
    const abs = path.join(root, ...rel.split('/'));
    if (!fs.existsSync(abs)) continue;
    // ruler 가 개인 더함 때문에 만든 것이 확실한 것만 지운다: 조합이 guideline 이름을 지운 뒤 빈 폴더(스킬·서브에이전트 자리), 서버도
    // 다른 설정도 남지 않은 claude·codex·opencode 의 MCP 설정. 그 밖(다른 에이전트의 설정, ruler 의 .bak)은 ruler 가 사람이 둔 파일에
    // merge 했거나 그 백업일 수 있어 두고 알린다. 추적되는 것도 둔다.
    const tracked = git(['ls-files', '--', rel], root);
    const isDir = fs.statSync(abs).isDirectory();
    const m = mcpFileOf(rel);
    const made = isDir ? fs.readdirSync(abs).length === 0 : !!m && emptyMcpConfig(abs, m);
    if (tracked.status !== 0 || tracked.stdout.trim() || !made) {
      todos.push({ kind: 'ruler-leftover', item: null, message: t('todo.rulerLeftover', { path: rel }) });
      continue;
    }
    if (isDir) fs.rmdirSync(abs);
    else fs.rmSync(abs, { force: true });
  }
}

/**
 * 렌더링 결과(.guideline/ 사본)를 단위 디렉터리에 쓰고, 매니페스트·잠금을 쓴 뒤 .guideline/ 에서 생성물을 조합해 쓰고
 * (git 루트면 그 아래 하위 단위도 apply 처럼 조합하고) git 루트에서 ruler apply 를 돈다 — 조합이 .ruler/ruler.toml 을 쓴 뒤에만 ruler 를 돌아야 모든 에이전트 몫(CLAUDE.md 등)이 생기지 않는다.
 * migration 은 이번 실행에서 먼저 한 이전(migrateIfOld)의 결과다. 이전이 있었으면 이 단계에서 쓴 것이 없어도 ruler 를 돈다 —
 * 이전이 바꾼 관리 지침이 AGENTS.md 에 들어가야 한다. 쓴/지운 목록에도 합친다.
 * sync({ trees, revisions }) 를 주면(update·pick) 프로젝트를 쓴 뒤 같은 원본으로 개인 사본도 받아 개인 저장소에 쓰고 그다음 조합한다.
 * @returns {{ code: number, unitsFailed?: true, written: string[], deleted: string[], todos: object[] }}
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
  // git 루트면 하위 단위도 ruler 전에 조합한다 — ruler 는 nested 로 그 단위들까지 돌므로, 안 그러면 낡은(클론 직후면 없는) 생성물로 돈다
  const subs = nested ? null : composeSubUnits({ root, subs: subUnits(root, git), err, git });
  if (subs) {
    applied = merged([...applied.written, ...subs.written], [...applied.deleted, ...subs.deleted]);
    todos.push(...subs.todos);
    if (subs.composed.length && !rootNestedOn(root)) todos.push(nestedOffTodo(root));
  }
  if (migration || applied.written.length || applied.deleted.length) rulerStep({ root, env, runRuler, todos, git });
  // prepare 가 아직 ruler apply 만 부르면 해결될 때까지 알린다(이전 때 한 번이면 놓친다). 바꾸는 것은 apply 의 몫이다.
  todos = mergeTodos(todos, readOnlyPrepareTodos({ project, root }));
  // 하위 단위 쓰기가 실패하면 1 — 이 단위의 매니페스트·잠금·생성물은 다 썼다(unitsFailed: 이 단위의 마무리는 이어 한다)
  if (subs?.failed) return { code: 1, unitsFailed: true, ...applied, todos };
  return { code: 0, ...applied, todos };
}

/**
 * pick --local 의 마무리: 커밋되는 파일(매니페스트·잠금·.guideline/ 사본)은 쓰지 않고, 받은 원본으로 개인 사본을 맞춘 뒤
 * 개인 겹을 넣어 생성물을 조합해 쓰고(git 루트면 그 아래 하위 단위도 apply 처럼 조합하고) ruler 를 돈다.
 * 개인 선택(local.json)은 이미 써 두었어야 한다 — 조합이 그것을 다시 읽는다. prior 는 그 전의 개인 선택(없으면 null). 하위 단위 쓰기만 실패해도 code 1.
 * @param {{ project: string, root?: string, nested?: boolean, manifest: object, sync: { trees: Map<string, object>, revisions: Record<string, number> },
 *   prior?: object | null, todos?: object[], env?: object, runRuler?: Function, err?: Function, git?: Function }} opts
 * @returns {{ code: number, written: string[], deleted: string[], todos: object[] }}
 */
export function finishPersonal({
  project, root = project, nested = false, manifest, sync, prior = null, todos: before = [], env = process.env, runRuler = defaultRunRuler, err = console.error,
  git = runGit,
}) {
  const inputs = composeInputs({ project, unit: { root }, git });
  let todos = [...before, ...inputs.todos];
  if (inputs.personal) todos = mergeTodos(todos, writePersonal({ personal: inputs.personal, manifest, nested, ...sync }));
  // 지난 개인 선택: 이번에 비웠어도 그 되돌림은 조합이 에이전트 설정에서 지운다
  const personal = inputs.personal && prior ? { ...inputs.personal, prior } : inputs.personal;
  const composed = composeWithStray({ project, nested, manifest, personal });
  todos = mergeTodos(todos, composed.todos);
  const w = writeComposedOrFail(project, composed.files, err, composed.exclude);
  if (w.failed) {
    err(t('apply.composeNotWritten'));
    return { code: 1, written: w.failed.written ?? [], deleted: w.failed.deleted ?? [], todos };
  }
  let written = w.written;
  let deleted = w.deleted;
  if (nested && !rootNestedOn(root)) todos.push(nestedOffTodo(root));
  // git 루트면 finishApply 처럼 하위 단위도 ruler 전에 조합한다 — 클론 직후라면 하위 단위 생성물이 아직 없다
  const subs = nested ? null : composeSubUnits({ root, subs: subUnits(root, git), err, git });
  if (subs) {
    written = union(written, subs.written);
    deleted = union(deleted, subs.deleted);
    todos.push(...subs.todos);
    if (subs.composed.length && !rootNestedOn(root)) todos.push(nestedOffTodo(root));
  }
  if (written.length || deleted.length) rulerStep({ root, env, runRuler, todos, git });
  todos = mergeTodos(todos, readOnlyPrepareTodos({ project, root }));
  return { code: subs?.failed ? 1 : 0, written, deleted, todos };
}

/** 개인 사본과 프로젝트 잠금의 리비전이 출처별로 다르면 알리는 할 일(개인 겹이 없으면 없음). */
export function revisionTodos(inputs, manifest, lock) {
  return inputs.personal ? personalRevisionTodos({ store: inputs.personal.store, manifest, local: inputs.personal.local, lock }) : [];
}

/** git 루트 아래 git 이 추적하는 하위 단위(guideline-lock.json 이 있는 디렉터리, 루트 자신은 빼고). 루트 기준 상대 경로, 정렬. */
export function subUnits(root, git = runGit) {
  const r = git(['ls-files', '-z', '--', `:(glob)**/${LOCK}`], root);
  if (r.status !== 0) return [];
  const dirs = r.stdout.split('\0').filter(f => f.includes('/') && path.posix.basename(f) === LOCK).map(f => path.posix.dirname(f));
  return [...new Set(dirs)].sort();
}

/**
 * 하위 단위들을 조합해 쓴다(ruler 는 돌지 않는다). 옛 배치 단위는 건너뛰고 그 단위에서 update 하라고, 열 수 없는 단위는 그 이유를 알린다.
 * 단위의 할 일·경로·쓰기 실패 메시지는 루트 기준으로 앞에 단위 경로를 붙인다. 쓰다 실패한 단위는 unit-write-failed 할 일을 낸다 —
 * 뒤이은 ruler 는 그 단위의 낡거나 반쯤 쓴 생성물로 AGENTS.md 등을 만든다.
 * 루트의 apply 와, 비중첩 단위(git 루트)의 update·pick(finishApply)·pick --local(finishPersonal)이 부른다.
 * @returns {{ written: string[], deleted: string[], todos: object[], composed: { rel: string, lock: object }[], failed: boolean }}
 */
export function composeSubUnits({ root, subs, err, git = runGit }) {
  const res = { written: [], deleted: [], todos: [], composed: [], failed: false };
  for (const rel of subs) {
    const dir = path.join(root, ...rel.split('/'));
    const inUnit = x => ({ ...x, unit: rel, message: t('apply.unitTodo', { dir: rel, message: x.message }) });
    const problems = [];
    const opened = openProject({ dir, err: m => problems.push(m) });
    if (opened.code !== undefined) {
      res.todos.push({ kind: 'unit-problem', item: null, unit: rel, message: t('todo.unitProblem', { dir: rel, reason: problems.join(' / ') }) });
      continue;
    }
    const layout = layoutOf(opened.lock, dir);
    if (layout !== 'guideline') {
      res.todos.push(layout === 'ruler'
        ? { kind: 'unit-update', item: null, unit: rel, message: t('todo.unitUpdate', { dir: rel }) }
        : { kind: 'unit-problem', item: null, unit: rel, message: t('todo.unitProblem', { dir: rel, reason: t('update.notYet') }) });
      continue;
    }
    const inputs = composeInputs({ project: dir, unit: { root }, git });
    const { files, todos, exclude } = composeWithStray({ project: dir, nested: true, manifest: opened.manifest, personal: inputs.personal });
    todos.unshift(...inputs.todos, ...revisionTodos(inputs, opened.manifest, opened.lock));
    const prep = preparePackage({ project: dir, root });
    todos.push(...prep.todos);
    const w = writeComposedOrFail(dir, { ...files, ...prep.files }, m => err(t('apply.unitTodo', { dir: rel, message: m })), exclude);
    const done = w.failed ?? w;
    res.written.push(...done.written.map(p => `${rel}/${p}`));
    res.deleted.push(...done.deleted.map(p => `${rel}/${p}`));
    res.todos.push(...todos.map(inUnit));
    if (w.failed) {
      res.failed = true;
      res.todos.push({ kind: 'unit-write-failed', item: null, unit: rel, message: t('todo.unitWriteFailed', { dir: rel }) });
    } else res.composed.push({ rel, lock: opened.lock });
  }
  return res;
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
export function finishMigrationOnly({ moved, root, env = process.env, runRuler = defaultRunRuler, err, git = runGit }) {
  const todos = [...moved.todos];
  if (moved.migration) rulerStep({ root, env, runRuler, todos, git });
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
