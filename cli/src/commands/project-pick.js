import fs from 'node:fs';
import path from 'node:path';
import { openBrowser } from '../browser.js';
import { expandPath, baseDir, newProjectTarget, projectStatus, createProject, runGit } from '../projects.js';
import { readManifest, readLock, ManifestError } from '../manifest.js';
import { remoteClient, loadSource, explain } from '../remote.js';
import { tokenFor, virtualize, toRealLock, fetchSources, aliasMoveTodos, protectedPaths } from '../workspace.js';
import { realOf, unitOf, unitName, finalUnit, toVirtual, collisions, collisionMessage, NAME } from '../sources.js';
import { catalogView } from '../catalog-view.js';
import { blockKeys } from '../catalog.js';
import { blockKey, isBlockKey, isWithin, withAncestors } from '../blocks.js';
import { personalPlace, readLocal, writeLocal, effectiveItems, shadowedAdds, roleBasis, LocalError } from '../personal.js';
import { readDefaults, writeDefaults, roleDefaultsFor, DefaultsError } from '../defaults.js';
import { layoutOf } from '../layout.js';
import { openProject } from './project-update.js';
import { splitQualified } from '../manifest.js';
import { revisionLabel } from './project-update.js';
import { inferAgents, formPayload, diskReader } from '../project-state.js';
import { unitInfo, unitProblem, rootStacks } from '../unit.js';
import { render } from '../render/index.js';
import { RULER_TOML_BASE, NESTED_TOML_BASE } from '../render/outputs.js';
import { rulerTomlText, PROJECT_TOML, RULER_TOML } from '../layout.js';
import { initialChoices, buildSelection, personalChoices, personalSelection } from '../selection.js';
import { finishApply, finishPersonal, report, migrateIfOld, manifestV3Todos, finishMigrationOnly } from './sync-common.js';
import { t } from '../i18n.js';

const isDir = p => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * 서버 폼으로 고르고 이 단위 디렉터리에 반영한다. 0 완료, 3 취소·만료, 1 오류, 2 사용법 오류.
 * @returns {Promise<number>}
 */
export async function projectPick({
  project, newTarget, server, source, browser = true, json = false, env = process.env, out = console.log, err = console.error,
  open = openBrowser, fetchImpl = fetch, git = runGit, home, cwd = process.cwd(), pollWait = 30, runRuler,
  recommend, readStdin = readAllStdin, local = false, role, yes = false,
}) {
  // --yes: 추천을 폼 없이 그대로 제출한다. 추천이 없으면 제출할 것이 없고, 새 프로젝트는 폼(에이전트 고르기)을 거친다.
  if (yes && recommend === undefined) {
    err(t('pick.yesNeedsRecommend'));
    return 2;
  }
  if (yes && newTarget !== undefined) {
    err(t('pick.yesAndNew'));
    return 2;
  }
  if (role !== undefined && !local) {
    err(t('pick.roleNeedsLocal'));
    return 2;
  }
  if (local) {
    return pickLocal({
      project, newTarget, server, source, browser, json, env, out, err, open, fetchImpl, git, home, cwd, pollWait, runRuler, recommend, readStdin,
      role: role ?? null, yes,
    });
  }
  if (project !== undefined && newTarget !== undefined) {
    err(t('pick.projectAndNew'));
    return 2;
  }
  let dir;
  const isNew = newTarget !== undefined;
  if (isNew) {
    const t = newTarget.trim();
    const byPath = t.includes('/') || t.startsWith('~');
    const r = newProjectTarget({ name: byPath ? undefined : t, path: byPath ? t : undefined, base: baseDir(env) });
    if (r.error) {
      err(r.error);
      return 2;
    }
    dir = r.path;
  } else {
    dir = project !== undefined ? expandPath(project) : cwd;
    if (!isDir(dir)) {
      err(t('common.notDir', { dir }));
      return 2;
    }
  }

  let manifest = null;
  let lock = null;
  if (!isNew) {
    try {
      manifest = readManifest(dir);
      lock = readLock(dir);
    } catch (e) {
      if (!(e instanceof ManifestError)) throw e;
      err(e.message);
      return 1;
    }
    const problem = unitProblem(dir, manifest);
    if (problem) {
      err(problem);
      return 2;
    }
  }
  const names = Object.keys(manifest?.sources ?? {});
  if (source !== undefined && !NAME.test(source)) {
    err(t('pick.badSourceName', { name: source }));
    return 2;
  }
  if (server !== undefined && source === undefined && names.length > 1) {
    err(t('common.serverWithManySources'));
    return 2;
  }
  // 열 출처: --source 하나, 아니면 매니페스트의 출처 전부(이름순). 매니페스트가 없으면 default 하나.
  const targets = source !== undefined ? [source] : names.length ? [...names].sort() : ['default'];
  const base = manifest ?? { version: 2, form: 'ruler', agents: [], sources: {} };
  const sources = structuredClone(base.sources);
  for (const name of targets) {
    const cur = sources[name];
    const url = trim(server ?? cur?.server ?? (names.length === 0 ? env.GUIDELINE_SERVER : undefined) ?? '');
    if (!url) {
      err(names.length === 0 ? t('common.noServer')
        : cur ? t('pick.sourceNoServer', { name }) : t('pick.unknownSource', { name }));
      return 2;
    }
    // 필수는 그대로 옮긴다(폼 결과가 필수를 싣지 않으면 이것이 남는다). 버리면 pick 이 필수를 소리 없이 지운다.
    sources[name] = { server: url, items: cur?.items ?? [], aliases: cur?.aliases ?? {}, required: cur?.required ?? [] };
  }
  let recommended = null;
  if (recommend !== undefined) {
    // 추천은 출처 하나의 실제 이름으로 받는다. 출처마다 폼을 차례로 열기 때문에 여러 출처를 미리 검사할 수 없다.
    if (targets.length > 1) {
      err(t('pick.recommendOneSource'));
      return 2;
    }
    recommended = await readRecommend(recommend, { cwd, readStdin });
    if (recommended.error) {
      err(recommended.error);
      return 2;
    }
    const conflict = recommendConflicts(recommended.value);
    if (conflict.length) {
      for (const m of conflict) err(m);
      return 2;
    }
  }
  const working = { ...base, sources };
  const single = Object.keys(sources).length === 1;

  const unit = isNew ? { dir, root: dir, nested: false } : unitInfo(dir, git);
  if (yes) {
    // 폼은 커밋하지 않은 변경·git 밖의 프로젝트에서 「그래도 진행」 을 묻는다. 폼 없이는 묻지 않고 거절한다 — 아무것도 쓰기 전에(배치 옮기기 전에)
    const before = projectStatus(dir, git, unit.root);
    if (!before.gitRepo || before.dirty) {
      err(t(before.gitRepo ? 'pick.yesDirty' : 'pick.yesNotGit', { dir }));
      return 2;
    }
  }
  // 추천은 받은 원본으로 검사한다 — 배치 옮기기(쓰기) 전에. 거절하면 아무것도 쓰지 않는다. 받은 원본은 아래에서 그대로 쓴다.
  const preloaded = new Map();
  if (recommended) {
    const name = targets[0];
    const { server: url } = sources[name];
    try {
      preloaded.set(name, await loadSource(remoteClient({ server: url, token: tokenFor(url, { env, home, single }), fetchImpl })));
    } catch {
      // 받지 못하면 아래의 같은 받기가 실패로 알린다
    }
    const src = preloaded.get(name);
    const bad = src ? recommendInvalid(recommended.value, { keys: blockKeys(src.tree), required: sources[name].required }) : [];
    if (bad.length) {
      for (const m of bad) err(m);
      return 2;
    }
  }
  const v3 = isNew ? [] : manifestV3Todos(dir);
  // 옛 배치면 폼을 만들기 전에 새 배치로 옮긴다 — 폼이 .guideline/ 사본과 원본을 비교하고 반영도 새 배치로 쓴다
  let migrated = { todos: [], migration: null };
  if (manifest) {
    const servers = Object.fromEntries(Object.entries(manifest.sources).map(([n, s]) => [n, { ...s, server: sources[n]?.server ?? s.server }]));
    const moved = await migrateIfOld({ dir, unit, manifest: { ...manifest, sources: servers }, lock, env, home, fetchImpl, git, err });
    if (moved.code !== undefined) return moved.code;
    lock = moved.lock;
    migrated = moved;
  }
  const status = isNew ? { gitRepo: false, dirty: false } : projectStatus(dir, git, unit.root);
  // 중첩 단위에 ruler.toml 이 아직 없으면 git 루트의 에이전트를 따른다
  const agentsFrom = unit.nested && rulerTomlText(dir) === null ? unit.root : dir;
  const agents = manifest?.agents ?? (isNew ? null : inferAgents(agentsFrom));
  if (agents) working.agents = agents;

  const fetched = new Map();
  const submitted = new Map();
  const failures = [];
  let finalAgents = agents;
  for (const name of targets) {
    const { server: url } = sources[name];
    // 토큰이 없어도 공개 서버(PUBLIC_READ)에서는 받을 수 있다. 비공개면 서버의 401 이 로그인 안내가 된다.
    const token = tokenFor(url, { env, home, single });
    const client = remoteClient({ server: url, token, fetchImpl });
    let src = preloaded.get(name);
    try {
      src ??= await loadSource(client);
    } catch (e) {
      failures.push(`${name}: ${explain(e, url)}`);
      continue;
    }
    const tree = { server: url, revision: src.revision, tree: src.tree, client };
    fetched.set(name, tree);
    // 이 출처만 본 가상 원본·잠금으로 폼을 만든다. 다른 출처가 쓰는 최종 이름은 막는다.
    const only = { ...working, sources: { [name]: sources[name] } };
    const v = virtualize({ manifest: only, lock: lock && lockOf(lock, name), trees: new Map([[name, tree]]) });
    const aliases = sources[name].aliases ?? {};
    const payload = formPayload({
      tree: v.tree, revision: src.revision, projectPath: dir, isNew, agents, status,
      manifest: manifest && Object.hasOwn(base.sources, name) ? v.view : null, lock: v.viewLock,
      nested: unit.nested, rootStacks: unit.nested ? rootStacks(unit.root) : [], management: v.management,
      required: sources[name].required.map(k => toVirtual(k, aliases)),
    });
    if (recommended) {
      // 검사는 배치 옮기기 전에 했다(recommendInvalid)
      const { add: ra, remove: rr } = recommended.value;
      const vk = k => finalUnit(k, aliases);
      payload.recommend = Object.fromEntries(Object.entries(ra).map(([k, why]) => [vk(k), why]));
      if (Object.keys(rr).length) payload.recommendRemove = Object.fromEntries(Object.entries(rr).map(([k, why]) => [vk(k), why]));
    }
    const takenBy = takenUnits(sources, name);
    const othersOwn = otherOwned(sources, lock, name);
    payload.catalog = withVirtualRequires(catalogView(v.tree), aliases);
    payload.items = payload.items
      .filter(it => it.kind !== 'orphan' || !othersOwn(it.id))
      .map(it => {
        const owner = it.kind !== 'orphan' && takenBy(unitOf(it.id));
        return owner ? { ...it, state: 'blocked', reason: t('pick.nameTaken', { owner }) } : it;
      });

    // --yes: 폼을 만들지 않고, 폼이 처음 보일 체크(selection.js initialChoices) 그대로 제출한 결과를 만든다
    const round = yes
      ? { result: { status: 'submitted', selection: yesSelection(payload, src.revision) } }
      : await formRound({ client, payload, name, many: targets.length > 1, url, browser, open, err, pollWait });
    if (round.failure) failures.push(round.failure);
    if (!round.result) continue;
    const sel = round.result.selection;
    if (sel.project) finalAgents = sel.project.agents;
    // 폼은 아직 파일마다 고른다. 매니페스트는 블록 키라, 남긴 파일·키를 그 블록(조상 스택 포함)으로 올린다 —
    // 같은 스택의 파일이 하나라도 남으면 그 스택을 받는다. 매니페스트에 있던 블록 중 막힌 파일이 있는 것도 그대로 둔다.
    const keep = sel.items.filter(i => i.kind !== 'orphan' && i.action !== 'remove').map(i => blockKey(i.id));
    const stillBlocked = v.view.items.filter(k => sel.blocked.some(b => blockKey(b.id) === k));
    const real = id => realOf(id, v.sources)?.id ?? id;
    const items = withAncestors([...keep, ...stillBlocked].filter(Boolean).map(real));
    // 필수: 폼 결과에 있으면 그것(실제 이름), 없으면(옛 서버·옛 화면) 지금 필수. 어느 쪽이든 남은 items 안의 것만 —
    // 매니페스트는 필수가 items 안에 있어야 하고, 쓰는 길(manifestText)은 그것을 다시 검사하지 않는다.
    const kept = new Set(items);
    const required = (Array.isArray(sel.required) ? sel.required.map(real) : sources[name].required).filter(k => kept.has(k));
    sources[name] = { ...sources[name], items, required: [...new Set(required)].sort() };
    // 지울 수 있는 고아는 이 폼에 올린 것뿐이다(제출을 믿지 않는다)
    const offered = new Set(payload.items.filter(i => i.kind === 'orphan').map(i => i.id));
    submitted.set(name, { sel, v, revision: sel.revision, overrides: payload.overrides, offered });
  }
  for (const f of failures) err(f);
  if (submitted.size === 0) {
    // 옮긴 것은 이미 썼다 — 고르지 않았어도 그 할 일(커밋하라)은 알리고, 옮겼으면 ruler 를 돌아 AGENTS.md 를 맞춘다
    finishMigrationOnly({ moved: migrated, root: unit.root, env, runRuler, err });
    return failures.length ? 1 : 3;
  }

  // 제출하지 않은 새 출처는 매니페스트에 남기지 않는다
  for (const name of targets) if (!submitted.has(name) && !Object.hasOwn(base.sources, name)) delete sources[name];
  const nextManifest = { ...working, agents: finalAgents ?? ['claude'], sources };
  const clash = collisions(Object.entries(sources).map(([n, x]) => ({ name: n, ...x })));
  if (clash.length) {
    for (const c of clash) err(collisionMessage(c));
    return 2;
  }

  if (isNew) {
    const c = createProject(dir, git);
    if (c.error) {
      err(c.error);
      return 1;
    }
  }
  // 고른 출처는 폼의 리비전, 나머지는 잠금의 리비전으로 렌더링한다
  const trees = new Map([...submitted].map(([name]) => [name, fetched.get(name)]));
  const rest = Object.keys(sources).filter(n => !submitted.has(n));
  const others = rest.length
    ? await fetchSources({ manifest: { ...nextManifest, sources: Object.fromEntries(rest.map(n => [n, sources[n]])) }, lock, latest: new Set(), single, env, home, fetchImpl })
    : { trees: new Map(), failures: [] };
  for (const [n, t] of others.trees) trees.set(n, t);
  for (const f of others.failures) err(`${f.source}: ${f.message}`);

  const failed = others.failures.map(f => f.source);
  const protect = protectedPaths({ manifest: nextManifest, lock, failed });
  const v = virtualize({ manifest: nextManifest, lock, trees, protect });
  // 렌더링의 결정은 폼에서 사용자가 바꾼 것(받기·지우기·덮어쓰기·막힘)만 싣는다. 고른 스택의 파일은 매니페스트의 블록 키로 렌더링이 펼친다.
  const decisions = {};
  const orphans = [];
  for (const [name, { sel, offered }] of submitted) {
    // 같은 가상 id 를 다른 출처가 가질 수 있다(다른 출처가 쓰는 이름이라 이 폼에서 막힌 항목). 그 결정은 이 출처의 항목에만 준다.
    const own = id => realOf(id, v.sources)?.source === name;
    // 폼에 올리지 않은 고아 id 는 조작된 제출이다. 지울 범위가 디렉터리 트리라 할 일·경고 없이 버린다.
    const items = sel.items.filter(i => i.kind !== 'orphan' || offered.has(i.id));
    // --yes 의 뺌은 「풀면 지움」 동의가 아니다: 프로젝트에서 고친 사본은 지우지 않고 leftover 할 일로 남긴다(고치지 않은 사본은 지운다)
    const consent = a => (yes && a === 'remove' ? null : a);
    for (const i of items) if (i.kind === 'orphan' || own(i.id)) decisions[i.id] = { action: consent(i.action), overwrite: i.overwrite === true, state: i.state };
    for (const b of sel.blocked) if (own(b.id)) decisions[b.id] = { state: 'blocked', reason: b.reason };
    orphans.push(...items.filter(i => i.kind === 'orphan' && i.action === 'remove').flatMap(i => orphanFiles(dir, i.id)));
  }
  const rendered = render({
    tree: v.tree, revision: 0, manifest: v.view, lock: v.viewLock, project: diskReader(dir), decisions, orphans, nested: unit.nested, management: v.management,
  });
  for (const p of protect) delete rendered.files[p];
  const revisions = Object.fromEntries([...trees].map(([n, t]) => [n, submitted.get(n)?.revision ?? t.revision]));
  const realLock = toRealLock({ viewLock: rendered.lock, sources: v.sources, revisions, previous: lock, keep: failed, protect });
  rendered.todos.push(...v.problems, ...aliasMoveTodos({ previous: lock, next: realLock, project: dir }));
  rendered.todos.unshift(...migrated.todos, ...v3);
  for (const { overrides } of submitted.values()) {
    for (const o of overrides.filter(x => !x.valid)) {
      rendered.todos.push({ kind: 'override', item: o.target, message: `${o.file} 「${o.heading}」: ${o.reason}` });
    }
  }
  let moved = false;
  if (!fs.existsSync(path.join(dir, ...PROJECT_TOML.split('/')))) {
    const first = projectTomlFirst(dir, unit.nested, nextManifest.agents);
    rendered.files[PROJECT_TOML] = first.content;
    moved = first.moved;
  }
  const done = finishApply({
    project: dir, root: unit.root, nested: unit.nested, result: rendered, manifest: nextManifest, lock: realLock, env, runRuler, err, git, migration: migrated.migration,
    sync: { trees, revisions },
  });
  // 하위 단위 쓰기만 실패했으면 이 단위는 다 썼다 — 옮긴 ruler.toml 은 추적에서 뺀다
  if ((done.code === 0 || done.unitsFailed) && moved) done.todos.push(...untrackMoved(dir, git));
  report({ result: { ...done, revision: revisionLabel(revisions) }, json, out });
  if (done.code !== 0) return done.code;
  return failures.length || others.failures.length ? 1 : 0;
}

const trim = s => s.replace(/\/+$/, '');

/**
 * 폼 하나를 만들고 브라우저를 열어 결과를 기다린다. needMode 를 주면 그 모드를 모르는 서버(응답 modes 에 없음)의 폼은 취소한다.
 * @returns {Promise<{ result: object | null, failure?: string }>} 제출되지 않았으면 result 는 null(취소·만료는 failure 없이 알린다)
 */
async function formRound({ client, payload, name, many, url, browser, open, err, pollWait, needMode }) {
  let result;
  try {
    const form = await client.createForm(payload);
    // 옛 서버는 스택 단위 폼을 모르고 파일마다 고르는 폼을 띄운다(formVersion 없음). 개인 모드를 모르는 서버는 그 폼을 프로젝트 모드로
    // 띄운다 — 제출하면 프로젝트 선택이 바뀐다. 열어 둔 폼을 닫고 이 출처는 건너뛴다(고른 출처가 없으면 코드 1).
    const old = form.formVersion === undefined ? 'pick.serverOld'
      : needMode && !(Array.isArray(form.modes) && form.modes.includes(needMode)) ? 'pick.serverOldPersonal' : null;
    if (old) {
      await client.cancelForm(form.url).catch(() => {});
      return { result: null, failure: `${name}: ${t(old)}` };
    }
    err(many ? t('pick.sourceForm', { name, url: form.url }) : t('pick.form', { url: form.url }));
    if (browser) open(form.url);
    do {
      result = await client.formResult(form.id, pollWait, new URL(form.url).searchParams.get('k'));
    } while (result.status === 'pending');
  } catch (e) {
    return { result: null, failure: `${name}: ${e.status === 404 ? t('pick.formGone') : explain(e, url)}` };
  }
  if (result.status !== 'submitted') {
    err(t('pick.notSubmitted', { prefix: many ? `${name}: ` : '', reason: result.status === 'cancelled' ? t('pick.cancelled') : t('pick.expired') }));
    return { result: null };
  }
  return { result };
}

/**
 * 새 배치로 시작할 때의 .ruler/ruler.project.toml. 프로젝트가 둔 ruler.toml 이 있으면 그 설정을 옮긴다(처음 받는 프로젝트라 지침 서버가
 * 넣은 MCP 표가 없다). 없으면 기본 설정 — 조합이 이것에 고른 MCP 를 얹어 ruler.toml 을 만든다.
 */
function projectTomlFirst(dir, nested, agents) {
  try {
    return { content: fs.readFileSync(path.join(dir, ...RULER_TOML.split('/'))), moved: true };
  } catch {
    return { content: Buffer.from((nested ? NESTED_TOML_BASE : RULER_TOML_BASE)(agents)), moved: false };
  }
}

/**
 * 옮긴 뒤의 ruler.toml 은 조합이 만드는 생성물(.gitignore 블록)이다. git 이 추적 중이면 인덱스에서만 뺀다(파일은 조합 결과로 남는다) —
 * 그대로 두면 조합할 때마다 고친 파일로 보이고, 커밋하면 클론에 낡은 설정이 따라간다. 이전(update·pick 의 배치 옮기기)과 같은 방식이다.
 * 뺐으면 커밋하라고, 못 뺐으면 명령을 할 일로 낸다.
 */
function untrackMoved(dir, git) {
  if (git(['ls-files', '--error-unmatch', '--', RULER_TOML], dir).status !== 0) return [];
  if (git(['rm', '--cached', '--quiet', '--', RULER_TOML], dir).status === 0) {
    return [{ kind: 'untracked', item: null, message: t('todo.untracked', { path: RULER_TOML, to: PROJECT_TOML }) }];
  }
  return [{ kind: 'untracked', item: null, message: t('todo.untrackFailed', { path: RULER_TOML, dir }) }];
}

/** 잠금에서 출처 하나의 것만. 폼이 그 출처의 사본 상태만 보게 한다. */
/**
 * 지울 고아의 파일들. 새 배치의 스킬·MCP 고아는 디렉터리 하나라 그 안의 파일을 모두 지운다 — 숨은 파일(.DS_Store)까지 지워야
 * 폴더가 비어 정리되고 다음 폼에 같은 고아가 다시 뜨지 않는다. 심볼릭 링크는 따라가지 않고 링크 자체를 지운다.
 */
function orphanFiles(dir, id) {
  const abs = path.join(dir, ...id.split('/'));
  if (!fs.existsSync(abs) || !fs.lstatSync(abs).isDirectory()) return [id];
  const out = [];
  const walk = rel => {
    for (const d of fs.readdirSync(path.join(abs, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(r);
      else out.push(`${id}/${r}`);
    }
  };
  walk('');
  return out.sort();
}

function lockOf(lock, name) {
  const mine = q => splitQualified(q).source === name;
  return {
    version: lock.version,
    revisions: lock.revisions[name] ? { [name]: lock.revisions[name] } : {},
    sources: Object.fromEntries(Object.entries(lock.sources).filter(([q]) => mine(q))),
    outputs: lock.outputs.filter(o => o.items.length > 0 && o.items.every(mine)),
  };
}

/**
 * 단위 → 그것을 쓰는 다른 출처(없으면 undefined). 다른 출처가 쓰는 최종 단위와 같거나, 한쪽이 다른 쪽 안(조상·자손 스택)이면
 * 그 출처의 것이다 — 고르면 collisions 가 충돌로 막는다.
 * @returns {(unit: string | null) => string | undefined}
 */
function takenUnits(sources, name) {
  const taken = [];
  for (const [other, s] of Object.entries(sources)) {
    if (other === name) continue;
    for (const id of s.items) {
      const u = unitOf(id);
      if (u) taken.push([finalUnit(u, s.aliases ?? {}), other]);
    }
  }
  return unit => (unit ? taken.find(([f]) => isWithin(unit, f) || isWithin(f, unit))?.[1] : undefined);
}

/**
 * 다른 출처의 사본인가. 다른 출처의 잠금 출력이거나, 그 경로를 품는 가장 깊은 최종 스택 자리(.guideline/rules/<스택 경로>/)를 다른 출처가 쓴다 — 부모 스택을 다른 출처가 가졌어도 자식 폴더는 자식 소유자의 것이다.
 * 출처 하나의 폼이 다른 출처의 사본을 「원본에서 사라짐」 으로 보이지 않게 한다.
 */
function otherOwned(sources, lock, name) {
  const paths = new Set((lock?.outputs ?? [])
    .filter(o => o.items.length > 0 && o.items.every(q => splitQualified(q).source !== name))
    .map(o => o.path));
  const stacks = new Map();
  for (const [source, s] of Object.entries(sources)) {
    for (const id of s.items) {
      const u = unitOf(id);
      if (u?.startsWith('rules/')) stacks.set(unitName(finalUnit(u, s.aliases ?? {})), source);
    }
  }
  const ownerOf = p => {
    const m = /^\.guideline\/rules\/(.+)\/[^/]+$/.exec(p);
    for (let d = m?.[1] ?? ''; d; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') {
      if (stacks.has(d)) return stacks.get(d);
    }
    return null;
  };
  return p => {
    // 새 배치의 스킬·MCP 고아는 디렉터리라, 그 아래의 다른 출처 출력으로 가린다
    if (paths.has(p) || [...paths].some(x => x.startsWith(`${p}/`))) return true;
    const owner = ownerOf(p);
    return owner !== null && owner !== name;
  };
}

/** 표준 입력 전부. */
async function readAllStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 원본 없이 알 수 있는 추천의 모순: 더하고 빼는 같은 키, 빼라는 블록 안(하위 스택)을 더하라는 키. 폼에서도 --yes 에서도 뺌이 더함을 지운다.
 * @param {{ add: Record<string, string>, remove: Record<string, string> }} value
 * @returns {string[]} 오류 문구(없으면 빈 배열)
 */
function recommendConflicts({ add, remove }) {
  const out = [];
  const both = Object.keys(add).filter(k => Object.hasOwn(remove, k));
  if (both.length) out.push(t('pick.recommendBoth', { keys: both.join(', ') }));
  for (const a of Object.keys(add)) {
    const r = Object.keys(remove).find(x => x !== a && isWithin(a, x));
    if (r) out.push(t('pick.recommendInsideRemoved', { add: a, remove: r }));
  }
  return out;
}

/**
 * 받은 원본으로 본 추천의 잘못: 원본에 없는 키, 필수 블록과 그것을 품은 스택의 뺌. 키는 실제 이름이다.
 * @param {{ add: Record<string, string>, remove: Record<string, string> }} value
 * @param {{ keys: Set<string>, required: string[] }} opts
 * @returns {string[]}
 */
function recommendInvalid({ add, remove }, { keys, required }) {
  const unknown = [...Object.keys(add), ...Object.keys(remove)].filter(k => !keys.has(k));
  if (unknown.length) return [t('pick.recommendUnknown', { keys: unknown.join(', ') })];
  const guarded = new Set(withAncestors(required));
  const cannot = Object.keys(remove).filter(k => guarded.has(k));
  return cannot.length ? [t('pick.recommendRequired', { keys: cannot.join(', ') })] : [];
}

/**
 * 폼 없이 제출한 프로젝트 폼 결과: 서버의 제출(buildSelection)에 폼의 처음 체크를 그대로 넣은 것. 덮어쓰기·고아 지우기는 꺼진 채
 * (고친 사본은 남기고 할 일, 고아는 둔다), 필수는 지금 필수, 에이전트는 그대로(project 없음)다.
 */
function yesSelection(payload, revision) {
  const { choices } = initialChoices({
    items: payload.items, catalog: payload.catalog,
    recommend: Object.keys(payload.recommend ?? {}), remove: Object.keys(payload.recommendRemove ?? {}),
  });
  return buildSelection({ revision, items: payload.items, choices, project: null, required: payload.required });
}

/**
 * --recommend 의 JSON. 파일 경로나 `-`(표준 입력). `{ 키: 이유 }`(더함) 나 `{ "add": { 키: 이유 }, "remove": { 키: 이유 } }` 를 받고,
 * 늘 { add, remove } 로 돌려준다. 블록 키는 `/` 를 품으므로 `add`·`remove` 라는 최상위 키는 새 모양으로만 읽힌다.
 * @returns {Promise<{ value: { add: Record<string, string>, remove: Record<string, string> } } | { error: string }>}
 */
async function readRecommend(arg, { cwd, readStdin }) {
  let text;
  try {
    text = arg === '-' ? await readStdin() : fs.readFileSync(path.resolve(cwd, expandPath(arg)), 'utf8');
  } catch (e) {
    return { error: t('pick.recommendRead', { reason: e.message }) };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: t('pick.badRecommend') };
  }
  const reasons = v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'string');
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length && keys.every(k => k === 'add' || k === 'remove')) {
      const add = value.add ?? {};
      const remove = value.remove ?? {};
      return reasons(add) && reasons(remove) ? { value: { add, remove } } : { error: t('pick.badRecommend') };
    }
  }
  if (!reasons(value)) return { error: t('pick.badRecommend') };
  return { value: { add: value, remove: {} } };
}

/**
 * guideline pick --local: 출처마다 개인 모드 폼으로 이 단위의 개인 선택(더함·뺌)을 고른다. 커밋되는 파일은 바꾸지 않는다 —
 * 결과는 git 공용 디렉터리의 개인 저장소(local.json)에 쓰고, 개인 사본을 받아 개인 겹을 넣어 조합한다.
 * role 을 주면(--role) 공통 겹 대신 그 역할 겹을 고른다: 폼의 프로젝트 상태는 프로젝트 + 공통 겹 결과, 미리 체크는 그 역할의 정의 →
 * 그 서버의 역할 기본값, 결과는 local.roles[role], 「기본값으로 저장」 은 그 서버의 roles[role]. 역할이 없으면 만든다.
 * 폼과 개인 사본은 프로젝트 잠금의 리비전 원본으로 만든다(프로젝트 사본과 리비전이 어긋나지 않게). 0 완료, 3 취소·만료, 1 오류, 2 사용법 오류.
 * @returns {Promise<number>}
 */
async function pickLocal({
  project, newTarget, server, source, browser, json, env, out, err, open, fetchImpl, git, home, cwd, pollWait, runRuler, recommend, readStdin,
  role = null, yes = false,
}) {
  if (newTarget !== undefined) {
    err(t('pick.localAndNew'));
    return 2;
  }
  if (role !== null && !NAME.test(role)) {
    err(t('role.badName', { name: role }));
    return 2;
  }
  const dir = project !== undefined ? expandPath(project) : cwd;
  if (!isDir(dir)) {
    err(t('common.notDir', { dir }));
    return 2;
  }
  const opened = openProject({ dir, server, source, err });
  if (opened.code !== undefined) return opened.code;
  const { manifest, lock } = opened;
  // 옛 배치는 update 가 옮긴 뒤에 고른다(사본 자리가 다르다)
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
  const place = personalPlace({ dir, root: unit.root }, git);
  if (!place) {
    err(t('local.needsGit'));
    return 2;
  }
  // 깨진 개인 선택·기본값 파일은 덮어쓰지 않는다(고치거나 지운 뒤 다시)
  let local;
  let defaults;
  try {
    local = readLocal(place.store);
    defaults = readDefaults({ env, home });
  } catch (e) {
    if (!(e instanceof LocalError || e instanceof DefaultsError)) throw e;
    err(e.message);
    return 1;
  }
  const names = Object.keys(manifest.sources).sort();
  const targets = source !== undefined ? [source] : names;
  let recommended = null;
  if (recommend !== undefined) {
    if (targets.length > 1) {
      err(t('pick.recommendOneSource'));
      return 2;
    }
    recommended = await readRecommend(recommend, { cwd, readStdin });
    if (recommended.error) {
      err(recommended.error);
      return 2;
    }
    const conflict = recommendConflicts(recommended.value);
    if (conflict.length) {
      for (const m of conflict) err(m);
      return 2;
    }
  }

  const single = names.length === 1;
  const fetched = await fetchSources({ manifest, lock, latest: new Set(), only: targets, single, env, home, fetchImpl });
  const failures = fetched.failures.map(f => `${f.source}: ${f.message}`);
  const status = projectStatus(dir, git, unit.root);
  const next = { version: 2, sources: { ...local.sources }, roles: local.roles };
  // 역할 겹은 프로젝트 + 공통 겹 결과(자동 조상 포함)에 얹힌다. 역할 없이 고르면 기준은 프로젝트 그대로
  const common = role !== null ? effectiveItems(manifest, local) : null;
  const basis = role !== null ? roleBasis(manifest, common) : manifest;
  const layer = role !== null ? { ...(local.roles[role]?.sources ?? {}) } : next.sources;
  if (role !== null) next.roles = { ...local.roles, [role]: { sources: layer } };
  const trees = new Map();
  const saved = new Map();
  const todos = [];
  for (const name of targets) {
    const tree = fetched.trees.get(name);
    if (!tree) continue;
    const src = manifest.sources[name];
    const aliases = src.aliases ?? {};
    const keys = blockKeys(tree.tree);
    // 미리 체크: 이 단위의 개인 선택(역할이면 그 역할의 정의), 없으면 그 서버의 머신 기본값(역할이면 그 역할 기본값).
    // 원본에 없는 블록은 싣지 않는다(고를 수 없다).
    const mineNow = role !== null ? local.roles[role]?.sources[name] : local.sources[name];
    const preferred = role !== null ? roleDefaultsFor(src.server, role, { env, home }) : defaults.servers[new URL(src.server).origin];
    const preset = mineNow ? 'local' : preferred ? 'defaults' : 'none';
    const start = mineNow ?? preferred ?? { add: [], remove: [] };
    let add = start.add.filter(k => keys.has(k));
    let remove = start.remove.filter(k => keys.has(k));
    let rec = null;
    if (recommended) {
      const { add: ra, remove: rr } = recommended.value;
      const bad = recommendInvalid(recommended.value, { keys, required: src.required ?? [] });
      if (bad.length) {
        for (const m of bad) err(m);
        return 2;
      }
      // 추천을 미리 체크에 얹는다(개인 모드 화면은 추천을 표시만 하고 체크하지 않는다)
      add = [...new Set([...add.filter(k => !Object.hasOwn(rr, k)), ...Object.keys(ra)])];
      remove = [...new Set([...remove.filter(k => !Object.hasOwn(ra, k)), ...Object.keys(rr)])];
      rec = { ...rr, ...ra };
    }
    const only = { ...manifest, sources: { [name]: src } };
    const v = virtualize({ manifest: only, lock: null, trees: new Map([[name, tree]]) });
    const vk = k => toVirtual(k, aliases);
    const personal = {
      // 프로젝트 상태 열: 역할이면 프로젝트 + 공통 겹 결과(역할이 얹히는 기준), 아니면 프로젝트 선택
      chosen: role !== null ? common.sources[name].items.map(vk) : [...v.view.items],
      required: withAncestors((src.required ?? []).map(vk)),
      add: add.map(vk).sort(),
      remove: remove.map(vk).sort(),
      preset,
      role,
      // 역할 폼: 프로젝트만의 선택. 화면이 기준 중 프로젝트가 받는 것(기본)과 공통 선택이 더한 것을 가른다. 없는 서버는 무시한다
      ...(role !== null ? { project: [...v.view.items] } : {}),
    };
    const payload = formPayload({
      tree: v.tree, revision: tree.revision, projectPath: dir, isNew: false, agents: manifest.agents, status,
      nested: unit.nested, rootStacks: unit.nested ? rootStacks(unit.root) : [], mode: 'personal', personal,
    });
    payload.catalog = withVirtualRequires(catalogView(v.tree), aliases);
    if (rec) payload.recommend = Object.fromEntries(Object.entries(rec).map(([k, why]) => [vk(k), why]));

    // --yes: 개인 폼이 처음 보일 선택(personalChoices) 그대로 제출한 결과. 「기본값으로 저장」 은 하지 않는다
    const round = yes
      ? { result: { status: 'submitted', selection: personalSelection({ personal, choices: personalChoices(personal), saveDefault: false }) } }
      : await formRound({
        client: tree.client, payload, name, many: targets.length > 1, url: tree.server, browser, open, err, pollWait, needMode: 'personal',
      });
    if (round.failure) failures.push(round.failure);
    if (!round.result) continue;
    const sel = round.result.selection ?? {};
    const real = id => realOf(id, v.sources)?.id ?? id;
    const list = x => (Array.isArray(x) ? x.filter(isBlockKey).map(real) : []);
    const mine = { add: list(sel.add), remove: list(sel.remove) };
    // 다른 출처의 같은 최종 이름을 프로젝트가 골랐으면 그 더함은 조합이 쓰지 않는다(personal-shadowed). 저장하지 않고 알린다.
    const eff = effectiveItems(basis, { version: 2, sources: { [name]: mine }, roles: {} });
    // 가려진 키 아래의 더함도 뺀다: 조합이 그 조상을 다시 채우면 같은 할 일이 매번 나고, 받으면 다른 출처의 스택 안에 이 출처의 하위가 섞인다
    const shadowed = shadowedAdds(manifest, eff).filter(x => x.source === name);
    const drop = new Set();
    for (const x of shadowed) {
      if (drop.has(x.key)) continue; // 가려진 조상의 할 일에 이미 적었다
      const item = names.length > 1 ? `${name}:${x.key}` : x.key;
      const below = mine.add.filter(k => k !== x.key && isWithin(k, x.key));
      for (const k of [x.key, ...below]) drop.add(k);
      const message = below.length
        ? t('pick.localShadowedBelow', { item, by: x.by, final: x.final, below: below.join(', ') })
        : t('pick.localShadowed', { item, by: x.by, final: x.final });
      todos.push({ kind: 'personal-shadowed', item, message });
    }
    const kept = mine.add.filter(k => !drop.has(k));
    layer[name] = { add: kept, remove: mine.remove };
    // 기본값은 서버마다다(프로젝트와 상관없이) — 가림으로 거른 것도 그대로 둔다. 같은 서버의 출처가 여럿이면 합친다
    if (sel.saveDefault === true) saved.set(new URL(src.server).origin, [...(saved.get(new URL(src.server).origin) ?? []), { name, mine }]);
    trees.set(name, tree);
  }
  for (const f of failures) err(f);
  if (trees.size === 0) return failures.length ? 1 : 3;

  writeLocal(place.store, next);
  if (saved.size) {
    const servers = { ...defaults.servers };
    for (const [origin, picks] of saved) {
      const merged = mergeDefaults(picks);
      for (const c of merged.conflicts) err(t('pick.defaultsConflict', { origin, ...c }));
      // 공통 기본값을 저장하면 그 서버의 역할 기본값(roles)은 보존, 역할 기본값을 저장하면 공통과 다른 역할은 보존
      servers[origin] = role !== null
        ? { add: [], remove: [], ...servers[origin], roles: { ...servers[origin]?.roles, [role]: merged.value } }
        : { ...servers[origin], ...merged.value };
    }
    writeDefaults({ version: 2, servers }, { env, home });
  }
  const revisions = Object.fromEntries([...trees].map(([n, x]) => [n, x.revision]));
  const done = finishPersonal({
    project: dir, root: unit.root, nested: unit.nested, manifest, sync: { trees, revisions }, prior: local, todos, env, runRuler, err, git,
  });
  report({ result: { ...done, revision: revisionLabel(revisions) }, json, out });
  if (done.code !== 0) return done.code;
  return failures.length ? 1 : 0;
}

/**
 * 한 서버 origin 에 「기본값으로 저장」 한 출처들의 선택(출처 이름 순)을 하나로 합친다. 한 출처가 더한 블록을 뒤 출처가 빼면(또는 그 반대)
 * 뒤 출처의 것을 남기고 conflicts 로 알린다.
 * @param {{ name: string, mine: { add: string[], remove: string[] } }[]} picks
 * @returns {{ value: { add: string[], remove: string[] }, conflicts: { key: string, first: string, last: string }[] }}
 */
function mergeDefaults(picks) {
  const pick = new Map();
  const conflicts = [];
  for (const { name, mine } of picks) {
    for (const [list, how] of [[mine.add, 'add'], [mine.remove, 'remove']]) {
      for (const key of list) {
        const was = pick.get(key);
        if (was && was.how !== how) conflicts.push({ key, first: was.name, last: name });
        pick.set(key, { how, name });
      }
    }
  }
  const of = how => [...pick].filter(([, v]) => v.how === how).map(([k]) => k).sort();
  return { value: { add: of('add'), remove: of('remove') }, conflicts };
}

/** 폼에 싣는 목록의 requires(실제 이름)를 별칭을 입힌 이름으로. */
function withVirtualRequires(catalog, aliases) {
  const map = list => list.map(x => ({ ...x, requires: (x.requires ?? []).map(u => finalUnit(u, aliases)) }));
  return { ...catalog, stacks: map(catalog.stacks), skills: map(catalog.skills), subagents: map(catalog.subagents), mcp: map(catalog.mcp) };
}
