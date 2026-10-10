import fs from 'node:fs';
import path from 'node:path';
import { sha256, normalized } from './hashes.js';
import { stripFrontmatter } from './inspect.js';
import { isTextPath } from './store-paths.js';
import { currentPart } from './render/index.js';
import { diskReader } from './project-state.js';
import { realOf, unitOf, unitName, setNameLine } from './sources.js';
import { t } from './i18n.js';

const RULE_COPY = /^(?:\.ruler|docs\/guideline)\/([^/]+)\/(\d{2}-[a-z0-9][a-z0-9-]*\.md)$/;
const SETUP_COPY = /^docs\/guideline\/([^/]+)\/SETUP\.md$/;
const AGENT_COPY = /^\.ruler\/agents\/([^/]+\.md)$/;
const SKILL_COPY = /^\.ruler\/skills\/([^/]+)\/(.+)$/;
const lf = s => s.replace(/\r\n/g, '\n');
const hidden = rel => rel.split('/').some(s => s.startsWith('.'));
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 디렉터리 안 파일의 상대경로(점 이름 제외). 없으면 빈 배열. */
export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = rel => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(r);
      else if (d.isFile()) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/**
 * 원본 경로 하나의 변경. 기준과 줄바꿈만 다르면 null(바뀐 것이 없다).
 * @param {import('./tree.js').Tree} base 기준 원본 트리
 */
export function changeOf(base, p, content) {
  const before = base.read(p);
  if (content !== null && before !== null && normalized(p, before).equals(normalized(p, content))) return null;
  if (content === null && before === null) return null;
  return { path: p, content: content === null ? null : normalized(p, content), base: before === null ? null : sha256(before) };
}

/** 사본 경로를 원본 경로와 내용으로. 되돌릴 수 없으면 null. */
function sourceOf(base, rel, cur) {
  let m = RULE_COPY.exec(rel);
  if (m) {
    const src = `rules/${m[1]}/${m[2]}`;
    const text = lf(base.read(src)?.toString('utf8') ?? '');
    const prefix = text.slice(0, text.length - stripFrontmatter(text).length);
    return { path: src, content: cur === null ? null : Buffer.from(prefix + cur.toString('utf8')) };
  }
  m = SETUP_COPY.exec(rel);
  if (m) return { path: `rules/${m[1]}/SETUP.md`, content: cur };
  m = AGENT_COPY.exec(rel);
  if (m) return { path: `agents/${m[1]}`, content: cur };
  m = SKILL_COPY.exec(rel);
  if (m) return { path: `skills/${m[1]}/${m[2]}`, content: cur };
  return null;
}

/**
 * 잠금 기준으로 「프로젝트에서 고침」 인 사본을 원본 경로의 변경으로 되돌린다.
 * 지침·세팅 문서·서브에이전트는 고친 것만, 스킬은 파일마다 바뀜·더함·지움을 낸다. MCP 는 할 일로 남긴다.
 * @param {{ base: import('./tree.js').Tree, project: string, lock: import('./manifest.js').Lock, only?: Set<string> | null }} opts
 */
export function localChanges({ base, project, lock, only = null }) {
  const reader = diskReader(project);
  const want = id => !only || only.has(id);
  const changes = new Map();
  const todos = [];
  const put = c => {
    if (c) changes.set(c.path, c);
  };
  const mcpTodo = new Set();
  for (const o of lock.outputs) {
    if (o.items.length !== 1 || !want(o.items[0])) continue;
    const id = o.items[0];
    const cur = currentPart(reader, o);
    if (cur !== null && sha256(cur) === o.hash) continue;
    if (o.adopted && !only?.has(id)) {
      todos.push({ kind: 'adopted', item: id, message: t('todo.adopted', { path: o.path, id }) });
      continue;
    }
    if (o.key) {
      if (cur !== null && !mcpTodo.has(id)) {
        mcpTodo.add(id);
        todos.push({ kind: 'mcp-local', item: id, message: t('todo.mcpManual', { id }) });
      }
      continue;
    }
    if (cur === null && !SKILL_COPY.test(o.path)) continue;
    const s = sourceOf(base, o.path, cur === null ? null : Buffer.from(cur));
    if (s) put(changeOf(base, s.path, s.content));
  }
  // 스킬 디렉터리에 새로 생긴 파일
  const known = new Set(lock.outputs.map(o => o.path));
  for (const id of Object.keys(lock.sources)) {
    if (!id.startsWith('skills/') || !want(id)) continue;
    const name = id.slice('skills/'.length);
    for (const rel of listFiles(path.join(project, '.ruler', 'skills', name))) {
      const copy = `.ruler/skills/${name}/${rel}`;
      if (known.has(copy) || hidden(rel)) continue;
      put(changeOf(base, `skills/${name}/${rel}`, fs.readFileSync(path.join(project, ...copy.split('/')))));
    }
  }
  return { changes: [...changes.values()].sort((a, b) => (a.path < b.path ? -1 : 1)), todos };
}

/** API 본문의 변경 하나. 텍스트면 text, 아니면 base64. */
export function toApiChange(c) {
  if (c.content === null) return { path: c.path, delete: true, base: c.base };
  if (isTextPath(c.path) || !c.content.includes(0)) {
    try {
      return { path: c.path, text: utf8.decode(c.content), base: c.base };
    } catch {
      // 바이너리
    }
  }
  return { path: c.path, base64: c.content.toString('base64'), base: c.base };
}

/**
 * 가상 경로의 변경을 출처별 원래 경로로 되돌린다. 별칭 스킬·서브에이전트의 name 줄은 원래 이름으로 되돌리고,
 * 기준 해시는 그 출처 원본(잠금 리비전) 기준으로 다시 계산한다.
 * @param {{ changes: { path: string, content: Buffer | null, base: string | null }[], sources: object[], trees: Map<string, { tree: object }> }} opts
 * @returns {Map<string, { path: string, content: Buffer | null, base: string | null }[]>}
 */
export function toRealChanges({ changes, sources, trees }) {
  const out = new Map();
  for (const c of changes) {
    const r = realOf(c.path, sources);
    if (!r || !trees.has(r.source)) continue;
    const aliases = sources.find(s => s.name === r.source)?.aliases ?? {};
    const unit = unitOf(r.id);
    let content = c.content;
    const named = unit && aliases[unit] && ((unit.startsWith('skills/') && r.id === `${unit}/SKILL.md`) || (unit.startsWith('agents/') && r.id === unit));
    if (content !== null && named) content = Buffer.from(setNameLine(content.toString('utf8'), unitName(unit)));
    const ch = changeOf(trees.get(r.source).tree, r.id, content);
    if (!ch) continue;
    if (!out.has(r.source)) out.set(r.source, []);
    out.get(r.source).push(ch);
  }
  return out;
}
