import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.js';

export const MANIFEST = 'guideline.json';
export const LOCK = 'guideline-lock.json';
export const FORMS = ['ruler', 'instructions'];
export const AGENTS = ['claude', 'codex'];

export class ManifestError extends Error {}

const isStrArr = v => Array.isArray(v) && v.every(x => typeof x === 'string');
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function readJsonFile(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new ManifestError(t('manifest.badJson', { file: path.basename(file) }));
  }
}

/**
 * @typedef {{ server: string, items: string[], aliases: Record<string, string> }} Source
 * @typedef {{ version: 2, form: 'ruler' | 'instructions', agents: string[], sources: Record<string, Source> }} Manifest
 * @typedef {{ path: string, key?: string, items: string[], hash: string, adopted?: true }} LockOutput  adopted: 잠금 없이 받을 때 이미 원본과 달랐던 사본
 * @typedef {{ version: 2, revisions: Record<string, number>, sources: Record<string, string>, outputs: LockOutput[] }} Lock
 *   sources 키와 outputs[].items 는 `<출처>:<id>`
 */

/** 출처 이름과 별칭의 규칙(cli/src/sources.js 의 NAME 과 같다). */
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const ALIAS_KEY = /^(rules\/[^/]+|skills\/[^/]+|agents\/[^/]+\.md|mcp\/[^/]+)$/;
const isHttp = v => typeof v === 'string' && /^https?:\/\//.test(v);

export const qualify = (source, id) => `${source}:${id}`;

/** `<출처>:<id>` 를 나눈다. 첫 `:` 로 나눈다. */
export function splitQualified(q) {
  const i = q.indexOf(':');
  return { source: q.slice(0, i), id: q.slice(i + 1) };
}

/**
 * v1(출처 하나) 과 v2 를 받아 v2 로 돌려준다.
 * @returns {Manifest}
 */
export function checkManifest(m) {
  const bad = why => {
    throw new ManifestError(`${MANIFEST}: ${why}`);
  };
  if (!m || typeof m !== 'object') bad(t('manifest.notObject'));
  if (m.version !== 1 && m.version !== 2) bad(t('manifest.badVersion'));
  if (!FORMS.includes(m.form)) bad(t('manifest.badForm'));
  if (!isStrArr(m.agents) || m.agents.length === 0 || !m.agents.every(a => AGENTS.includes(a))) {
    bad(t('manifest.badAgents'));
  }
  let raw;
  if (m.version === 1) {
    if (!isHttp(m.server)) bad(t('manifest.badServer'));
    if (!isStrArr(m.instructionFiles)) bad(t('manifest.badInstructionFiles'));
    if (!isStrArr(m.items)) bad(t('manifest.badItems'));
    raw = { default: { server: m.server, items: m.items } };
  } else {
    if (!m.sources || typeof m.sources !== 'object' || Array.isArray(m.sources)) bad(t('manifest.badSources'));
    raw = m.sources;
  }
  const sources = {};
  for (const [name, s] of Object.entries(raw)) {
    if (!NAME.test(name)) bad(t('manifest.badSourceName', { name }));
    if (!s || typeof s !== 'object') bad(t('manifest.sourceNotObject', { name }));
    if (!isHttp(s.server)) bad(t('manifest.sourceBadServer', { name }));
    if (!isStrArr(s.items)) bad(t('manifest.sourceBadItems', { name }));
    const aliases = s.aliases ?? {};
    if (typeof aliases !== 'object' || Array.isArray(aliases)) bad(t('manifest.sourceBadAliases', { name }));
    for (const [k, v] of Object.entries(aliases)) {
      if (!ALIAS_KEY.test(k)) bad(t('manifest.badAliasKey', { name, key: k }));
      if (typeof v !== 'string' || !NAME.test(v)) bad(t('manifest.badAliasValue', { name, key: k, value: v }));
    }
    sources[name] = { server: s.server, items: [...s.items], aliases: { ...aliases } };
  }
  return { version: 2, form: m.form, agents: [...m.agents], sources };
}

/** @returns {Manifest | null} */
export function readManifest(project) {
  const m = readJsonFile(path.join(project, MANIFEST));
  return m === null ? null : checkManifest(m);
}

/**
 * v1(출처 하나) 과 v2 를 받아 v2 로 돌려준다.
 * @returns {Lock}
 */
export function checkLock(l) {
  const bad = why => {
    throw new ManifestError(`${LOCK}: ${why}`);
  };
  if (!l || typeof l !== 'object') bad(t('manifest.notObject'));
  if (l.version !== 1 && l.version !== 2) bad(t('manifest.badVersion'));
  if (!l.sources || typeof l.sources !== 'object' || !Object.values(l.sources).every(v => typeof v === 'string')) {
    bad(t('lock.badSources'));
  }
  const okOutput = o => o && typeof o.path === 'string' && (o.key === undefined || typeof o.key === 'string')
    && isStrArr(o.items) && typeof o.hash === 'string';
  if (!Array.isArray(l.outputs) || !l.outputs.every(okOutput)) bad(t('lock.badOutputs'));
  const copy = o => ({ path: o.path, ...(o.key ? { key: o.key } : {}), items: [...o.items], hash: o.hash, ...(o.adopted ? { adopted: true } : {}) });
  if (l.version === 1) {
    if (!Number.isInteger(l.revision) || l.revision < 1) bad(t('lock.badRevision'));
    const q = id => qualify('default', id);
    return {
      version: 2,
      revisions: { default: l.revision },
      sources: Object.fromEntries(Object.entries(l.sources).map(([k, v]) => [q(k), v])),
      outputs: l.outputs.map(o => ({ ...copy(o), items: o.items.map(q) })),
    };
  }
  if (!l.revisions || typeof l.revisions !== 'object' || !Object.values(l.revisions).every(r => Number.isInteger(r) && r >= 1)) {
    bad(t('lock.badRevisions'));
  }
  return { version: 2, revisions: { ...l.revisions }, sources: { ...l.sources }, outputs: l.outputs.map(copy) };
}

/** @returns {Lock | null} */
export function readLock(project) {
  const l = readJsonFile(path.join(project, LOCK));
  return l === null ? null : checkLock(l);
}

const sortKeys = o => Object.fromEntries(Object.keys(o).sort(byStr).map(k => [k, o[k]]));

/** @param {Manifest} m v1 모양이면 v2 로 바꿔 쓴다 */
export function manifestText(m) {
  if (m.version !== 2) m = checkManifest(m);
  const sources = {};
  for (const name of Object.keys(m.sources).sort(byStr)) {
    const s = m.sources[name];
    const items = [...new Set(s.items)].sort(byStr);
    if (items.length === 0) continue;
    const aliases = s.aliases ?? {};
    sources[name] = { server: s.server, items, ...(Object.keys(aliases).length ? { aliases: sortKeys(aliases) } : {}) };
  }
  const out = { version: 2, form: m.form, agents: [...new Set(m.agents)].sort(byStr), sources };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** @param {Lock} l v1 모양(렌더링이 낸 가상 잠금 포함)이면 default 출처로 바꿔 쓴다 */
export function lockText(l) {
  if (l.version !== 2) l = checkLock(l);
  const outputs = l.outputs
    .map(o => ({ path: o.path, ...(o.key ? { key: o.key } : {}), items: [...o.items].sort(byStr), hash: o.hash, ...(o.adopted ? { adopted: true } : {}) }))
    .sort((a, b) => byStr(a.path, b.path) || byStr(a.key ?? '', b.key ?? ''));
  return `${JSON.stringify({ version: 2, revisions: sortKeys(l.revisions), sources: sortKeys(l.sources), outputs }, null, 2)}\n`;
}
