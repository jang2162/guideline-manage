import { frontmatter, yamlString, readQuoted } from './frontmatter.js';
import { readServer, envVars, serverWarnings } from './mcp.js';
import { readTier } from './tiers.js';
import { overrideRows } from './overrides.js';
import { headings } from './sections.js';
import { readCategories } from './categories.js';
import { asTree, readText } from './tree.js';
import { t } from './i18n.js';
import { marker } from './markers.js';
import { stackNameProblem } from './stack-name.js';

// export 함수의 src 는 문서 저장소 루트의 디스크 경로나 트리(tree.js)다. 서버는 DB 트리를 넘긴다.

const RULE_FILE = /^\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

/** @param {import('./tree.js').Tree} tree */
function ruleFiles(tree, dir) {
  return tree.list(dir).filter(e => !e.dir && RULE_FILE.test(e.name)).map(e => e.name).sort();
}

/** 점으로 시작하지 않는 항목(.gitkeep, .DS_Store 를 뺀다). 디렉터리가 없으면 빈 배열. */
function visible(tree, dir) {
  return tree.list(dir).filter(e => !e.name.startsWith('.'));
}

function byKey(key) {
  return (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
}

/** 지침 파일이 하나 이상 있는 스택 이름. README.md 만 있는 뼈대는 뺀다. */
export function stacks(src) {
  const tree = asTree(src);
  return tree.list('rules')
    .filter(e => e.dir && ruleFiles(tree, `rules/${e.name}`).length > 0)
    .map(e => e.name)
    .sort();
}

/** 한 스택의 지침 파일 상대경로. */
export function stackFiles(stack, src) {
  return ruleFiles(asTree(src), `rules/${stack}`).map(f => `rules/${stack}/${f}`);
}

/**
 * 한 스택의 지침 파일과 칸. 칸이 경고 대상이면 load·when 은 null 이고 warning 에 이유가 붙는다.
 * @returns {{ path: string, load: string | null, when: string | null, warning?: string }[]}
 */
export function stackTiers(stack, src) {
  const tree = asTree(src);
  return stackFiles(stack, tree).map(rel => {
    const tier = readTier(readText(tree, rel));
    return tier.warning ? { path: rel, load: null, when: null, warning: tier.warning } : { path: rel, ...tier };
  });
}

/**
 * 스택 README 의 「다른 스택을 바꾸는 것」 표. 틀린 행은 overrides 에서 빼고 warnings 에 README 경로로 낸다.
 * @returns {{ overrides: { from: { path: string, title: string }, to: { path: string, title: string } }[], warnings: { path: string, message: string }[] }}
 */
export function stackOverrides(stack, src) {
  const tree = asTree(src);
  const readme = `rules/${stack}/README.md`;
  const text = readText(tree, readme) ?? '';
  const overrides = [];
  const warnings = [];
  const listed = s => new Set(stackFiles(s, tree));
  const read = rel => readText(tree, rel);
  for (const row of overrideRows(text)) {
    const problem = rowProblem(stack, row, listed, read);
    if (problem) {
      warnings.push({ path: readme, message: problem });
      continue;
    }
    overrides.push({
      from: { path: `rules/${stack}/${row.from.file}`, title: row.from.title },
      to: { path: `rules/${row.to.stack}/${row.to.file}`, title: row.to.title },
    });
  }
  return { overrides, warnings };
}

/** 스택에 세팅 문서(rules/<스택>/SETUP.md)가 있는가. */
export function stackSetup(stack, src) {
  return asTree(src).exists(`rules/${stack}/SETUP.md`);
}

/** 바꿈 표 한 행의 첫 문제. 없으면 null. */
function rowProblem(stack, row, listed, read) {
  if (row.error) return t('catalog.badCell', { error: row.error });
  const { from, to } = row;
  const fromRef = from.file;
  const toRef = `${to.stack}/${to.file}`;
  if (to.stack === stack) return t('catalog.sameStack', { ref: toRef, title: to.title });
  const fromPath = `rules/${stack}/${from.file}`;
  const toPath = `rules/${to.stack}/${to.file}`;
  if (!listed(stack).has(fromPath)) return t('catalog.noFile', { ref: fromRef });
  if (!listed(to.stack).has(toPath)) return t('catalog.noFile', { ref: toRef });
  const fromText = read(fromPath);
  if (!headings(fromText).has(from.title)) return t('catalog.noSection', { ref: fromRef, title: from.title });
  if (!headings(read(toPath)).has(to.title)) return t('catalog.noSection', { ref: toRef, title: to.title });
  if (readTier(fromText).load !== 'always') return t('catalog.overrideNotAlways', { ref: fromRef });
  return null;
}

/** SKILL.md 가 있는 스킬 이름. */
export function skills(src) {
  const tree = asTree(src);
  return tree.list('skills')
    .filter(e => e.dir && tree.exists(`skills/${e.name}/SKILL.md`))
    .map(e => e.name)
    .sort();
}

/**
 * agents/ 의 항목마다 서브에이전트인지 판정한다. ruler 가 건너뛰는 조건과 같다.
 * @returns {{ path: string, name?: string, reason?: string }[]}
 */
function agentEntries(tree) {
  const result = [];
  for (const d of visible(tree, 'agents')) {
    if (d.name === 'README.md') continue;
    if (d.dir) {
      result.push({ path: `agents/${d.name}/`, reason: t('catalog.subdirIgnored') });
      continue;
    }
    const rel = `agents/${d.name}`;
    if (!d.name.endsWith('.md')) {
      result.push({ path: rel, reason: t('catalog.notMd') });
      continue;
    }
    const stem = d.name.slice(0, -'.md'.length);
    const fm = frontmatter(readText(tree, rel));
    if (!fm) {
      result.push({ path: rel, reason: t('catalog.noFrontmatter') });
      continue;
    }
    const name = yamlString(fm.name ?? '');
    const description = yamlString(fm.description ?? '');
    if (name === null || description === null) result.push({ path: rel, reason: t('catalog.badYaml') });
    else if (name !== stem) result.push({ path: rel, reason: t('catalog.nameMismatch') });
    else if (!description) result.push({ path: rel, reason: t('catalog.noDescription') });
    else result.push({ path: rel, name: stem });
  }
  return result;
}

/**
 * mcp/ 의 항목마다 서버인지 판정한다.
 * @returns {{ path: string, name: string, server?: object, build?: true, reason?: string, ambiguous?: true }[]}
 */
function mcpEntries(tree) {
  return visible(tree, 'mcp')
    .filter(d => d.name !== 'README.md')
    .map(d => (d.dir
      ? { path: `mcp/${d.name}/`, name: d.name, ...readServer(tree, `mcp/${d.name}`) }
      : { path: `mcp/${d.name}`, name: d.name, reason: t('catalog.notDir') }))
    .sort(byKey('name'));
}

/** 조건을 만족하는 서브에이전트 이름. */
export function subagents(src) {
  return agentEntries(asTree(src)).filter(e => e.name).map(e => e.name).sort();
}

/**
 * 읽히는 MCP 서버와 그 서버가 참조하는 환경 변수. 반영할 때 README.md 로 만드는 서버는 build 가 붙고
 * 환경 변수를 알 수 없어 빈 배열이다.
 * @returns {{ name: string, envVars: string[], build?: true }[]}
 */
export function mcpServers(src) {
  return mcpEntries(asTree(src))
    .filter(e => e.server || e.build)
    .map(e => (e.build ? { name: e.name, envVars: [], build: true } : { name: e.name, envVars: envVars(e.server) }));
}

/**
 * 목록에 들어가는 MCP 서버의 정의. server.json 이 있으면 server, README 로 만드는 서버면 build 가 참이다.
 * @returns {{ name: string, server?: object, build: boolean }[]}
 */
export function mcpDefinitions(src) {
  return mcpEntries(asTree(src))
    .filter(e => e.server || e.build)
    .map(e => (e.build ? { name: e.name, build: true } : { name: e.name, server: e.server, build: false }));
}

/**
 * list 가 목록에서 빼는 것들과 그 이유. 원본 기준 상대경로로 정렬한다.
 * @returns {{ path: string, reason: string }[]}
 */
export function ignored(src) {
  const tree = asTree(src);
  const result = [];

  for (const d of visible(tree, 'rules')) {
    if (!d.dir) continue;
    for (const f of visible(tree, `rules/${d.name}`)) {
      if (!f.dir && f.name.endsWith('.md') && f.name !== 'README.md' && f.name !== 'SETUP.md' && !RULE_FILE.test(f.name)) {
        result.push({ path: `rules/${d.name}/${f.name}`, reason: t('catalog.badRuleName') });
      }
    }
  }

  for (const d of visible(tree, 'skills')) {
    if (d.dir && !tree.exists(`skills/${d.name}/SKILL.md`)) {
      result.push({ path: `skills/${d.name}/`, reason: t('catalog.noSkillMd') });
    }
  }

  for (const e of agentEntries(tree)) {
    if (e.reason) result.push({ path: e.path, reason: e.reason });
  }
  for (const e of mcpEntries(tree)) {
    if (e.reason) result.push({ path: e.path, reason: e.reason });
  }

  return result.sort(byKey('path'));
}

/** 분류를 읽는 요소와 그 파일. 키는 요소 경로다. */
function categorySources(tree) {
  const sources = [];
  for (const s of stacks(tree)) {
    sources.push({ key: `rules/${s}`, file: `rules/${s}/README.md` });
    for (const rel of stackFiles(s, tree)) sources.push({ key: rel, file: rel });
  }
  for (const name of skills(tree)) sources.push({ key: `skills/${name}`, file: `skills/${name}/SKILL.md` });
  for (const name of subagents(tree)) sources.push({ key: `agents/${name}.md`, file: `agents/${name}.md` });
  for (const s of mcpServers(tree)) sources.push({ key: `mcp/${s.name}`, file: `mcp/${s.name}/README.md` });
  return sources;
}

/**
 * 요소마다 자신의 분류. 분류가 없거나 경고가 난 요소는 키가 없다. 경고는 그 파일 경로로 낸다.
 * @returns {{ categories: Record<string, string[]>, warnings: { path: string, message: string }[] }}
 */
export function elementCategories(src) {
  const tree = asTree(src);
  const categories = {};
  const found = [];
  for (const { key, file } of categorySources(tree)) {
    const text = readText(tree, file);
    if (text === null) continue;
    const r = readCategories(text);
    if (r.warning) found.push({ path: file, message: r.warning });
    else if (r.categories.length > 0) categories[key] = r.categories;
  }
  return { categories, warnings: found };
}

/**
 * 블록마다 표시 이름(frontmatter `label`). 키는 elementCategories 와 같고, 지침 파일 키는 쓰지 않는다.
 * 값이 없거나 비면 키가 없다. 화면에만 쓰는 값이라 경고는 내지 않는다.
 * @returns {{ labels: Record<string, string> }}
 */
export function elementLabels(src) {
  const tree = asTree(src);
  const labels = {};
  for (const { key, file } of categorySources(tree)) {
    if (key === file && key.startsWith('rules/')) continue;
    const raw = frontmatter(readText(tree, file) ?? '')?.label;
    const value = raw === undefined ? '' : (readQuoted(raw.trim()) ?? raw.trim()).trim();
    if (value) labels[key] = value;
  }
  return { labels };
}

/**
 * 지침 파일의 분류: 스택 분류 ∪ 파일 분류.
 * @param {Record<string, string[]>} categories elementCategories 의 categories
 * @param {string} rel `rules/<스택>/<파일>`
 * @returns {string[]}
 */
export function fileCategories(categories, rel) {
  const stack = rel.split('/')[1];
  return [...new Set([...(categories[`rules/${stack}`] ?? []), ...(categories[rel] ?? [])])];
}

/**
 * 목록에 넣었지만 고칠 것이 있는 항목. 지침 파일의 칸, 요소의 분류, 스택 README 의 바꿈 표, MCP 서버의 server.json, server.json 과
 * 「반영할 때 항목 만들기」 절이 함께 있는 서버. 경로순으로 정렬한다(한 경로 안에서는 찾은 순서).
 * @returns {{ path: string, message: string }[]}
 */
export function warnings(src) {
  const tree = asTree(src);
  const rules = stacks(tree).flatMap(s => [
    ...(stackNameProblem(s) ? [{ path: `rules/${s}/`, message: stackNameProblem(s) }] : []),
    ...stackTiers(s, tree).filter(f => f.warning).map(f => ({ path: f.path, message: f.warning })),
    ...stackOverrides(s, tree).warnings,
  ]);
  const mcp = mcpEntries(tree).flatMap(e => [
    ...(e.ambiguous ? [{ path: e.path, message: t('catalog.mcpBoth', { section: marker('buildSection') }) }] : []),
    ...(e.server ? serverWarnings(e.server).map(message => ({ path: `mcp/${e.name}/server.json`, message })) : []),
  ]);
  return [...rules, ...mcp, ...elementCategories(tree).warnings].sort(byKey('path'));
}
