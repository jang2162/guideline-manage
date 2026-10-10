const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const WHOLE = new RegExp(`^\\$\\{(${NAME})\\}$`);
const BEARER = new RegExp(`^Bearer \\$\\{(${NAME})\\}$`);
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const entriesOf = v => (isObj(v) ? Object.entries(v) : []);

/**
 * server.json 을 Codex `[mcp_servers.<이름>]` 의 값으로 바꾼다(0.10 Codex 변환 표). type 은 쓰지 않는다.
 * @param {object} server
 */
export function codexEntry(server) {
  const out = {};
  for (const k of ['command', 'args', 'url']) if (server[k] !== undefined) out[k] = server[k];
  const envVars = [];
  const env = {};
  for (const [k, v] of entriesOf(server.env)) {
    const m = WHOLE.exec(v);
    if (m) envVars.push(m[1]);
    else env[k] = v;
  }
  if (envVars.length) out.env_vars = envVars;
  if (Object.keys(env).length) out.env = env;
  const envHeaders = {};
  const fixed = {};
  for (const [k, v] of entriesOf(server.headers)) {
    const bearer = k.toLowerCase() === 'authorization' ? BEARER.exec(v) : null;
    if (bearer) {
      out.bearer_token_env_var = bearer[1];
      continue;
    }
    const m = WHOLE.exec(v);
    if (m) envHeaders[k] = m[1];
    else fixed[k] = v;
  }
  if (Object.keys(envHeaders).length) out.env_http_headers = envHeaders;
  if (Object.keys(fixed).length) out.http_headers = fixed;
  return out;
}

/** ruler 에서 전역 [mcp_servers] 대신 에이전트별 표로 써야 하는가(변수 참조나 headers). */
export function needsAgentTables(server) {
  return isObj(server.headers) || JSON.stringify(server).includes('${');
}

/** 키를 정렬한 JSON. 공유 파일 몫의 해시를 서식과 무관하게 맞춘다. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
