import fs from 'node:fs';
import path from 'node:path';
import { openBrowser } from '../browser.js';
import { expandPath, baseDir, newProjectTarget, projectStatus, createProject, runGit } from '../projects.js';
import { readManifest, readLock, ManifestError } from '../manifest.js';
import { remoteClient, loadSource, explain } from '../remote.js';
import { tokenFor, virtualize, toRealLock, fetchSources, aliasMoveTodos, protectedPaths } from '../workspace.js';
import { realOf, unitOf, unitName, finalUnit, collisions, collisionMessage, NAME } from '../sources.js';
import { catalogView } from '../catalog-view.js';
import { blockKeys } from '../catalog.js';
import { blockKey, isWithin, withAncestors } from '../blocks.js';
import { splitQualified } from '../manifest.js';
import { revisionLabel } from './project-update.js';
import { inferAgents, formPayload, diskReader } from '../project-state.js';
import { unitInfo, unitProblem, rootStacks } from '../unit.js';
import { render } from '../render/index.js';
import { RULER_TOML_BASE, NESTED_TOML_BASE } from '../render/outputs.js';
import { layoutOf, rulerTomlText, PROJECT_TOML, RULER_TOML } from '../layout.js';
import { finishApply, report } from './sync-common.js';
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
  recommend, readStdin = readAllStdin,
}) {
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
    sources[name] = { server: url, items: cur?.items ?? [], aliases: cur?.aliases ?? {} };
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
  }
  const working = { ...base, sources };
  const single = Object.keys(sources).length === 1;

  const unit = isNew ? { dir, root: dir, nested: false } : unitInfo(dir, git);
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
    let src;
    try {
      src = await loadSource(client);
    } catch (e) {
      failures.push(`${name}: ${explain(e, url)}`);
      continue;
    }
    const tree = { server: url, revision: src.revision, tree: src.tree, client };
    fetched.set(name, tree);
    // 이 출처만 본 가상 원본·잠금으로 폼을 만든다. 다른 출처가 쓰는 최종 이름은 막는다.
    const only = { ...working, sources: { [name]: sources[name] } };
    const v = virtualize({ manifest: only, lock: lock && lockOf(lock, name), trees: new Map([[name, tree]]) });
    const payload = formPayload({
      tree: v.tree, revision: src.revision, projectPath: dir, isNew, agents, status,
      manifest: manifest && Object.hasOwn(base.sources, name) ? v.view : null, lock: v.viewLock,
      nested: unit.nested, rootStacks: unit.nested ? rootStacks(unit.root) : [], management: v.management,
    });
    const aliases = sources[name].aliases ?? {};
    if (recommended) {
      const keys = blockKeys(src.tree);
      const unknown = Object.keys(recommended.value).filter(k => !keys.has(k));
      if (unknown.length) {
        err(t('pick.recommendUnknown', { keys: unknown.join(', ') }));
        return 2;
      }
      payload.recommend = Object.fromEntries(Object.entries(recommended.value).map(([k, why]) => [finalUnit(k, aliases), why]));
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

    let result;
    try {
      const form = await client.createForm(payload);
      if (form.formVersion === undefined) {
        // 옛 서버는 스택 단위 폼을 모르고 파일마다 고르는 폼을 띄운다. 열어 둔 폼을 닫고 이 출처는 건너뛴다(고른 출처가 없으면 코드 1).
        await client.cancelForm(form.url).catch(() => {});
        failures.push(`${name}: ${t('pick.serverOld')}`);
        continue;
      }
      err(targets.length > 1 ? t('pick.sourceForm', { name, url: form.url }) : t('pick.form', { url: form.url }));
      if (browser) open(form.url);
      do {
        result = await client.formResult(form.id, pollWait, new URL(form.url).searchParams.get('k'));
      } while (result.status === 'pending');
    } catch (e) {
      failures.push(`${name}: ${e.status === 404 ? t('pick.formGone') : explain(e, url)}`);
      continue;
    }
    if (result.status !== 'submitted') {
      err(t('pick.notSubmitted', { prefix: targets.length > 1 ? `${name}: ` : '', reason: result.status === 'cancelled' ? t('pick.cancelled') : t('pick.expired') }));
      continue;
    }
    const sel = result.selection;
    if (sel.project) finalAgents = sel.project.agents;
    // 폼은 아직 파일마다 고른다. 매니페스트는 블록 키라, 남긴 파일·키를 그 블록(조상 스택 포함)으로 올린다 —
    // 같은 스택의 파일이 하나라도 남으면 그 스택을 받는다. 매니페스트에 있던 블록 중 막힌 파일이 있는 것도 그대로 둔다.
    const keep = sel.items.filter(i => i.kind !== 'orphan' && i.action !== 'remove').map(i => blockKey(i.id));
    const stillBlocked = v.view.items.filter(k => sel.blocked.some(b => blockKey(b.id) === k));
    const real = id => realOf(id, v.sources)?.id ?? id;
    sources[name] = { ...sources[name], items: withAncestors([...keep, ...stillBlocked].filter(Boolean).map(real)) };
    submitted.set(name, { sel, v, revision: sel.revision, overrides: payload.overrides });
  }
  for (const f of failures) err(f);
  if (submitted.size === 0) return failures.length ? 1 : 3;

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
  for (const [name, { sel }] of submitted) {
    // 같은 가상 id 를 다른 출처가 가질 수 있다(다른 출처가 쓰는 이름이라 이 폼에서 막힌 항목). 그 결정은 이 출처의 항목에만 준다.
    const own = id => realOf(id, v.sources)?.source === name;
    for (const i of sel.items) if (i.kind === 'orphan' || own(i.id)) decisions[i.id] = { action: i.action, overwrite: i.overwrite === true, state: i.state };
    for (const b of sel.blocked) if (own(b.id)) decisions[b.id] = { state: 'blocked', reason: b.reason };
    orphans.push(...sel.items.filter(i => i.kind === 'orphan' && i.action === 'remove').map(i => i.id));
  }
  // 새 프로젝트와 처음 받는 프로젝트는 새 배치(.guideline/ 사본 + 조합)로 시작한다. 이미 받은 프로젝트는 그 배치를 따른다.
  const layout = isNew || !manifest || layoutOf(lock, dir) === 'guideline' ? 'guideline' : 'ruler';
  const rendered = render({
    tree: v.tree, revision: 0, manifest: v.view, lock: v.viewLock, project: diskReader(dir), decisions, orphans, nested: unit.nested, management: v.management, layout,
  });
  for (const p of protect) delete rendered.files[p];
  const revisions = Object.fromEntries([...trees].map(([n, t]) => [n, submitted.get(n)?.revision ?? t.revision]));
  const realLock = toRealLock({ viewLock: rendered.lock, sources: v.sources, revisions, previous: lock, keep: failed, protect });
  rendered.todos.push(...v.problems, ...aliasMoveTodos({ previous: lock, next: realLock, project: dir }));
  for (const { overrides } of submitted.values()) {
    for (const o of overrides.filter(x => !x.valid)) {
      rendered.todos.push({ kind: 'override', item: o.target, message: `${o.file} 「${o.heading}」: ${o.reason}` });
    }
  }
  let moved = false;
  if (layout === 'guideline' && !fs.existsSync(path.join(dir, ...PROJECT_TOML.split('/')))) {
    const first = projectTomlFirst(dir, unit.nested, nextManifest.agents);
    rendered.files[PROJECT_TOML] = first.content;
    moved = first.moved;
  }
  const done = finishApply({ project: dir, root: unit.root, nested: unit.nested, result: rendered, manifest: nextManifest, lock: realLock, layout, env, runRuler, err });
  if (done.code === 0 && moved) done.todos.push(...untrackMoved(dir, git));
  report({ result: { ...done, revision: revisionLabel(revisions) }, json, out });
  if (done.code !== 0) return done.code;
  return failures.length || others.failures.length ? 1 : 0;
}

const trim = s => s.replace(/\/+$/, '');

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
function lockOf(lock, name) {
  const mine = q => splitQualified(q).source === name;
  return {
    version: 2,
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
 * 다른 출처의 사본인가. 다른 출처의 잠금 출력이거나, 그 경로를 품는 가장 깊은 최종 스택 자리(.ruler/<스택 경로>/,
 * docs/guideline/<스택 경로>/)를 다른 출처가 쓴다 — 부모 스택을 다른 출처가 가졌어도 자식 폴더는 자식 소유자의 것이다.
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
    const m = /^(?:\.ruler|docs\/guideline)\/(.+)\/[^/]+$/.exec(p);
    for (let d = m?.[1] ?? ''; d; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') {
      if (stacks.has(d)) return stacks.get(d);
    }
    return null;
  };
  return p => {
    if (paths.has(p)) return true;
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
 * --recommend 의 JSON(블록 키 → 이유). 파일 경로나 `-`(표준 입력).
 * @returns {Promise<{ value: Record<string, string> } | { error: string }>}
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
  const ok = value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');
  return ok ? { value } : { error: t('pick.badRecommend') };
}

/** 폼에 싣는 목록의 requires(실제 이름)를 별칭을 입힌 이름으로. */
function withVirtualRequires(catalog, aliases) {
  const map = list => list.map(x => ({ ...x, requires: (x.requires ?? []).map(u => finalUnit(u, aliases)) }));
  return { ...catalog, stacks: map(catalog.stacks), skills: map(catalog.skills), subagents: map(catalog.subagents), mcp: map(catalog.mcp) };
}
