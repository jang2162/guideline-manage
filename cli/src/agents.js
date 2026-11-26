import { agentsList } from './render/outputs.js';

// `.ruler/ruler.project.toml` 의 최상위 `default_agents` 한 줄을 읽고 바꾼다. ruler 가 실제로 따르는 에이전트 목록이 이것이고,
// guideline.json 의 agents 는 조합(MCP 표, ruler 출력 정리)이 쓴다. 두 목록을 함께 고치는 것은 `guideline agents`.

const HEADER = /^\s*\[/;
const LINE = /^(\s*default_agents\s*=\s*)(.*?)(\r?)$/;

/** 최상위(첫 표 머리 앞) default_agents 줄의 번호와 값. 없으면 null. */
function findLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (HEADER.test(lines[i])) return null;
    const m = LINE.exec(lines[i]);
    if (m) return { i, prefix: m[1], value: m[2], cr: m[3] };
  }
  return null;
}

/** 한 줄 배열 값을 이름과 줄 끝 꼬리(주석 등)로 나눈다. 한 줄 배열이 아니면 null. */
function parseValue(value) {
  const m = /^\[([^\]]*)\](.*)$/.exec(value);
  if (!m || !/^\s*(#.*)?$/.test(m[2])) return null;
  const names = [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map(x => x[1] ?? x[2]);
  return { names: [...new Set(names)], tail: m[2] };
}

/**
 * default_agents 를 읽는다. 글이 없거나 줄이 없으면 { agents: null, ok: true }. 여러 줄 배열처럼 한 줄로 읽을 수 없으면
 * { agents: null, ok: false } — 이때는 쓰지 않는다.
 * @param {string | null} text
 * @returns {{ agents: string[] | null, ok: boolean }}
 */
export function readDefaultAgents(text) {
  if (text === null) return { agents: null, ok: true };
  const line = findLine(text.split('\n'));
  if (!line) return { agents: null, ok: true };
  const v = parseValue(line.value);
  return v ? { agents: v.names, ok: true } : { agents: null, ok: false };
}

/**
 * default_agents 줄만 정렬한 배열로 바꾼 글. 줄이 없거나 한 줄로 읽을 수 없으면 null. 다른 줄, 줄 끝 주석, 줄끝(CRLF)은 그대로.
 * @param {string} text
 * @param {string[]} agents
 * @returns {string | null}
 */
export function setDefaultAgents(text, agents) {
  const lines = text.split('\n');
  const line = findLine(lines);
  const v = line && parseValue(line.value);
  if (!v) return null;
  lines[line.i] = `${line.prefix}${agentsList(agents)}${v.tail}${line.cr}`;
  return lines.join('\n');
}

/** 두 목록이 집합으로 다른가. toml 쪽이 없으면(null) 비교할 것이 없어 false. */
export function agentsMismatch(manifestAgents, tomlAgents) {
  if (tomlAgents === null) return false;
  const a = new Set(manifestAgents);
  const b = new Set(tomlAgents);
  return a.size !== b.size || [...a].some(x => !b.has(x));
}
