import fs from 'node:fs';
import path from 'node:path';
import { stacks, stackTiers, stackOverrides, stackSetup, skills, subagents, mcpDefinitions } from './catalog.js';
import { headings, sectionBody } from './sections.js';
import { readProjectOverrides, checkOverrides } from './project-overrides.js';
import { unifiedDiff, keyPathDiff } from './diff.js';
import { asTree, readText } from './tree.js';
import { copyPath, GUIDE_DIR } from './layout.js';
import { t } from './i18n.js';

const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'];
const RULE_FILE = /^\d{2}-[a-z0-9][a-z0-9-]*\.md$/;
const DIFFABLE = ['different', 'moved'];
/** 지침 파일 id 의 스택 경로와 파일 이름. 스택 경로는 하위 스택이면 `browser/neo` 처럼 여러 조각이다. */
const RULE = /^rules\/(.+)\/([^/]+)$/;

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const exists = file => fs.existsSync(file);
/** 원본 트리의 텍스트. 줄바꿈을 \n 으로 맞춘다. */
const text = (tree, rel) => readText(tree, rel).replace(/\r\n/g, '\n');

/**
 * @typedef {'same' | 'different' | 'moved' | 'present' | 'unknown' | 'missing' | 'blocked' | 'orphan'} State
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

/**
 * 프로젝트의 지침 형태. 사본·import 관계는 가리지 않는다 — 에이전트가 한다.
 * @param {string | null} project
 * @returns {{ form: 'ruler' | 'instructions' | 'none', instructionFiles: string[] }}
 */
export function detectForm(project) {
  if (!project) return { form: 'none', instructionFiles: [] };
  if (exists(path.join(project, '.ruler'))) return { form: 'ruler', instructionFiles: [] };
  const files = INSTRUCTION_FILES.filter(f => exists(path.join(project, f)));
  return { form: files.length > 0 ? 'instructions' : 'none', instructionFiles: files };
}

/** 사본 하나를 원본 내용(줄바꿈을 맞춘 것)과 비교한다. */
function copyState(source, project, rel) {
  const file = path.join(project, rel);
  if (!exists(file)) return { state: 'missing' };
  return { state: read(file) === source ? 'same' : 'different', where: [rel] };
}

/** 한 지침 파일의 상태(blocked 가 아닌 것). */
function ruleState(tree, project, form, instructionFiles, f) {
  const [, stack, name] = RULE.exec(f.path);
  const copy = `.ruler/${stack}/${name}`;
  const ref = `docs/guideline/${stack}/${name}`;
  const src = stripFrontmatter(text(tree, f.path));
  const at = rel => exists(path.join(project, rel));

  if (form === 'ruler') {
    const [expected, other] = f.load === 'always' ? [copy, ref] : [ref, copy];
    if (at(expected)) return copyState(src, project, expected);
    if (at(other)) return { state: 'moved', where: [other] };
    return { state: 'missing' };
  }

  // instructions·none: always 는 지침 파일 안의 절로 들어가 있다.
  const titles = [...headings(src)];
  const texts = instructionFiles.map(rel => ({ rel, text: read(path.join(project, rel)) }));
  const found = titles.map(title => texts.find(x => sectionBody(x.text, title) !== null) ?? null);
  const hits = found.filter(Boolean);
  const whereOf = list => [...new Set(list.map(x => x.rel))];

  if (f.load === 'reference') {
    if (at(ref)) return copyState(src, project, ref);
    if (titles.length > 0 && hits.length === titles.length) return { state: 'moved', where: whereOf(hits) };
    return { state: 'missing' };
  }
  if (titles.length === 0) return { state: 'unknown', reason: t('inspect.noSections') };
  if (hits.length === 0) return at(ref) ? { state: 'moved', where: [ref] } : { state: 'missing' };
  if (hits.length < titles.length) return { state: 'different', where: whereOf(hits), reason: t('inspect.partial') };
  const same = titles.every((title, k) => sectionBody(found[k].text, title) === sectionBody(src, title));
  return { state: same ? 'same' : 'different', where: whereOf(hits) };
}

/** 지침 파일과 세팅 문서 항목. 바꿈 표 경고가 있는 스택은 통째로 blocked. 새 배치면 .guideline/ 사본을 원본 모양 그대로 비교한다. */
function ruleItems(tree, project, form, instructionFiles, guide) {
  const items = [];
  for (const stack of stacks(tree)) {
    const blocked = stackOverrides(stack, tree).warnings.length > 0 ? t('inspect.overrideTableWarning', { stack }) : null;
    for (const f of stackTiers(stack, tree)) {
      const base = { kind: 'rule', id: f.path, stack, load: f.load };
      if (blocked || f.warning) items.push({ ...base, state: 'blocked', reason: blocked ?? f.warning });
      else if (!project) items.push({ ...base, state: 'missing' });
      else if (guide) items.push({ ...base, ...copyState(text(tree, f.path), project, copyPath(f.path)) });
      else items.push({ ...base, ...ruleState(tree, project, form, instructionFiles, f) });
    }
    if (stackSetup(stack, tree)) {
      const id = `rules/${stack}/SETUP.md`;
      const base = { kind: 'setup', id, stack };
      if (blocked) items.push({ ...base, state: 'blocked', reason: blocked });
      else if (!project) items.push({ ...base, state: 'missing' });
      else items.push({ ...base, ...copyState(text(tree, id), project, guide ? copyPath(id) : `docs/guideline/${stack}/SETUP.md`) });
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

/** 스킬: 새 배치면 .guideline/skills, ruler 면 .ruler/skills, 아니면 .claude/skills·.agents/skills 중 있는 곳. */
function skillItems(tree, project, form, guide) {
  return skills(tree).map(name => {
    const base = { kind: 'skill', id: `skills/${name}` };
    if (!project) return { ...base, state: 'missing' };
    const places = guide ? [copyPath(base.id)]
      : (form === 'ruler' ? ['.ruler/skills'] : ['.claude/skills', '.agents/skills']).map(p => `${p}/${name}`);
    const where = places.filter(p => isDir(path.join(project, p)));
    if (where.length === 0) return { ...base, state: 'missing' };
    const src = sourceFiles(tree, `skills/${name}`);
    const same = where.every(p => sameFiles(src, treeFiles(path.join(project, p))));
    return { ...base, state: same ? 'same' : 'different', where };
  });
}

/** 서브에이전트: 새 배치면 .guideline/agents 사본만, ruler 면 .ruler/agents, 아니면 .claude/agents. Codex .toml 만 있으면 present. */
function subagentItems(tree, project, form, guide) {
  return subagents(tree).map(name => {
    const id = `agents/${name}.md`;
    const base = { kind: 'subagent', id };
    if (!project) return { ...base, state: 'missing' };
    if (guide) return { ...base, ...copyState(text(tree, id), project, copyPath(id)) };
    const rel = form === 'ruler' ? `.ruler/agents/${name}.md` : `.claude/agents/${name}.md`;
    if (exists(path.join(project, rel))) return { ...base, ...copyState(text(tree, id), project, rel) };
    const codex = `.codex/agents/${name}.toml`;
    if (exists(path.join(project, codex))) return { ...base, state: 'present', where: [codex] };
    return { ...base, state: 'missing' };
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
 * MCP: .mcp.json 은 type 을 빼고 비교, TOML(ruler·Codex)은 있는지만 본다.
 * 새 배치면 .guideline/mcp/<이름>/ 사본을 원본 디렉터리와 비교한다. 사본을 두지 않는 build MCP 만 예전처럼 에이전트 설정에서 찾는다.
 */
function mcpItems(tree, project, guide) {
  const mcpJson = project ? readMcpJson(project) : null;
  return mcpDefinitions(tree).map(def => {
    const base = { kind: 'mcp', id: `mcp/${def.name}`, build: def.build };
    if (!project) return { ...base, state: 'missing' };
    if (guide && !def.build) {
      const copy = copyPath(base.id);
      if (!isDir(path.join(project, copy))) return { ...base, state: 'missing' };
      return { ...base, state: sameFiles(sourceFiles(tree, base.id), treeFiles(path.join(project, copy))) ? 'same' : 'different', where: [copy] };
    }
    if (Object.hasOwn(mcpJson.servers, def.name)) {
      if (def.build) return { ...base, state: 'present', where: ['.mcp.json'] };
      const diff = keyPathDiff(def.server, mcpJson.servers[def.name]);
      return { ...base, state: diff.length ? 'different' : 'same', where: ['.mcp.json'] };
    }
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
 * 새 배치에서 원본에 없는 사본: .guideline/rules/ 아래 모든 깊이의 지침 파일·세팅 문서, .guideline/skills/<이름>/,
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
 * 원본에서 사라진 사본. docs/guideline/<스택 경로>/ 는 모두, .ruler/<스택 경로>/ 는 표식(원본 rules/ 의 같은 경로 폴더,
 * docs/guideline/<같은 경로>/, 99-reference.md)이 있거나 표식이 있는 폴더 안의 폴더(하위 스택 자리)만 본다. 하위 스택 폴더는
 * 그 하위 스택(rules/<스택 경로>/)을 기준으로 판단한다. override.md·override.d/·99-reference.md 는 빼고,
 * 스킬·서브에이전트·MCP 는 프로젝트 고유 것과 구별할 수 없어 보지 않는다.
 */
function orphanItems(tree, project) {
  if (!project) return [];
  const inSource = (stack, file) => tree.exists(`rules/${stack}/${file}`);
  const sourceDir = stack => tree.list(`rules/${stack}`).length > 0;
  const items = [];
  const docs = path.join(project, 'docs/guideline');
  for (const stack of dirsUnder(docs)) {
    for (const f of filesIn(path.join(docs, stack))) {
      if ((RULE_FILE.test(f) || f === 'SETUP.md') && !inSource(stack, f)) {
        items.push({ kind: 'orphan', id: `docs/guideline/${stack}/${f}`, stack, state: 'orphan' });
      }
    }
  }
  const ruler = path.join(project, '.ruler');
  const walk = (rel, parentMarked) => {
    for (const name of subdirs(rel ? path.join(ruler, rel) : ruler)) {
      if (name === 'override.d' || (!rel && (name === 'skills' || name === 'agents'))) continue;
      const stack = rel ? `${rel}/${name}` : name;
      const marked = parentMarked || sourceDir(stack)
        || isDir(path.join(docs, stack))
        || exists(path.join(ruler, stack, '99-reference.md'));
      if (marked) {
        for (const f of filesIn(path.join(ruler, stack))) {
          if (RULE_FILE.test(f) && f !== '99-reference.md' && !inSource(stack, f)) {
            items.push({ kind: 'orphan', id: `.ruler/${stack}/${f}`, stack, state: 'orphan' });
          }
        }
      }
      walk(stack, marked);
    }
  };
  walk('', false);
  return items;
}

/**
 * 원본과 프로젝트를 비교한다.
 * @param {string | import('./tree.js').Tree} src 문서 저장소 경로나 원본 트리
 * @param {string | null} project 프로젝트 절대경로. null 이면 새 프로젝트
 * @param {{ layout?: 'ruler' | 'guideline' | 'none' }} [opts] guideline 이면 .guideline/ 사본과 .guideline/overrides/ 를 본다(moved 는 없다)
 * @returns {{ form: 'ruler' | 'instructions' | 'none', instructionFiles: string[], items: Item[], overrides: object[] }}
 */
export function inspect(src, project, { layout = 'ruler' } = {}) {
  const tree = asTree(src);
  const { form, instructionFiles } = detectForm(project);
  const guide = layout === 'guideline' && project !== null;
  const items = [
    ...ruleItems(tree, project, form, instructionFiles, guide),
    ...skillItems(tree, project, form, guide),
    ...subagentItems(tree, project, form, guide),
    ...mcpItems(tree, project, guide),
    ...(guide ? guideOrphans(tree, project) : orphanItems(tree, project)),
  ];
  const overrides = project ? checkOverrides(readProjectOverrides(project, form, instructionFiles, guide ? 'guideline' : 'ruler'), tree) : [];
  return { form, instructionFiles, items, overrides };
}

/**
 * 한 항목의 원본과 프로젝트 차이. 상태를 다시 판정하지 않고 item.where 를 쓴다.
 * different·moved 가 아니면 빈 결과다.
 * @param {string | import('./tree.js').Tree} src
 * @param {string} project
 * @param {Item} item inspect 가 돌려준 항목
 * @returns {{ files: { path: string, diff: string }[] } | { keys: string[] }}
 */
export function itemDiff(src, project, item) {
  const tree = asTree(src);
  const where = item.where ?? [];
  // 새 배치의 사본(.guideline/)은 원본 모양 그대로라 frontmatter 를 떼지 않고 비교한다
  const guide = where.length > 0 && where.every(w => w.startsWith(`${GUIDE_DIR}/`));
  if (item.kind === 'mcp') {
    if (!DIFFABLE.includes(item.state) || item.build) return { keys: [] };
    const name = item.id.slice('mcp/'.length);
    const def = mcpDefinitions(tree).find(d => d.name === name);
    // 값(비밀이 들 수 있다)은 싣지 않고 키 경로만 낸다
    return { keys: def?.server ? keyPathDiff(def.server, guide ? copyServer(project, where[0]) : readMcpJson(project).servers[name]) : [] };
  }
  if (!DIFFABLE.includes(item.state)) return { files: [] };
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
  const src2 = item.kind === 'rule' && !guide ? stripFrontmatter(text(tree, item.id)) : text(tree, item.id);
  if (item.kind === 'rule' && where.length > 0 && where.every(w => INSTRUCTION_FILES.includes(w))) {
    const texts = where.map(rel => ({ rel, text: read(path.join(project, rel)) }));
    const files = [];
    for (const title of headings(src2)) {
      const hit = texts.find(x => sectionBody(x.text, title) !== null);
      const diff = unifiedDiff(sectionBody(src2, title), hit ? sectionBody(hit.text, title) : '');
      if (diff) files.push({ path: t('inspect.sectionPath', { path: hit ? hit.rel : t('inspect.none'), title }), diff });
    }
    return { files };
  }
  return { files: where.map(rel => ({ path: rel, diff: unifiedDiff(src2, read(path.join(project, rel))) })).filter(f => f.diff) };
}
