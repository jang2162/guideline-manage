import fs from 'node:fs';
import path from 'node:path';
import { agentsList } from './render/outputs.js';
import { PROJECT_TOML } from './layout.js';
import { AGENTS } from './manifest.js';
import { t } from './i18n.js';

// `.ruler/ruler.project.toml` 의 최상위 `default_agents` 한 줄을 읽고 바꾼다. ruler 가 실제로 따르는 에이전트 목록이 이것이고,
// guideline.json 의 agents 는 조합(MCP 표, ruler 출력 정리)이 쓴다. 두 목록을 함께 고치는 것은 `guideline agents`.

// 표 머리 줄([a.b], [[a]], 뒤에 주석 허용). 앞 키의 여러 줄 배열 안의 `["a"],` 같은 줄은 bracketDepth 로 건너뛴다
const HEADER = /^\s*\[\[?\s*[A-Za-z0-9_."' -]+\s*\]\]?\s*(?:#.*)?\r?$/;
const LINE = /^(\s*default_agents\s*=\s*)(.*?)(\r?)$/;
const KEY_VALUE = /^\s*[A-Za-z0-9_."'-]+\s*=\s*(.*)$/;

/** 문자열과 주석을 뺀 한 줄의 [ 개수 - ] 개수. */
function bracketDepth(line) {
  const bare = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').replace(/#.*$/, '');
  return (bare.match(/\[/g)?.length ?? 0) - (bare.match(/\]/g)?.length ?? 0);
}

/** 최상위(첫 표 머리 앞) default_agents 줄의 번호와 값. 없으면 null. */
function findLine(lines) {
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    if (depth > 0) {
      // 앞 키의 여러 줄 값 안이다
      depth += bracketDepth(lines[i]);
      continue;
    }
    const m = LINE.exec(lines[i]);
    if (m) return { i, prefix: m[1], value: m[2], cr: m[3] };
    if (HEADER.test(lines[i])) return null;
    const kv = KEY_VALUE.exec(lines[i]);
    if (kv) depth = Math.max(0, bracketDepth(kv[1]));
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

/**
 * 두 목록이 집합으로 다른가. toml 쪽이 없으면(null) 비교할 것이 없어 false. AGENTS 밖 이름(사람이 넣은 cursor 등)은 guideline 이 다루지 않으므로
 * 빼고 비교한다 — 넣으면 `guideline agents` 로 영영 못 맞추는 어긋남이 된다.
 */
export function agentsMismatch(manifestAgents, tomlAgents) {
  if (tomlAgents === null) return false;
  const a = new Set(manifestAgents.filter(x => AGENTS.includes(x)));
  const b = new Set(tomlAgents.filter(x => AGENTS.includes(x)));
  return a.size !== b.size || [...a].some(x => !b.has(x));
}

/**
 * 이 단위의 ruler 가 따르는 default_agents 의 자리. 자기 .ruler/ruler.project.toml 이 있으면 그것, 없는 하위 단위면 git 루트의 것(pick 과 같은 규칙).
 * follows 는 루트를 따를 때 그 루트, 아니면 null. text 는 파일이 없으면 null.
 * @param {string} dir
 * @param {{ root: string, nested: boolean }} unit
 */
export function rulerAgentsSource(dir, unit) {
  const fileOf = d => path.join(d, ...PROJECT_TOML.split('/'));
  const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  const own = read(fileOf(dir));
  const follows = own === null && unit.nested ? unit.root : null;
  const file = fileOf(follows ?? dir);
  return { own, follows, file, text: follows ? read(file) : own };
}

/**
 * guideline.json 의 agents 와 ruler 가 따르는 default_agents 가 다르면 agents-mismatch 할 일 하나, default_agents 가 여러 줄 배열이면
 * agents-unreadable 하나, 같거나 비교할 것이 없으면 빈 목록.
 */
export function agentsMismatchTodos(dir, unit, manifest) {
  const src = rulerAgentsSource(dir, unit);
  const { agents, ok } = readDefaultAgents(src.text);
  // 줄이 없는 것은 ruler 의 기본 동작(아는 에이전트 모두)이라 알리지 않는다. 여러 줄 배열은 비교도 쓰기도 못 한다
  if (!ok) return [{ kind: 'agents-unreadable', item: null, message: t('todo.agentsUnreadable', { file: src.follows ? src.file : PROJECT_TOML }) }];
  if (!agentsMismatch(manifest.agents, agents)) return [];
  const vars = { agents: manifest.agents.join(', '), rulerAgents: agents.join(', ') };
  // 루트를 따르는 단위에서는 그 단위의 guideline agents 로는 ruler 쪽이 안 바뀐다 — git 루트에서 고치라고 한다
  const message = src.follows
    ? t('todo.agentsMismatchRoot', { ...vars, file: src.file, root: src.follows })
    : t('todo.agentsMismatch', { ...vars, file: PROJECT_TOML });
  return [{ kind: 'agents-mismatch', item: null, message }];
}
