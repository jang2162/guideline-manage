import fs from 'node:fs';
import path from 'node:path';
import { diskTree, joinPath } from './tree.js';
import { GUIDE_DIR, PROJECT_TOML, RULER_TOML, copyPath } from './layout.js';
import { desiredOutputs, RULER_TOML_BASE, NESTED_TOML_BASE, isRootOnly } from './render/outputs.js';
import { setTable, tableSlice } from './toml-table.js';
import { expandBlocks } from './catalog.js';
import { blockedReason } from './render/index.js';
import { withAncestors, isWithin } from './blocks.js';
import { unitOf, unitName, finalUnit } from './sources.js';
import { readBlock, writeBlock } from './gitignore-block.js';
import { effectiveItems } from './personal.js';
import { excludeMarkers, excludePattern, unitPathOf, readExclude } from './exclude.js';
import { t } from './i18n.js';

// 조합: 커밋된 .guideline/(원본 모양 사본)에서 에이전트가 읽는 생성물(.ruler/·docs/guideline/·ruler.toml)을 만든다.
// 서버·잠금 없이 디스크만 읽는다. 예전 반영과 같은 desiredOutputs 를 써서 같은 원본이면 바이트 단위로 같은 파일이 나온다.

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lf = s => s.replace(/\r\n/g, '\n');
const GITIGNORE = '.gitignore';
const MANAGEMENT = 'management';
const OVERRIDES = 'overrides';

/**
 * 블록에서 읽은 경로 중 조합이 지워도 되는 것. 조합이 만드는 자리(.ruler/·docs/guideline/) 안의 평범한 상대 경로만 —
 * 손으로 고친 블록에 든 `../x`·프로젝트 설정이 지워지지 않게.
 */
function removable(p) {
  const segs = p.split('/');
  if (segs.some(s => s === '' || s === '.' || s === '..') || p.includes('\\')) return false;
  if (p === PROJECT_TOML) return false;
  return p.startsWith('.ruler/') || p.startsWith('docs/guideline/');
}

/** 매니페스트 출처마다 별칭을 입힌 가상 블록 키(조상 포함). */
function virtualKeys(manifest) {
  const keys = Object.keys(manifest.sources).sort(byStr)
    .flatMap(name => manifest.sources[name].items.map(id => finalUnit(id, manifest.sources[name].aliases ?? {})));
  return withAncestors(keys);
}

/**
 * render 가 받는 모양의 관리 지침 인자. 추가분은 .guideline/management/<출처>.md, 세팅 표의 출처 열은 출처가 둘 이상일 때만
 * (virtualize 와 같은 규칙). 매니페스트에 없거나 항목이 없는 출처의 사본은 넣지 않는다.
 */
function managementOf(tree, manifest) {
  const names = Object.keys(manifest.sources).sort(byStr);
  const additions = [];
  for (const e of tree.list(MANAGEMENT)) {
    if (e.dir || !e.name.endsWith('.md')) continue;
    const source = e.name.slice(0, -'.md'.length);
    if (!names.includes(source) || manifest.sources[source].items.length === 0) continue;
    additions.push({ source, text: tree.read(joinPath(MANAGEMENT, e.name)).toString('utf8') });
  }
  let stackSource = null;
  if (names.length > 1) {
    stackSource = {};
    for (const name of names) {
      const s = manifest.sources[name];
      for (const id of s.items) {
        const u = unitOf(id);
        if (u?.startsWith('rules/')) stackSource[unitName(finalUnit(u, s.aliases ?? {}))] = name;
      }
    }
  }
  return { stackSource, additions };
}

/**
 * .guideline/overrides/<스택 경로>/override.md·override.d/*.md → .ruler/<스택 경로>/…. 경로 → 내용.
 * 고른 스택(조상 포함)의 바꿈만 옮긴다. 고르지 않은 스택의 바꿈 자리는 unchosen 에 담는다(파일이 있는 자리만).
 * @param {Set<string>} chosen 고른 스택 경로(`base`, `base/web`)
 * @returns {{ copies: Map<string, Buffer>, unchosen: string[] }}
 */
function overrideCopies(tree, chosen) {
  const copies = new Map();
  const unchosen = [];
  const walk = stack => {
    const base = joinPath(OVERRIDES, stack);
    let own = false;
    const put = (rel, file) => {
      own = true;
      if (chosen.has(stack)) copies.set(`.ruler/${stack}/${rel}`, tree.read(file));
    };
    for (const e of tree.list(base)) {
      if (e.name.startsWith('.')) continue;
      if (!e.dir) {
        if (stack && e.name === 'override.md') put('override.md', joinPath(base, e.name));
        continue;
      }
      if (e.name === 'override.d') {
        if (!stack) continue;
        for (const f of tree.list(joinPath(base, e.name))) {
          if (!f.dir && f.name.endsWith('.md') && !f.name.startsWith('.')) put(`override.d/${f.name}`, joinPath(base, `override.d/${f.name}`));
        }
        continue;
      }
      walk(joinPath(stack, e.name));
    }
    if (own && !chosen.has(stack)) unchosen.push(stack);
  };
  walk('');
  return { copies, unchosen: unchosen.sort(byStr) };
}

/**
 * 매니페스트에 개인 선택을 입힌 것. 출처마다 items = 프로젝트 items − 개인으로 빠진 것 + 개인으로 더한 것(조상은 virtualKeys 가 채운다) —
 * 개인 선택이 아무것도 바꾸지 않으면 items 가 매니페스트와 같아 조합 결과도 바이트 단위로 같다.
 * note 는 관리 지침의 개인 절(별칭을 입힌 키). 보일 것이 없으면 null.
 */
function personalLayer(manifest, local) {
  const eff = effectiveItems(manifest, local);
  const names = Object.keys(manifest.sources).sort(byStr);
  const many = names.length > 1;
  const sources = {};
  const note = { added: [], removed: [], ignored: [] };
  for (const name of names) {
    const src = manifest.sources[name];
    const e = eff.sources[name];
    const gone = new Set(e.removed);
    sources[name] = { ...src, items: [...src.items.filter(k => !gone.has(k)), ...e.added] };
    const show = k => ({ key: finalUnit(k, src.aliases ?? {}), source: many ? name : null });
    note.added.push(...e.added.map(show));
    note.removed.push(...e.removed.map(show));
    // 무시된 뺌만 보인다(무시된 더함은 결과가 같다 — 이미 고른 것이거나 뺌에 상쇄된 것)
    for (const k of e.ignored) {
      const why = e.ignoredWhy[k];
      if (why === 'required' || why === 'no-effect') note.ignored.push({ ...show(k), why });
    }
  }
  const changed = note.added.length > 0 || note.removed.length > 0;
  return { manifest: { ...manifest, sources }, changed, added: note.added.map(x => x.key), note: changed || note.ignored.length ? note : null };
}

/**
 * 프로젝트 사본(guide) 위에 개인 사본(mine)을 키 단위로 얹은 트리. 경로마다 그것을 담는 가장 긴 키가 주인이다 — 개인으로 더한 키
 * (added)면 개인 사본에서만, 프로젝트 키(같은 길이면 프로젝트가 이긴다)나 키 밖(관리 지침·바꿈 등)이면 프로젝트 사본에서만 읽는다.
 * 그래서 개인 저장소에 남은 프로젝트 스택의 지난 사본이 프로젝트 스택에 섞이지 않고(원본에서 지워진 규칙이 되살아나지 않는다),
 * 프로젝트 .guideline/ 에 남은 사본이 개인으로 더한 스택을 가리지 않는다. 키의 조상 디렉터리는 양쪽 목록에서 그 키로 가는 길만 보인다.
 * @param {string[]} added 개인으로 더한 가상 키, projectKeys 프로젝트 선택의 가상 키(조상 포함)
 */
function personalTree(guide, mine, added, projectKeys) {
  const ownerIsMine = p => {
    let len = -1;
    let isMine = false;
    for (const k of added) if (isWithin(p, k) && k.length > len) [len, isMine] = [k.length, true];
    for (const k of projectKeys) if (isWithin(p, k) && k.length >= len) [len, isMine] = [k.length, false];
    return len === -1 ? null : isMine;
  };
  // 그 트리에서 p 가 보이는가: p 의 주인이 그 트리이거나, p 가 그 트리가 주인인 키의 조상(그 키로 가는 디렉터리)이다
  const leadsTo = (p, keys, mineSide) => keys.some(k => k !== p && isWithin(k, p) && ownerIsMine(k) === mineSide);
  const inMine = p => ownerIsMine(p) === true || leadsTo(p, added, true);
  const inGuide = p => ownerIsMine(p) !== true || leadsTo(p, projectKeys, false);
  return {
    list(dir) {
      const seen = new Map();
      for (const e of guide.list(dir)) if (inGuide(joinPath(dir, e.name))) seen.set(e.name, e.dir);
      for (const e of mine.list(dir)) if (inMine(joinPath(dir, e.name))) seen.set(e.name, seen.get(e.name) || e.dir);
      return [...seen].map(([name, isDir]) => ({ name, dir: isDir })).sort((a, b) => byStr(a.name, b.name));
    },
    read(file) {
      return ownerIsMine(file) === true ? mine.read(file) : guide.read(file);
    },
    exists(p) {
      if (p === '') return true;
      return (inGuide(p) && guide.exists(p)) || (inMine(p) && mine.exists(p));
    },
  };
}

const stacksOf = keys => new Set(keys.filter(k => k.startsWith('rules/')).map(k => k.slice('rules/'.length)));

/**
 * 고른 키로 바라는 생성물(경로 → 내용)과 할 일을 만든다. 디스크는 읽기만 한다.
 * tree 는 블록을 읽을 트리(개인 사본을 얹었을 수 있다), guide 는 프로젝트 사본(.guideline/) — 바꿈은 거기서만 읽는다.
 * quiet 는 고르지 않았어도 override-unchosen 을 내지 않을 스택(개인으로 뺀 프로젝트 스택).
 */
function build({ tree, guide, manifest, keys, nested, rulerAgentsEnabled, management, readRel, quiet = new Set() }) {
  // 사본 폴더에는 프로젝트가 둔 파일이나 frontmatter 가 깨진 사본이 있을 수 있다. 원본처럼 막고(조합에서 빼고) 할 일로 알린다.
  const blocked = [];
  const items = expandBlocks(tree, keys).filter(id => tree.exists(id)).filter(id => {
    const reason = blockedReason(tree, id, nested);
    if (reason) blocked.push({ kind: 'blocked', item: id, message: t('todo.blockedCopy', { path: copyPath(id), reason }) });
    return !reason;
  });
  const view = { version: 1, form: 'ruler', instructionFiles: [], agents: manifest.agents, items: keys };
  const { outputs, todos: made } = desiredOutputs({ tree, manifest: view, items, rulerAgentsEnabled, management });
  const todos = [...blocked, ...made];
  // 고른 항목인데 사본이 없으면(막혔거나 MCP 를 만들어야 해서 동기화가 쓰지 않은 것) 조용히 빠지지 않게 알린다.
  for (const k of keys) {
    if (!tree.exists(k)) todos.push({ kind: 'no-copy', item: k, message: t('todo.noCopy', { item: k }) });
  }

  const want = new Map();
  for (const o of outputs) if (o.kind === 'file') want.set(o.path, o.content);

  // ruler.toml = ruler.project.toml(없으면 기본 설정) + 고른 MCP 표. 프로젝트가 둔 같은 이름 표는 프로젝트 것이 이긴다.
  const projectRaw = readRel(PROJECT_TOML);
  const projectText = projectRaw === null ? null : lf(projectRaw.toString('utf8'));
  let toml = projectText ?? (nested ? NESTED_TOML_BASE : RULER_TOML_BASE)(manifest.agents);
  for (const o of outputs) {
    if (o.kind !== 'toml') continue;
    const r = setTable(toml, o.segs, o.entry);
    const reason = r.conflict ?? (projectText !== null && tableSlice(projectText, o.segs) !== null ? t('compose.projectTable', { file: PROJECT_TOML }) : null);
    if (reason) {
      todos.push({ kind: 'mcp-conflict', item: o.items[0] ?? null, message: t('todo.mcpConflict', { table: o.key, reason }) });
      continue;
    }
    toml = r.text;
  }
  want.set(RULER_TOML, Buffer.from(toml));

  const { copies, unchosen } = overrideCopies(guide, stacksOf(keys));
  for (const [p, c] of copies) want.set(p, c);
  for (const stack of unchosen) {
    if (quiet.has(stack)) continue;
    todos.push({ kind: 'override-unchosen', item: null, message: t('todo.overrideUnchosen', { stack }) });
  }
  return { want, todos };
}

/**
 * .guideline/ 에서 생성물을 조합한다. 디스크는 읽기만 하고, 쓸 것(바뀐 것만, null 은 지움)을 돌려준다. 잠금은 보지 않는다.
 * personal 을 주면 개인 겹을 얹는다: 고른 블록 = 프로젝트 선택 ∪ 개인 더함 − 개인 뺌, 블록은 프로젝트 사본 위에 개인 사본
 * (<store>/.guideline/)을 겹쳐 읽는다. 커밋되는 .gitignore 블록은 개인 겹 없이 조합했을 때의 경로로만 써서 작업자마다 같고,
 * 개인 겹에서만 나온 경로는 exclude(info/exclude 의 단위·워크트리 블록에 쓸 것)로 돌려준다. info/exclude 는 호출자가 쓴다(writeExclude).
 * @param {{ project: string, manifest: import('./manifest.js').Manifest, nested?: boolean, rulerAgentsEnabled?: boolean,
 *   personal?: { local: import('./personal.js').Local, store: string, common: string, unitRel: string, worktree: string } | null }} opts
 *   project 는 단위 디렉터리(절대경로), manifest 는 v3(출처별 실제 id·별칭). personal 은 composeInputs 가 만든다(git 이 아니면 null)
 * @returns {{ files: Record<string, Buffer | null>, generated: { project: string[], personal: string[] }, todos: object[],
 *   exclude: { markers: { start: string, end: string }, paths: string[] } | null }}
 *   generated.project 는 개인 겹 없이 조합했을 때의 경로(단위 기준, 정렬) — .gitignore 블록에 그대로 적힌다.
 *   generated.personal 은 이번 결과 중 그 밖의 경로. exclude.paths 는 그것을 워크트리 루트 기준 패턴으로 바꾼 것
 */
export function compose({ project, manifest, nested = false, rulerAgentsEnabled = false, personal = null }) {
  const guide = diskTree(path.join(project, GUIDE_DIR));
  const readRel = rel => {
    try {
      return fs.readFileSync(path.join(project, ...rel.split('/')));
    } catch {
      return null;
    }
  };

  // 사본이 있는 항목만 조합한다. 막혔거나 원본에서 사라진 항목은 동기화가 지난 사본을 남겨 두므로 그것을 쓴다.
  const fit = ks => ks.filter(k => !(nested && isRootOnly(k)));
  const projectKeys = fit(virtualKeys(manifest));
  const layer = personal ? personalLayer(manifest, personal.local) : null;
  const chosen = layer ? layer.manifest : manifest;
  const keys = layer ? fit(virtualKeys(chosen)) : projectKeys;
  // 개인 사본은 개인으로 더한 키 아래에서만 읽는다(personalTree)
  const added = layer ? fit(layer.added) : [];
  const tree = added.length ? personalTree(guide, diskTree(path.join(personal.store, GUIDE_DIR)), added, projectKeys) : guide;
  const projectStacks = stacksOf(projectKeys);
  const management = managementOf(guide, chosen);
  if (layer?.note) management.personal = { ...layer.note, stacks: [...stacksOf(keys)].filter(s => !projectStacks.has(s)).sort(byStr) };

  const shared = { guide, nested, rulerAgentsEnabled, readRel };
  const main = build({ ...shared, tree, manifest: chosen, keys, management, quiet: projectStacks });
  const projectWant = layer?.changed
    ? build({ ...shared, tree: guide, manifest, keys: projectKeys, management: managementOf(guide, manifest) }).want
    : main.want;
  const want = main.want;
  const todos = main.todos;

  const generated = {
    project: [...projectWant.keys()].sort(byStr),
    personal: [...want.keys()].filter(p => !projectWant.has(p)).sort(byStr),
  };
  const files = {};
  for (const p of [...want.keys()].sort(byStr)) {
    const cur = readRel(p);
    if (cur === null || !cur.equals(want.get(p))) files[p] = want.get(p);
  }

  // 지난 조합이 블록(.gitignore, 개인이면 info/exclude 의 이 워크트리 단위 블록)에 적은 것 중 이번에 만들지 않는 것을 지운다.
  // 블록에 없는 파일(프로젝트 자체 .ruler/*.md 등)은 모른다.
  const giRaw = readRel(GITIGNORE);
  const gi = giRaw === null ? null : giRaw.toString('utf8');
  const before = [];
  for (const line of readBlock(gi)) if (line.startsWith('/')) before.push(line.slice(1));
  if (personal) {
    for (const line of readExclude(personal)) {
      const p = unitPathOf(personal.unitRel, line);
      if (p !== null) before.push(p);
    }
  }
  for (const p of new Set(before)) {
    if (want.has(p) || !removable(p)) continue;
    let isFile = false;
    try {
      isFile = fs.statSync(path.join(project, ...p.split('/'))).isFile();
    } catch {
      isFile = false;
    }
    if (isFile) files[p] = null;
  }

  const nextGi = writeBlock(gi, generated.project.map(p => `/${p}`));
  if (nextGi !== (gi ?? '')) files[GITIGNORE] = Buffer.from(nextGi);
  const exclude = personal
    ? { markers: excludeMarkers(personal.unitRel, personal.worktree), paths: generated.personal.map(p => excludePattern(personal.unitRel, p)) }
    : null;
  return { files, generated, todos, exclude };
}
