import fs from 'node:fs';
import path from 'node:path';
import { openBrowser } from '../browser.js';
import { expandPath, baseDir, newProjectTarget, projectStatus, createProject, runGit } from '../projects.js';
import { readManifest, readLock, ManifestError } from '../manifest.js';
import { remoteClient, loadSource, explain } from '../remote.js';
import { tokenFor, virtualize, toRealLock, fetchSources, aliasMoveTodos, protectedPaths } from '../workspace.js';
import { realOf, unitOf, unitName, finalUnit, collisions, collisionMessage, NAME } from '../sources.js';
import { catalogView } from '../catalog-view.js';
import { splitQualified } from '../manifest.js';
import { revisionLabel } from './project-update.js';
import { inferAgents, formPayload, diskReader } from '../project-state.js';
import { unitInfo, unitProblem, rootStacks } from '../unit.js';
import { render } from '../render/index.js';
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
  const working = { ...base, sources };
  const single = Object.keys(sources).length === 1;

  const unit = isNew ? { dir, root: dir, nested: false } : unitInfo(dir, git);
  const status = isNew ? { gitRepo: false, dirty: false } : projectStatus(dir, git, unit.root);
  // 중첩 단위에 ruler.toml 이 아직 없으면 git 루트의 에이전트를 따른다
  const agentsFrom = unit.nested && !fs.existsSync(path.join(dir, '.ruler', 'ruler.toml')) ? unit.root : dir;
  const agents = manifest?.agents ?? (isNew ? null : inferAgents(agentsFrom));
  if (agents) working.agents = agents;

  const fetched = new Map();
  const submitted = new Map();
  const failures = [];
  let finalAgents = agents;
  for (const name of targets) {
    const { server: url } = sources[name];
    const token = tokenFor(url, { env, home, single });
    if (!token) {
      failures.push(t('common.sourceLoginNeeded', { name, url }));
      continue;
    }
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
    const taken = takenUnits(sources, name);
    const othersOwn = otherOwned(sources, lock, name);
    payload.catalog = catalogView(v.tree);
    payload.items = payload.items
      .filter(it => it.kind !== 'orphan' || !othersOwn(it.id))
      .map(it => {
        const owner = it.kind !== 'orphan' && taken.get(unitOf(it.id));
        return owner ? { ...it, state: 'blocked', reason: t('pick.nameTaken', { owner }) } : it;
      });

    let result;
    try {
      const form = await client.createForm(payload);
      err(targets.length > 1 ? t('pick.sourceForm', { name, url: form.url }) : t('pick.form', { url: form.url }));
      if (browser) open(form.url);
      do {
        result = await client.formResult(form.id, pollWait);
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
    const keep = sel.items.filter(i => i.kind !== 'orphan' && i.action !== 'remove').map(i => i.id);
    const stillBlocked = v.view.items.filter(id => sel.blocked.some(b => b.id === id));
    const real = id => realOf(id, v.sources)?.id ?? id;
    sources[name] = { ...sources[name], items: [...keep, ...stillBlocked].map(real) };
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
  const decisions = Object.fromEntries(v.view.items.map(id => [id, { action: 'keep' }]));
  const orphans = [];
  for (const [name, { sel }] of submitted) {
    // 같은 가상 id 를 다른 출처가 가질 수 있다(다른 출처가 쓰는 이름이라 이 폼에서 막힌 항목). 그 결정은 이 출처의 항목에만 준다.
    const own = id => realOf(id, v.sources)?.source === name;
    for (const i of sel.items) if (i.kind === 'orphan' || own(i.id)) decisions[i.id] = { action: i.action, overwrite: i.overwrite === true, state: i.state };
    for (const b of sel.blocked) if (own(b.id)) decisions[b.id] = { state: 'blocked', reason: b.reason };
    orphans.push(...sel.items.filter(i => i.kind === 'orphan' && i.action === 'remove').map(i => i.id));
  }
  const rendered = render({
    tree: v.tree, revision: 0, manifest: v.view, lock: v.viewLock, project: diskReader(dir), decisions, orphans, nested: unit.nested, management: v.management,
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
  const done = finishApply({ project: dir, root: unit.root, nested: unit.nested, result: rendered, manifest: nextManifest, lock: realLock, env, runRuler, err });
  report({ result: { ...done, revision: revisionLabel(revisions) }, json, out });
  if (done.code !== 0) return done.code;
  return failures.length || others.failures.length ? 1 : 0;
}

const trim = s => s.replace(/\/+$/, '');

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

/** 다른 출처들이 쓰는 최종 단위 → 그 출처. */
function takenUnits(sources, name) {
  const taken = new Map();
  for (const [other, s] of Object.entries(sources)) {
    if (other === name) continue;
    for (const id of s.items) {
      const u = unitOf(id);
      if (u) taken.set(finalUnit(u, s.aliases ?? {}), other);
    }
  }
  return taken;
}

/**
 * 다른 출처의 사본인가. 다른 출처의 잠금 출력이거나, 다른 출처가 쓰는 최종 스택 자리(.ruler/<스택>/, docs/guideline/<스택>/) 아래다.
 * 출처 하나의 폼이 다른 출처의 사본을 「원본에서 사라짐」 으로 보이지 않게 한다.
 */
function otherOwned(sources, lock, name) {
  const paths = new Set((lock?.outputs ?? [])
    .filter(o => o.items.length > 0 && o.items.every(q => splitQualified(q).source !== name))
    .map(o => o.path));
  const stacks = new Set();
  for (const [other, s] of Object.entries(sources)) {
    if (other === name) continue;
    for (const id of s.items) {
      const u = unitOf(id);
      if (u?.startsWith('rules/')) stacks.add(unitName(finalUnit(u, s.aliases ?? {})));
    }
  }
  return p => paths.has(p) || [...stacks].some(st => p.startsWith(`.ruler/${st}/`) || p.startsWith(`docs/guideline/${st}/`));
}
