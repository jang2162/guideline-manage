import fs from 'node:fs';
import path from 'node:path';
import { stacks, stackTiers, stackOverrides, stackSetup, skills, subagents, mcpDefinitions } from './catalog.js';
import { readProjectOverrides, checkOverrides } from './project-overrides.js';
import { unifiedDiff, keyPathDiff } from './diff.js';
import { asTree, readText } from './tree.js';
import { copyPath, GUIDE_DIR } from './layout.js';
import { t } from './i18n.js';

const RULE_FILE = /^\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const exists = file => fs.existsSync(file);
/** 원본 트리의 텍스트. 줄바꿈을 \n 으로 맞춘다. */
const text = (tree, rel) => readText(tree, rel).replace(/\r\n/g, '\n');

/**
 * @typedef {'same' | 'different' | 'present' | 'unknown' | 'missing' | 'blocked' | 'orphan'} State
 * @typedef {{ kind: 'rule' | 'setup' | 'skill' | 'subagent' | 'mcp' | 'orphan', id: string, stack?: string, load?: 'always' | 'reference' | null, state: State, where?: string[], reason?: string, build?: boolean }} Item
 */

/**
 * 지침 파일에서 frontmatter 를 뗀다. sync 가 사본을 쓸 때와 같다: 첫 줄 `---` 부터 닫는 `---` 와 그 뒤 빈 줄까지.
 * 줄바꿈은 \n 으로 맞춘다.
 * @param {string} text
 * @returns {string}
 */
export function stripFrontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return lines.join('\n');
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end === -1) return lines.join('\n');
  let k = end + 1;
  while (k < lines.length && lines[k].trim() === '') k++;
  return lines.slice(k).join('\n');
}

/** 사본 하나를 원본 내용(줄바꿈을 맞춘 것)과 비교한다. */
function copyState(source, project, rel) {
  const file = path.join(project, rel);
  if (!exists(file)) return { state: 'missing' };
  return { state: read(file) === source ? 'same' : 'different', where: [rel] };
}

/** 지침 파일과 세팅 문서 항목. 바꿈 표 경고가 있는 스택은 통째로 blocked. .guideline/ 사본을 원본 모양 그대로 비교한다. */
function ruleItems(tree, project) {
  const items = [];
  for (const stack of stacks(tree)) {
    const blocked = stackOverrides(stack, tree).warnings.length > 0 ? t('inspect.overrideTableWarning', { stack }) : null;
    for (const f of stackTiers(stack, tree)) {
      const base = { kind: 'rule', id: f.path, stack, load: f.load };
      if (blocked || f.warning) items.push({ ...base, state: 'blocked', reason: blocked ?? f.warning });
      else if (!project) items.push({ ...base, state: 'missing' });
      else items.push({ ...base, ...copyState(text(tree, f.path), project, copyPath(f.path)) });
    }
    if (stackSetup(stack, tree)) {
      const id = `rules/${stack}/SETUP.md`;
      const base = { kind: 'setup', id, stack };
      if (blocked) items.push({ ...base, state: 'blocked', reason: blocked });
      else if (!project) items.push({ ...base, state: 'missing' });
      else items.push({ ...base, ...copyState(text(tree, id), project, copyPath(id)) });
    }
  }
  return items;
}

/**
 * 원본 트리의 디렉터리 안 파일 상대경로 → 내용. 점으로 시작하는 항목은 뺀다.
 * @param {import('./tree.js').Tree} tree
 * @param {string} dir
 * @returns {Map<string, Buffer>}
 */
export function sourceFiles(tree, dir) {
  const out = new Map();
  const walk = rel => {
    for (const e of tree.list(rel ? `${dir}/${rel}` : dir)) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.dir) walk(r);
      else out.set(r, tree.read(`${dir}/${r}`));
    }
  };
  walk('');
  return out;
}

/** 프로젝트 디렉터리 안 파일의 상대경로 → 내용. 점으로 시작하는 항목(.DS_Store 등)은 뺀다. */
function treeFiles(dir) {
  const out = new Map();
  const walk = rel => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(r);
      else if (d.isFile()) out.set(r, fs.readFileSync(path.join(dir, r)));
    }
  };
  walk('');
  return out;
}

/** 내용이 같은가. 지침·서브에이전트 사본처럼 줄바꿈 문자(CRLF)만 다른 것은 같다고 본다. */
const sameContent = (a, b) => a.equals(b) || a.toString('utf8').replace(/\r\n/g, '\n') === b.toString('utf8').replace(/\r\n/g, '\n');

function sameFiles(x, y) {
  if (x.size !== y.size) return false;
  for (const [k, v] of x) if (!y.has(k) || !sameContent(v, y.get(k))) return false;
  return true;
}

const isDir = p => exists(p) && fs.statSync(p).isDirectory();

/** 스킬: .guideline/skills/<이름>/ 사본을 원본 디렉터리와 비교한다. */
function skillItems(tree, project) {
  return skills(tree).map(name => {
    const base = { kind: 'skill', id: `skills/${name}` };
    const copy = copyPath(base.id);
    if (!project || !isDir(path.join(project, copy))) return { ...base, state: 'missing' };
    const same = sameFiles(sourceFiles(tree, base.id), treeFiles(path.join(project, copy)));
    return { ...base, state: same ? 'same' : 'different', where: [copy] };
  });
}

/** 서브에이전트: .guideline/agents/<이름>.md 사본. */
function subagentItems(tree, project) {
  return subagents(tree).map(name => {
    const id = `agents/${name}.md`;
    const base = { kind: 'subagent', id };
    if (!project) return { ...base, state: 'missing' };
    return { ...base, ...copyState(text(tree, id), project, copyPath(id)) };
  });
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** TOML 에 그 서버의 표 머리 줄이 있는가. withAgents 면 [agents.<a>.mcp_servers.<이름>] 도 본다. */
function tomlHasServer(file, name, withAgents) {
  if (!exists(file)) return false;
  const n = escapeRe(name);
  const prefix = withAgents ? '(?:agents\\.[A-Za-z0-9_-]+\\.)?' : '';
  return new RegExp(`^\\s*\\[${prefix}mcp_servers\\.(?:${n}|"${n}")\\]\\s*$`, 'm').test(read(file));
}

/** 프로젝트 .mcp.json 의 mcpServers. 읽을 수 없으면 broken. */
function readMcpJson(project) {
  const file = path.join(project, '.mcp.json');
  if (!exists(file)) return { servers: {} };
  try {
    const data = JSON.parse(read(file));
    const servers = data && typeof data.mcpServers === 'object' && data.mcpServers !== null ? data.mcpServers : {};
    return { servers };
  } catch {
    return { servers: {}, broken: true };
  }
}

/** 새 배치 MCP 사본의 server.json. 읽을 수 없으면 null(키 경로 차이가 전부로 나온다). */
function copyServer(project, dir) {
  try {
    return JSON.parse(read(path.join(project, dir, 'server.json')));
  } catch {
    return null;
  }
}

/**
 * MCP: .guideline/mcp/<이름>/ 사본을 원본 디렉터리와 비교한다. 사본을 두지 않는 build MCP 는 에이전트 설정(.mcp.json, ruler·Codex 의
 * TOML)에 그 이름이 있으면 present 다.
 */
function mcpItems(tree, project) {
  const mcpJson = project ? readMcpJson(project) : null;
  return mcpDefinitions(tree).map(def => {
    const base = { kind: 'mcp', id: `mcp/${def.name}`, build: def.build };
    if (!project) return { ...base, state: 'missing' };
    if (!def.build) {
      const copy = copyPath(base.id);
      if (!isDir(path.join(project, copy))) return { ...base, state: 'missing' };
      return { ...base, state: sameFiles(sourceFiles(tree, base.id), treeFiles(path.join(project, copy))) ? 'same' : 'different', where: [copy] };
    }
    if (Object.hasOwn(mcpJson.servers, def.name)) return { ...base, state: 'present', where: ['.mcp.json'] };
    const where = [];
    if (tomlHasServer(path.join(project, '.ruler/ruler.toml'), def.name, true)) where.push('.ruler/ruler.toml');
    if (tomlHasServer(path.join(project, '.codex/config.toml'), def.name, false)) where.push('.codex/config.toml');
    const reason = mcpJson.broken ? { reason: t('inspect.badMcpJson') } : {};
    if (where.length > 0) return { ...base, state: 'present', where, ...reason };
    if (mcpJson.broken) return { ...base, state: 'unknown', ...reason };
    return { ...base, state: 'missing' };
  });
}

/** 디렉터리의 하위 디렉터리 이름(정렬). 없으면 빈 배열. */
function subdirs(dir) {
  return isDir(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() : [];
}

/** 디렉터리의 파일 이름(정렬). */
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name).sort();
}

/** 디렉터리 아래 모든 하위 디렉터리의 상대경로(부모가 앞, 정렬). */
function dirsUnder(dir, rel = '') {
  return subdirs(rel ? path.join(dir, rel) : dir).flatMap(name => {
    const r = rel ? `${rel}/${name}` : name;
    return [r, ...dirsUnder(dir, r)];
  });
}

/**
 * 원본에 없는 사본: .guideline/rules/ 아래 모든 깊이의 지침 파일·세팅 문서, .guideline/skills/<이름>/,
 * .guideline/agents/<이름>.md, .guideline/mcp/<이름>/. .guideline/ 은 받은 것만 두는 자리라 프로젝트 고유 것과 섞이지 않는다.
 * 스킬·MCP 는 디렉터리 하나가 항목 하나다. 바꿈(overrides/)·관리 지침(management/)은 사본이 아니다.
 */
function guideOrphans(tree, project) {
  const g = path.join(project, GUIDE_DIR);
  const items = [];
  const rules = path.join(g, 'rules');
  for (const stack of dirsUnder(rules)) {
    for (const f of filesIn(path.join(rules, stack))) {
      if ((RULE_FILE.test(f) || f === 'SETUP.md') && !tree.exists(`rules/${stack}/${f}`)) {
        items.push({ kind: 'orphan', id: copyPath(`rules/${stack}/${f}`), stack, state: 'orphan' });
      }
    }
  }
  // 원본에 그 자리가 아예 없을 때만 고아다(원본에서 읽히지 않는 항목의 사본을 지우자고 하지 않는다)
  const orphan = id => items.push({ kind: 'orphan', id: copyPath(id), state: 'orphan' });
  const dirsGone = kind => {
    for (const name of subdirs(path.join(g, kind))) if (tree.list(`${kind}/${name}`).length === 0) orphan(`${kind}/${name}`);
  };
  dirsGone('skills');
  const agentDir = path.join(g, 'agents');
  for (const f of isDir(agentDir) ? filesIn(agentDir) : []) if (f.endsWith('.md') && !tree.exists(`agents/${f}`)) orphan(`agents/${f}`);
  dirsGone('mcp');
  return items;
}

/**
 * 원본과 프로젝트의 .guideline/ 사본을 비교한다.
 * @param {string | import('./tree.js').Tree} src 문서 저장소 경로나 원본 트리
 * @param {string | null} project 프로젝트 절대경로. null 이면 새 프로젝트
 * @returns {{ items: Item[], overrides: object[] }}
 */
export function inspect(src, project) {
  const tree = asTree(src);
  const items = [
    ...ruleItems(tree, project),
    ...skillItems(tree, project),
    ...subagentItems(tree, project),
    ...mcpItems(tree, project),
    ...(project ? guideOrphans(tree, project) : []),
  ];
  const overrides = project ? checkOverrides(readProjectOverrides(project), tree) : [];
  return { items, overrides };
}

/**
 * 한 항목의 원본과 프로젝트 차이. 상태를 다시 판정하지 않고 item.where(.guideline/ 사본)를 쓴다.
 * different 가 아니면 빈 결과다. 사본은 원본 모양 그대로라 frontmatter 를 떼지 않고 비교한다.
 * @param {string | import('./tree.js').Tree} src
 * @param {string} project
 * @param {Item} item inspect 가 돌려준 항목
 * @returns {{ files: { path: string, diff: string }[] } | { keys: string[] }}
 */
export function itemDiff(src, project, item) {
  const tree = asTree(src);
  const where = item.where ?? [];
  if (item.kind === 'mcp') {
    if (item.state !== 'different' || item.build) return { keys: [] };
    const name = item.id.slice('mcp/'.length);
    const def = mcpDefinitions(tree).find(d => d.name === name);
    // 값(비밀이 들 수 있다)은 싣지 않고 키 경로만 낸다
    return { keys: def?.server ? keyPathDiff(def.server, copyServer(project, where[0])) : [] };
  }
  if (item.state !== 'different') return { files: [] };
  if (item.kind === 'skill') {
    const a = sourceFiles(tree, item.id);
    const files = [];
    for (const rel of where) {
      const b = treeFiles(path.join(project, rel));
      for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        const diff = unifiedDiff(a.get(k)?.toString('utf8') ?? '', b.get(k)?.toString('utf8') ?? '');
        if (diff) files.push({ path: `${rel}/${k}`, diff });
      }
    }
    return { files };
  }
  const src2 = text(tree, item.id);
  return { files: where.map(rel => ({ path: rel, diff: unifiedDiff(src2, read(path.join(project, rel))) })).filter(f => f.diff) };
}
