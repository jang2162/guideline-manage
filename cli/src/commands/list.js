import fs from 'node:fs';
import path from 'node:path';
import { stacks, stackTiers, stackOverrides, stackSetup, skills, subagents, mcpServers, ignored, warnings, elementCategories } from '../catalog.js';
import { catalogSummary } from '../summary.js';
import { remoteClient, loadSource, explain } from '../remote.js';
import { serverFor } from '../workspace.js';
import { t } from '../i18n.js';

const LOAD_WIDTH = 'reference'.length;
const WIDE_CHAR = /[ᄀ-ᇿ㄰-㆏가-힯＀-｠]/;

/** 문자열의 표시 폭(한글·전각은 2). */
function displayWidth(s) {
  let width = 0;
  for (const ch of s) width += WIDE_CHAR.test(ch) ? 2 : 1;
  return width;
}

/** 두 열을 맞춘다. 오른쪽이 비면 왼쪽만 쓴다. */
function alignColumns(rows) {
  const width = Math.max(0, ...rows.map(([left]) => displayWidth(left))) + 2;
  return rows.map(([left, right]) => (right ? `${left}${' '.repeat(width - displayWidth(left))}${right}` : left));
}

function tierNote(file) {
  if (!file.load) return t('list.warning');
  return file.when ? `${file.load.padEnd(LOAD_WIDTH)}  ${file.when}` : file.load;
}

/** 바뀌는 절은 `<스택>/<파일>`, 바꾸는 절은 이 스택의 파일 이름으로 쓴다. */
function overrideLine(stack, o) {
  const to = o.to.path.replace(/^rules\//, '');
  const from = o.from.path.slice(`rules/${stack}/`.length);
  return t('list.overrideLine', { to, toTitle: o.to.title, from, fromTitle: o.from.title });
}

function mcpNote(server) {
  if (server.build) return t('list.mcpBuild');
  return server.envVars.length ? t('list.mcpEnv', { vars: server.envVars.join(', ') }) : '';
}

/**
 * @param {{ root: string, tree?: object | null, json?: boolean, out?: (s: string) => void }} opts
 * @returns {Promise<number>}
 */
export async function list({ root, tree = null, json = false, out = console.log }) {
  if (!tree && !(fs.existsSync(path.join(root, 'rules')) && fs.statSync(path.join(root, 'rules')).isDirectory())) {
    out(t('list.notSource', { root }));
    return 2;
  }
  const src = tree ?? root;

  if (json) {
    out(JSON.stringify(catalogSummary(src), null, 2));
    return 0;
  }

  const indented = rows => alignColumns(rows).forEach(line => out(`  ${line}`));
  const { categories } = elementCategories(src);
  const catNote = key => (categories[key] ? `[${categories[key].join(', ')}]` : '');
  const notes = (...parts) => parts.filter(Boolean).join('  ');

  out(t('list.stacks'));
  // 파일 열은 스택을 가로질러 맞춘다.
  const tiers = stacks(src).map(name => ({ name, files: stackTiers(name, src) }));
  const lines = alignColumns(tiers.flatMap(s => s.files.map(f => [f.path, notes(catNote(f.path), tierNote(f))])));
  for (const s of tiers) {
    out(`  ${notes(s.name, catNote(`rules/${s.name}`), stackSetup(s.name, src) ? t('list.setupDoc') : '')}`);
    for (const line of lines.splice(0, s.files.length)) out(`    ${line}`);
    for (const o of stackOverrides(s.name, src).overrides) out(`    ${overrideLine(s.name, o)}`);
  }
  out(t('list.skills'));
  indented(skills(src).map(name => [name, catNote(`skills/${name}`)]));
  out(t('list.subagents'));
  indented(subagents(src).map(name => [name, catNote(`agents/${name}.md`)]));
  out('MCP');
  indented(mcpServers(src).map(s => [s.name, notes(catNote(`mcp/${s.name}`), mcpNote(s))]));

  const ig = ignored(src);
  if (ig.length > 0) {
    out(t('list.ignored'));
    indented(ig.map(i => [i.path, i.reason]));
  }

  const warn = warnings(src);
  if (warn.length > 0) {
    out(t('list.warning'));
    indented(warn.map(w => [w.path, w.message]));
  }

  return 0;
}

/**
 * 지침 서버 최신 원본의 목록. 주소는 --server > 이 디렉터리의 guideline.json > GUIDELINE_SERVER.
 * @returns {Promise<number>}
 */
export async function listFromServer({
  server, sourceName, json = false, env = process.env, out = console.log, err = console.error, fetchImpl = fetch, home, cwd = process.cwd(),
}) {
  const { url, token, error } = serverFor({ flag: server, sourceName, cwd, env, home });
  if (error) {
    err(error);
    return 2;
  }
  if (!url) {
    err(t('list.noServer'));
    return 2;
  }
  let src;
  try {
    src = await loadSource(remoteClient({ server: url, token, fetchImpl }));
  } catch (e) {
    err(explain(e, url));
    return 1;
  }
  return list({ root: url, tree: src.tree, json, out });
}
