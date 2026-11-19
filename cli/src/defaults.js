import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from './i18n.js';
import { configDir } from './config-dir.js';
import { isBlockKey } from './blocks.js';
import { NAME } from './sources.js';

export class DefaultsError extends Error {}

/**
 * 이 머신에서 서버마다 늘 더하거나 빼는 블록(작업자 개인의 기본값). 로그인 정보와 같은 폴더의 defaults.json.
 * 서버마다 공통(add·remove)과 역할별(roles) 기본값을 가진다.
 * @typedef {{ version: 2, servers: Record<string, { add: string[], remove: string[], roles?: Record<string, { add: string[], remove: string[] }> }> }} Defaults
 */

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = list => [...new Set(list)].sort(byStr);
const originOf = server => new URL(server).origin;

/** 서버 키를 origin 으로 맞춰 합친다(끝 슬래시·경로가 달라도 같은 서버). URL 이 아니면 DefaultsError. */
function byOrigin(servers) {
  const out = {};
  for (const [server, s] of Object.entries(servers)) {
    let origin;
    try {
      origin = originOf(server);
    } catch {
      throw new DefaultsError(t('defaults.badServer', { server }));
    }
    const cur = out[origin] ?? { add: [], remove: [] };
    const roles = { ...(cur.roles ?? {}) };
    for (const [role, r] of Object.entries(s.roles ?? {})) {
      const c = roles[role] ?? { add: [], remove: [] };
      roles[role] = { add: uniqSorted([...c.add, ...r.add]), remove: uniqSorted([...c.remove, ...r.remove]) };
    }
    const merged = { add: uniqSorted([...cur.add, ...s.add]), remove: uniqSorted([...cur.remove, ...s.remove]) };
    if (Object.keys(roles).length) merged.roles = Object.fromEntries(Object.keys(roles).sort(byStr).map(k => [k, roles[k]]));
    out[origin] = merged;
  }
  return Object.fromEntries(Object.keys(out).sort(byStr).map(k => [k, out[k]]));
}

export function defaultsPath(opts = {}) {
  return path.join(configDir(opts), 'defaults.json');
}

/** @param {{ env?: object, home?: string }} [opts] @returns {Defaults} 파일이 없으면 비어 있다. 깨졌으면 DefaultsError. */
export function readDefaults({ env = process.env, home = os.homedir() } = {}) {
  const file = defaultsPath({ env, home });
  if (!fs.existsSync(file)) return { version: 2, servers: {} };
  const bad = () => new DefaultsError(t('defaults.badFile', { file }));
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw bad();
  }
  const okList = v => Array.isArray(v) && v.every(isBlockKey);
  if (!data || (data.version !== 1 && data.version !== 2) || !data.servers || typeof data.servers !== 'object' || Array.isArray(data.servers)) throw bad();
  const servers = {};
  for (const [origin, s] of Object.entries(data.servers)) {
    if (!s || typeof s !== 'object' || !okList(s.add) || !okList(s.remove)) throw bad();
    const entry = { add: uniqSorted(s.add), remove: uniqSorted(s.remove) };
    if (data.version === 2 && s.roles !== undefined) {
      if (!s.roles || typeof s.roles !== 'object' || Array.isArray(s.roles)) throw bad();
      entry.roles = {};
      for (const [role, r] of Object.entries(s.roles)) {
        if (!NAME.test(role) || !r || typeof r !== 'object' || !okList(r.add) || !okList(r.remove)) throw bad();
        entry.roles[role] = { add: uniqSorted(r.add), remove: uniqSorted(r.remove) };
      }
    }
    servers[origin] = entry;
  }
  return { version: 2, servers: byOrigin(servers) };
}

/** 서버 origin 을 키로, 정렬해 0600 으로 쓴다(폴더는 0700). */
export function writeDefaults(defaults, { env = process.env, home = os.homedir() } = {}) {
  const file = defaultsPath({ env, home });
  const servers = byOrigin(defaults.servers);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ version: 2, servers }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** 그 서버의 기본값. 없으면 null. */
export function defaultsFor(server, opts = {}) {
  const s = readDefaults(opts).servers[originOf(server)];
  return s ? { add: s.add, remove: s.remove } : null;
}

/** 그 서버의 그 역할 기본값(공통 기본값은 따로 defaultsFor). 없으면 null. */
export function roleDefaultsFor(server, role, opts = {}) {
  return readDefaults(opts).servers[originOf(server)]?.roles?.[role] ?? null;
}
