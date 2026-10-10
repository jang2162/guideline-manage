import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @param {{ env?: object, home?: string }} [opts] */
export function credentialsPath({ env = process.env, home = os.homedir() } = {}) {
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'guideline', 'credentials.json');
}

const originOf = server => new URL(server).origin;

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data.servers === 'object' && data.servers !== null ? data : { servers: {} };
  } catch {
    return { servers: {} };
  }
}

function store(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** 그 서버의 토큰. GUIDELINE_TOKEN 이 있으면 그것. 없으면 null. */
export function getToken(server, { env = process.env, home = os.homedir() } = {}) {
  if (env.GUIDELINE_TOKEN) return env.GUIDELINE_TOKEN;
  return load(credentialsPath({ env, home })).servers[originOf(server)]?.token ?? null;
}

export function saveToken(server, { token, name }, { env = process.env, home = os.homedir() } = {}) {
  const file = credentialsPath({ env, home });
  const data = load(file);
  data.servers[originOf(server)] = { token, name };
  store(file, data);
}

/** @returns {boolean} 지웠으면 true */
export function removeToken(server, { env = process.env, home = os.homedir() } = {}) {
  const file = credentialsPath({ env, home });
  const data = load(file);
  const origin = originOf(server);
  if (!data.servers[origin]) return false;
  delete data.servers[origin];
  store(file, data);
  return true;
}
