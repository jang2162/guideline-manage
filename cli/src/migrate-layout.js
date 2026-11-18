import fs from 'node:fs';
import path from 'node:path';
import { sha256, normalized, itemHash, treeHashes } from './hashes.js';
import { stripFrontmatter } from './inspect.js';
import { desiredCopies } from './render/copies.js';
import { desiredOutputs, desiredPart, RULER_TOML_BASE, NESTED_TOML_BASE } from './render/outputs.js';
import { blockedReason } from './render/index.js';
import { setTable, tableSlice, parseKeyPath } from './toml-table.js';
import { expandBlocks } from './catalog.js';
import { virtualize, toRealLock } from './workspace.js';
import { listFiles } from './propose.js';
import { runGit } from './projects.js';
import { rulerAgentsEnabled } from './project-state.js';
import { copyPath, overridePath, PROJECT_TOML, RULER_TOML } from './layout.js';
import { t } from './i18n.js';

// 옛 배치(.ruler/<스택>/·docs/guideline/ 에 커밋된 사본, ruler.toml 에 MCP 표)를 새 배치(.guideline/ 원본 모양 사본)로 옮긴다.
// 옛 배치는 이 파일의 입력으로만 남는다.

// 스택 경로는 하위 스택이면 여러 조각(`browser/neo`)이다. 스킬·서브에이전트 자리(.ruler/skills·.ruler/agents)도 이 모양에 맞을 수 있어
// sourceOf 는 그것들을 먼저 본다.
const RULE_COPY = /^(?:\.ruler|docs\/guideline)\/(.+)\/(\d{2}-[a-z0-9][a-z0-9-]*\.md)$/;
const SETUP_COPY = /^docs\/guideline\/(.+)\/SETUP\.md$/;
const AGENT_COPY = /^\.ruler\/agents\/([^/]+\.md)$/;
const SKILL_COPY = /^\.ruler\/skills\/([^/]+)\/(.+)$/;
/** 옛 배치에서 조합이 다시 만드는 생성물이라 추적만 뺄 것(잠금에 없어도). */
const GENERATED = ['.ruler/guideline.md', 'docs/guideline/README.md'];
const lf = s => s.replace(/\r\n/g, '\n');
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));

/**
 * 옛 사본 경로를 원본 경로와 원본 모양 내용으로 되돌린다. 지침 파일은 원본의 frontmatter 를 다시 붙인다. 모르는 경로면 null.
 * @param {import('./tree.js').Tree} base 원본 트리(별칭을 입힌 가상 트리)
 * @param {string} rel 옛 사본 경로
 * @param {Buffer | null} cur 옛 사본 내용
 */
export function sourceOf(base, rel, cur) {
  let m = AGENT_COPY.exec(rel);
  if (m) return { path: `agents/${m[1]}`, content: cur };
  m = SKILL_COPY.exec(rel);
  if (m) return { path: `skills/${m[1]}/${m[2]}`, content: cur };
  m = RULE_COPY.exec(rel);
  if (m) {
    const src = `rules/${m[1]}/${m[2]}`;
    const text = lf(base.read(src)?.toString('utf8') ?? '');
    const prefix = text.slice(0, text.length - stripFrontmatter(text).length);
    return { path: src, content: cur === null ? null : Buffer.from(prefix + cur.toString('utf8')) };
  }
  m = SETUP_COPY.exec(rel);
  if (m) return { path: `rules/${m[1]}/SETUP.md`, content: cur };
  return null;
}

/** 단위 안에 커밋 안 된 변경(추적 중인 파일)이 있는가. git 저장소가 아니면 거짓. */
function dirty(project, git) {
  const r = git(['status', '--porcelain', '--untracked-files=no', '--', '.'], project);
  return r.status === 0 && r.stdout.trim() !== '';
}

const isGitRepo = (project, git) => git(['rev-parse', '--is-inside-work-tree'], project).status === 0;

/**
 * 잠금이 없던(0.10 이전) 옛 배치의 잠금을 디스크에서 짐작한다. 원본으로 만든 출력 중 디스크에 있는 것만 잡고,
 * 다르면 adopted 로 둔다(그때의 render 와 같다). MCP 표는 원본과 같을 때만 지침 서버 것으로 본다 — 다른 표는 프로젝트 것으로 남긴다.
 */
function guessLock({ tree, view, read, toml, nested, rulerAgentsEnabled }) {
  const hashes = treeHashes(tree);
  const live = expandBlocks(tree, view.items).filter(id => itemHash(hashes, id) !== null && !blockedReason(tree, id, nested));
  const { outputs: desired } = desiredOutputs({ tree, manifest: view, items: live, rulerAgentsEnabled });
  const outputs = [];
  for (const d of desired) {
    const want = desiredPart(d);
    if (d.kind === 'toml') {
      const cur = toml === null ? null : tableSlice(toml, d.segs);
      if (cur !== null && eq(cur, want)) outputs.push({ path: d.path, key: d.key, items: d.items, hash: sha256(want) });
      continue;
    }
    const raw = read(d.path);
    if (raw === null) continue;
    outputs.push({ path: d.path, items: d.items, hash: sha256(want), ...(eq(normalized(d.path, raw), want) ? {} : { adopted: true }) });
  }
  const got = new Set(outputs.flatMap(o => o.items));
  const sources = Object.fromEntries(live.filter(id => got.has(id)).map(id => [id, itemHash(hashes, id)]));
  return { sources, outputs };
}

/** .ruler/ 아래 모든 깊이의 바꿈 파일(<스택 경로>/override.md, override.d/*.md). 스킬·서브에이전트 자리는 스택이 아니다. */
function rulerOverrideFiles(project) {
  const dir = path.join(project, '.ruler');
  const out = [];
  const walk = stack => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(dir, stack), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && stack && e.name === 'override.md') out.push({ stack, rel: 'override.md' });
      if (!e.isDirectory()) continue;
      if (e.name === 'override.d') {
        if (!stack) continue;
        for (const f of fs.readdirSync(path.join(dir, stack, e.name), { withFileTypes: true })) {
          if (f.isFile() && f.name.endsWith('.md')) out.push({ stack, rel: `override.d/${f.name}` });
        }
        continue;
      }
      if (!stack && (e.name === 'skills' || e.name === 'agents')) continue;
      walk(stack ? `${stack}/${e.name}` : e.name);
    }
  };
  walk('');
  return out;
}

/**
 * 옛 배치 프로젝트를 새 배치로 옮길 내용을 낸다. 디스크는 읽기만 하고 git 은 조회만 한다 — 쓰기·git rm 은 호출자가 한다.
 * - 잠금 출력마다 사본을 .guideline/<id> 의 원본 모양으로 되돌린다. 새 잠금(v3)의 해시는 잠금 리비전 원본 바이트의 해시라서,
 *   프로젝트에서 고친 사본은 local 로 보인다. 손대지 않은 사본은 되돌린 것이 곧 원본 바이트다.
 * - .ruler/<스택>/override.md·override.d/ → .guideline/overrides/<스택>/.
 * - .ruler/ruler.toml → ruler.project.toml(잠금의 MCP 표를 뺀 것. 프로젝트에서 고친 표와 사용자 표는 남는다).
 * - 출처별 docs/management.md → .guideline/management/<출처>.md.
 * - 옛 사본·색인·관리 지침·ruler.toml 은 조합이 다시 만드는 생성물이라 notes.untrack(git 이 추적 중인 것만)으로 낸다.
 * @param {{ project: string, root?: string, manifest: import('./manifest.js').Manifest, lock: import('./manifest.js').Lock | null,
 *   trees: Map<string, { tree: import('./tree.js').Tree, revision: number, server?: string }>, git?: Function, nested?: boolean }} opts
 *   trees 는 잠금 리비전의 원본(잠금이 없으면 최신)
 * @returns {{ files: Record<string, Buffer | null>, lock: import('./manifest.js').Lock, todos: object[], notes: { untrack: string[] } }
 *   | { error: string }}
 */
export function migrateLayout({ project, manifest, lock, trees, git = runGit, nested = false }) {
  const inGit = isGitRepo(project, git);
  if (inGit && dirty(project, git)) return { error: t('migrate.dirty') };

  const abs = rel => path.join(project, ...rel.split('/'));
  const read = rel => {
    try {
      return fs.readFileSync(abs(rel));
    } catch {
      return null;
    }
  };
  const fileNow = rel => {
    const b = read(rel);
    return b === null ? null : normalized(rel, b);
  };
  const tomlRaw = read(RULER_TOML);
  let toml = tomlRaw === null ? null : lf(tomlRaw.toString('utf8'));

  const v = virtualize({ manifest, lock, trees });
  const tree = v.tree;
  const old = lock ? v.viewLock : guessLock({ tree, view: v.view, read, toml, nested, rulerAgentsEnabled: rulerAgentsEnabled(project) });
  const hashes = treeHashes(tree);
  const files = {};
  const outputs = [];
  const untrack = new Set(GENERATED.filter(p => read(p) !== null));
  const mapped = new Set();

  // 1. 파일 사본 → .guideline/<id>
  for (const o of old.outputs) {
    if (o.key) continue;
    untrack.add(o.path);
    // 색인(99-reference.md)·관리 지침·docs/guideline/README.md 는 조합이 다시 만든다
    if (o.items.length === 0) continue;
    const cur = fileNow(o.path);
    const s = sourceOf(tree, o.path, cur);
    if (!s) continue;
    for (const id of o.items) mapped.add(id);
    const to = copyPath(s.path);
    const src = tree.read(s.path);
    const want = src === null ? null : normalized(to, src);
    const adopted = o.adopted ? { adopted: true } : {};
    if (cur === null) {
      // 프로젝트에서 지운 사본은 쓰지 않는다(새 배치에서도 gone)
      outputs.push({ path: to, items: o.items, hash: want ? sha256(want) : o.hash, ...adopted });
      continue;
    }
    // 손대지 않은 사본은 잠금 리비전 원본 바이트 그대로(되돌림의 오차에 기대지 않는다). 다만 그 원본으로 만든 사본이 아니면
    // (막혀서 지난 리비전 것이 남은 사본) 되돌린 내용을 쓴다.
    const unchanged = sha256(cur) === o.hash;
    const reverted = normalized(to, s.content);
    const fromSource = unchanged && want !== null && o.items.every(i => old.sources[i] === itemHash(hashes, i));
    const content = fromSource ? want : reverted;
    files[to] = content;
    outputs.push({ path: to, items: o.items, hash: unchanged ? sha256(content) : want ? sha256(want) : o.hash, ...adopted });
  }

  // 2. MCP 표: 받은 그대로인 표는 ruler.toml 에서 빼고 사본(.guideline/mcp/<이름>/)으로 옮긴다. 고친 표는 프로젝트 것으로 남긴다.
  for (const o of old.outputs) {
    if (!o.key || toml === null) continue;
    const segs = parseKeyPath(o.key);
    const cur = tableSlice(toml, segs);
    if (cur === null || sha256(cur) !== o.hash) continue;
    const r = setTable(toml, segs, null);
    if (!r.conflict) toml = r.text;
  }

  // 3. 사본 출력이 없던 항목(MCP, 꺼져 있던 서브에이전트)과 관리 지침은 잠금 리비전 원본 그대로
  const rest = Object.keys(old.sources).filter(id => !mapped.has(id) && itemHash(hashes, id) !== null && !blockedReason(tree, id, nested));
  for (const d of desiredCopies({ tree, items: rest, management: v.management }).outputs) {
    files[d.path] = d.content;
    outputs.push({ path: d.path, items: d.items, hash: sha256(d.content) });
  }

  // 4. 스킬 폴더에 프로젝트가 더한 파일도 옮긴다(제안할 수 있게). 잠금이 모르니 잠금에는 넣지 않는다.
  const known = new Set(old.outputs.map(o => o.path));
  for (const id of Object.keys(old.sources).filter(x => x.startsWith('skills/'))) {
    const dir = `.ruler/${id}`;
    for (const rel of listFiles(abs(dir))) {
      const p = `${dir}/${rel}`;
      if (known.has(p)) continue;
      files[copyPath(`${id}/${rel}`)] = read(p);
      untrack.add(p);
    }
  }

  // 5. 바꿈 파일: 받은 스택(잠금의 사본 자리와 매니페스트의 스택, 별칭 이름)의 것만. 프로젝트 자체 폴더의 것은 그대로 둔다.
  const stacks = new Set([
    ...old.outputs.map(o => /^rules\/(.+)\/[^/]+$/.exec(sourceOf(tree, o.path, null)?.path ?? '')?.[1]).filter(Boolean),
    ...v.view.items.filter(k => k.startsWith('rules/')).map(k => k.slice('rules/'.length)),
  ]);
  for (const { stack, rel } of rulerOverrideFiles(project).filter(x => stacks.has(x.stack))) {
    const from = `.ruler/${stack}/${rel}`;
    files[overridePath(stack, rel)] = read(from);
    files[from] = null;
    untrack.add(from);
  }

  // 6. ruler 설정
  if (read(PROJECT_TOML) === null) files[PROJECT_TOML] = Buffer.from(toml ?? (nested ? NESTED_TOML_BASE : RULER_TOML_BASE)(manifest.agents));
  if (tomlRaw !== null) untrack.add(RULER_TOML);

  const revisions = lock ? { ...lock.revisions } : Object.fromEntries([...trees].map(([n, x]) => [n, x.revision]));
  const next = toRealLock({ viewLock: { version: 3, sources: old.sources, outputs }, sources: v.sources, revisions });
  const todos = [...v.problems];
  const candidates = [...untrack].sort();
  let tracked = inGit && candidates.length ? trackedOf(project, candidates, git) : [];
  if (tracked === null) {
    // 무엇을 추적하는지 모르면 빼지 못한다 — 조용히 넘어가면 옛 사본이 추적에 남으므로 명령을 알린다
    todos.push({ kind: 'untracked', item: null, message: t('todo.untrackUnknown', { paths: candidates.join(' '), dir: project }) });
    tracked = [];
  }
  return { files, lock: next, todos, notes: { untrack: tracked } };
}

/** paths 중 git 이 추적 중인 것(정렬). git 이 답하지 못하면 null. */
function trackedOf(project, paths, git) {
  const r = git(['ls-files', '-z', '--', ...paths], project);
  if (r.status !== 0) return null;
  const set = new Set(r.stdout.split('\0').filter(Boolean));
  return paths.filter(p => set.has(p));
}

const PACKAGE = 'package.json';
const RULER_APPLY = /\bruler apply\b/;

/** prepare 의 `ruler apply` 중 뒤에 인자가 붙은 것이 있는가. 끝이나 `&&`·`||`·`;` 앞이면 인자가 없다. */
const withArgs = prepare => [...prepare.matchAll(/\bruler apply\b/g)]
  .some(m => !/^\s*(?:$|&&|\|\||;)/.test(prepare.slice(m.index + m[0].length)));

/**
 * status·update 가 반영 뒤에 내는 prepare 할 일: 바꾸지 않고, 해결될 때까지 남는 것(dev-dependency, prepare-manual)만.
 * 이전 때 한 번만 알리면 클론의 prepare 가 ruler 만 돌아 지침 없는 AGENTS.md 를 만드는 것을 놓친다.
 * @returns {object[]}
 */
export function readOnlyPrepareTodos({ project, root = project }) {
  return preparePackage({ project, root }).todos.filter(x => x.kind === 'dev-dependency' || x.kind === 'prepare-manual');
}

/** text[i] 의 문자열 토큰이 끝난 다음 위치. */
function stringEnd(text, i) {
  let k = i + 1;
  while (k < text.length && text[k] !== '"') k += text[k] === '\\' ? 2 : 1;
  return k + 1;
}

/** text[i] 에서 시작하는 JSON 값이 끝난 다음 위치. */
function valueEnd(text, i) {
  if (text[i] === '"') return stringEnd(text, i);
  if (text[i] !== '{' && text[i] !== '[') {
    let k = i;
    while (k < text.length && !/[,}\]\s]/.test(text[k])) k++;
    return k;
  }
  let depth = 0;
  for (let k = i; k < text.length; k++) {
    if (text[k] === '"') k = stringEnd(text, k) - 1;
    else if (text[k] === '{' || text[k] === '[') depth++;
    else if ((text[k] === '}' || text[k] === ']') && --depth === 0) return k + 1;
  }
  return text.length;
}

/** text[start] 의 객체 바로 아래 멤버 name 의 값 범위 [start, end). 없으면 null. 원문 서식을 지키며 고치려고 위치만 찾는다. */
function memberRange(text, start, name) {
  let k = start + 1;
  const skip = () => {
    while (k < text.length && /[\s,]/.test(text[k])) k++;
  };
  for (skip(); k < text.length && text[k] === '"'; skip()) {
    const keyEnd = stringEnd(text, k);
    const key = JSON.parse(text.slice(k, keyEnd));
    k = keyEnd;
    while (/\s/.test(text[k])) k++;
    k++; // :
    while (/\s/.test(text[k])) k++;
    const end = valueEnd(text, k);
    if (key === name) return { start: k, end };
    k = end;
  }
  return null;
}

/** 잠금 파일로 고른 패키지 매니저의 「guideline-manage 를 dev 의존성으로 더하는」 명령. 단위에서, 없으면 git 루트에서 찾는다. */
function addDevCommand(dirs) {
  const has = f => dirs.some(d => fs.existsSync(path.join(d, f)));
  if (has('pnpm-lock.yaml')) return 'pnpm add -D guideline-manage';
  if (has('yarn.lock')) return 'yarn add -D guideline-manage';
  if (has('bun.lockb') || has('bun.lock')) return 'bun add -d guideline-manage';
  return 'npm install -D guideline-manage';
}

/**
 * package.json 의 prepare 가 ruler apply 를 부르면 guideline apply 로 바꾼다 — ruler 가 조합 전에 돌면 모든 에이전트 몫(CLAUDE.md)을 만든다.
 * guideline-manage 가 의존성에 있을 때만 바꾼다(없이 바꾸면 prepare 가 깨진다). 없으면 dev 의존성으로 더하라는 할 일을 낸다 —
 * 설치는 패키지 매니저의 일이고, 설치 뒤의 apply 가 다시 이 검사로 바꾼다. package.json 이 없으면 hook 일 때만 apply-hook 할 일.
 * `ruler apply` 뒤에 인자가 붙었으면(`ruler apply --agents claude`) guideline apply 가 그 인자를 몰라 설치가 깨지므로 바꾸지 않고 알린다.
 * 바꾸는 것(files)은 apply·이전만 쓴다. status·update 는 todos 만 본다(readOnlyPrepareTodos).
 * @param {{ project: string, root?: string, hook?: boolean }} opts
 * @returns {{ files: Record<string, Buffer>, todos: object[] }}
 */
export function preparePackage({ project, root = project, hook = false }) {
  const file = path.join(project, PACKAGE);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { files: {}, todos: hook ? [{ kind: 'apply-hook', item: null, message: t('todo.applyHook') }] : [] };
  }
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return { files: {}, todos: [] };
  }
  const prepare = pkg?.scripts?.prepare;
  if (typeof prepare !== 'string' || !RULER_APPLY.test(prepare)) return { files: {}, todos: [] };
  const dep = Object.hasOwn(pkg.devDependencies ?? {}, 'guideline-manage') || Object.hasOwn(pkg.dependencies ?? {}, 'guideline-manage');
  const todos = dep ? [] : [{ kind: 'dev-dependency', item: null, message: t('todo.devDependency', { command: addDevCommand([project, root]) }) }];
  if (withArgs(prepare)) todos.push({ kind: 'prepare-manual', item: null, message: t('todo.prepareManual', { file: PACKAGE, prepare }) });
  if (todos.length) return { files: {}, todos };
  // 글자 그대로 고친다(들여쓰기·키 순서를 지킨다). scripts 안의 prepare 만 — 다른 객체의 같은 이름 키는 건드리지 않는다
  const scripts = memberRange(text, text.indexOf('{'), 'scripts');
  const at = scripts && text[scripts.start] === '{' ? memberRange(text, scripts.start, 'prepare') : null;
  if (!at || text[at.start] !== '"') return { files: {}, todos: [] };
  // 'ruler apply' 에는 JSON 이스케이프할 글자가 없어 원문 문자열에서 바로 바꿔도 같다
  const next = text.slice(0, at.start) + text.slice(at.start, at.end).replace(/\bruler apply\b/g, 'guideline apply') + text.slice(at.end);
  if (next === text) return { files: {}, todos: [] };
  return {
    files: { [PACKAGE]: Buffer.from(next) },
    todos: [{ kind: 'prepare', item: null, message: t('todo.prepareChanged', { file: PACKAGE }) }],
  };
}
