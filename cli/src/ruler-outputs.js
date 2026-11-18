import fs from 'node:fs';
import path from 'node:path';
import { parseKeyPath } from './toml-table.js';
import { RULER_TOML } from './layout.js';

// ruler 가 .ruler/ 에서 만드는 에이전트 설정 중 ruler 스스로는 정리하지 않는 것(ruler 0.3.44):
// - MCP: 기본 merge 라 ruler.toml 에서 빠진 서버가 에이전트 설정 파일에 남는다. 서버가 하나도 없으면 그 파일을 건드리지 않는다.
// - 스킬·서브에이전트: .ruler/skills·.ruler/agents 에 하나라도 있으면 대상 폴더를 통째로 바꾸지만, 없으면 지난 것을 그대로 둔다.
// 개인 겹이 그것들을 빼거나(프로젝트의 MCP·스킬을 개인으로 뺌), 개인으로 더했던 것을 되돌리면 ruler 만으로는 실제로 빠지지 않는다.
// 그래서 조합이 지난 조합·프로젝트 기준에 있던 이름 중 이번에 없는 것을 지운다. guideline 이 고르는 에이전트(manifest.AGENTS)의 자리만 안다.

/** ruler 가 .gitignore 에 쓰는 자기 블록의 표시(GitignoreUtils). */
export const RULER_BLOCK = Object.freeze({ start: '# START Ruler Generated Files', end: '# END Ruler Generated Files' });

/** 에이전트별 MCP 설정 파일과 서버 표의 키. */
const MCP_FILES = {
  claude: { file: '.mcp.json', json: 'mcpServers' },
  opencode: { file: 'opencode.json', json: 'mcp' },
  codex: { file: '.codex/config.toml', toml: 'mcp_servers' },
};
/** 에이전트별 스킬 폴더(ruler constants *_SKILLS_PATH). */
const SKILL_DIRS = { claude: '.claude/skills', codex: '.agents/skills', opencode: '.opencode/skills' };
/** 에이전트별 서브에이전트 자리(ruler SUBAGENT_TARGET_PATHS, codex 는 .toml 로 바꿔 쓴다). */
const SUBAGENT_DIRS = { claude: { dir: '.claude/agents', ext: '.md' }, codex: { dir: '.codex/agents', ext: '.toml' } };

const SKILL = /^\.ruler\/skills\/([^/]+)\//;
const SUBAGENT = /^\.ruler\/agents\/([^/]+)\.md$/;
const HEADER = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/;
const ARRAY_HEADER = /^\s*\[\[([^[\]]+)\]\]/;

/** ruler 가 읽는 조합 생성물인가(.gitignore 의 ruler 블록과 MCP·스킬·서브에이전트를 가르는 것). 규칙 파일은 출력 종류를 바꾸지 않는다. */
export const isRulerInput = p => p === RULER_TOML || p.startsWith('.ruler/skills/') || p.startsWith('.ruler/agents/');

/** ruler.toml 글자의 MCP 서버 이름: `[mcp_servers.<이름>]`, `[agents.<에이전트>.mcp_servers.<이름>]`. */
export function mcpNames(text) {
  const names = new Set();
  if (text === null) return names;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = HEADER.exec(line);
    if (!h) continue;
    const segs = parseKeyPath(h[1]);
    if (segs.length === 2 && segs[0] === 'mcp_servers') names.add(segs[1]);
    else if (segs.length === 4 && segs[0] === 'agents' && segs[2] === 'mcp_servers') names.add(segs[3]);
  }
  return names;
}

/** 조합 생성물 경로들의 스킬·서브에이전트 이름. */
export function outputNames(paths) {
  const skills = new Set();
  const subagents = new Set();
  for (const p of paths) {
    const s = SKILL.exec(p);
    if (s) skills.add(s[1]);
    const a = SUBAGENT.exec(p);
    if (a) subagents.add(a[1]);
  }
  return { skills, subagents };
}

/** TOML 에서 segs 표와 그 아래 표들을 지운 글자. 지운 것이 없으면 null. */
function dropTomlTable(text, segs) {
  const lines = text.split('\n');
  const under = s => s.length >= segs.length && segs.every((x, i) => s[i] === x);
  const out = [];
  let skip = false;
  let dropped = false;
  for (const line of lines) {
    const h = HEADER.exec(line) ?? ARRAY_HEADER.exec(line);
    if (h) {
      skip = under(parseKeyPath(h[1]));
      if (skip) dropped = true;
    }
    if (!skip) out.push(line);
  }
  return dropped ? out.join('\n').replace(/\n{3,}/g, '\n\n') : null;
}

/** JSON 설정에서 서버들을 지운 것. 그 파일이 서버 표 하나뿐이고 비게 되면 null(파일을 지운다). 바뀌지 않으면 undefined. */
function dropJsonServers(buf, key, names) {
  let data;
  try {
    data = JSON.parse(buf.toString('utf8'));
  } catch {
    return undefined;
  }
  const servers = data?.[key];
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return undefined;
  const gone = [...names].filter(n => Object.hasOwn(servers, n));
  if (!gone.length) return undefined;
  for (const n of gone) delete servers[n];
  const others = Object.keys(data).filter(k => k !== key && k !== '$schema');
  if (Object.keys(servers).length === 0 && others.length === 0) return null;
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
}

/** dir 아래 파일들(단위 기준 상대 경로). 심볼릭 링크는 따라가지 않는다. */
function filesUnder(project, rel) {
  const out = [];
  const walk = r => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(project, ...r.split('/')), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = `${r}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(rel);
  return out;
}

/**
 * 지난 조합(또는 프로젝트 기준)이 ruler 로 만든 것 중 이번 조합에 없는 MCP 서버·스킬·서브에이전트를 에이전트 설정에서 지우는 파일 변경.
 * 단위 기준 경로 → 새 내용(지우면 null). 에이전트 설정 파일이 서버 표 하나뿐이고 비면 그 파일을 지운다(ruler 가 만든 빈 설정).
 * @param {{ project: string, agents: string[], gone: { mcp: Set<string>, skills: Set<string>, subagents: Set<string> },
 *   readRel: (rel: string) => Buffer | null }} opts
 * @returns {Record<string, Buffer | null>}
 */
export function pruneRulerOutputs({ project, agents, gone, readRel }) {
  const files = {};
  for (const agent of agents) {
    const mcp = MCP_FILES[agent];
    if (mcp && gone.mcp.size) {
      const cur = readRel(mcp.file);
      if (cur !== null && mcp.json) {
        const next = dropJsonServers(cur, mcp.json, gone.mcp);
        if (next !== undefined) files[mcp.file] = next;
      } else if (cur !== null) {
        let text = cur.toString('utf8');
        let changed = false;
        for (const n of gone.mcp) {
          const next = dropTomlTable(text, [mcp.toml, n]);
          if (next !== null) [text, changed] = [next, true];
        }
        if (changed) files[mcp.file] = Buffer.from(text);
      }
    }
    if (SKILL_DIRS[agent]) for (const n of gone.skills) for (const f of filesUnder(project, `${SKILL_DIRS[agent]}/${n}`)) files[f] = null;
    const sub = SUBAGENT_DIRS[agent];
    if (sub) {
      for (const n of gone.subagents) {
        const f = `${sub.dir}/${n}${sub.ext}`;
        if (readRel(f) !== null) files[f] = null;
      }
    }
  }
  return files;
}

/** 에이전트 설정 파일인가(지난 개인 출력을 정리할 때 서버가 남았으면 지우지 않는다). */
export function mcpFileOf(rel) {
  return Object.values(MCP_FILES).find(m => m.file === rel) ?? null;
}

/** 에이전트 설정 파일에 서버가 남았는가. 읽을 수 없으면 true(지우지 않는다). */
export function hasServers(abs, m) {
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return false;
  }
  if (m.toml) return mcpNames(text).size > 0;
  try {
    const v = JSON.parse(text)?.[m.json];
    return !!v && typeof v === 'object' && Object.keys(v).length > 0;
  } catch {
    return true;
  }
}
