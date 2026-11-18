import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from './i18n.js';
import { configDir } from './config-dir.js';
import { isBlockKey } from './blocks.js';

export class DefaultsError extends Error {}

/**
 * 이 머신에서 서버마다 늘 더하거나 빼는 블록(작업자 개인의 기본값). 로그인 정보와 같은 폴더의 defaults.json.
 * @typedef {{ version: 1, servers: Record<string, { add: string[], remove: string[] }> }} Defaults
 */

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = list => [...new Set(list)].sort(byStr);
const originOf = server => new URL(server).origin;

export function defaultsPath(opts = {}) {
  return path.join(configDir(opts), 'defaults.json');
}

/** @param {{ env?: object, home?: string }} [opts] @returns {Defaults} 파일이 없으면 비어 있다. 깨졌으면 DefaultsError. */
export function readDefaults({ env = process.env, home = os.homedir() } = {}) {
  const file = defaultsPath({ env, home });
  if (!fs.existsSync(file)) return { version: 1, servers: {} };
  const bad = () => new DefaultsError(t('defaults.badFile', { file }));
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw bad();
  }
  const okList = v => Array.isArray(v) && v.every(isBlockKey);
  if (!data || data.version !== 1 || !data.servers || typeof data.servers !== 'object' || Array.isArray(data.servers)) throw bad();
  const servers = {};
  for (const [origin, s] of Object.entries(data.servers)) {
    if (!s || typeof s !== 'object' || !okList(s.add) || !okList(s.remove)) throw bad();
    servers[origin] = { add: uniqSorted(s.add), remove: uniqSorted(s.remove) };
  }
  return { version: 1, servers };
}

/** 서버 origin 을 키로, 정렬해 0600 으로 쓴다(폴더는 0700). */
export function writeDefaults(defaults, { env = process.env, home = os.homedir() } = {}) {
  const file = defaultsPath({ env, home });
  const servers = {};
  for (const origin of Object.keys(defaults.servers).sort(byStr)) {
    const s = defaults.servers[origin];
    servers[origin] = { add: uniqSorted(s.add), remove: uniqSorted(s.remove) };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, servers }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** 그 서버의 기본값. 없으면 null. */
export function defaultsFor(server, opts = {}) {
  return readDefaults(opts).servers[originOf(server)] ?? null;
}
