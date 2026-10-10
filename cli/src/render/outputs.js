import { readText } from '../tree.js';
import { readTier } from '../tiers.js';
import { stripFrontmatter, sourceFiles } from '../inspect.js';
import { readServer, envVars } from '../mcp.js';
import { tableText, tomlKey } from '../toml-table.js';
import { normalized } from '../hashes.js';
import { indexText, managementText, docsReadme } from './text.js';
import { codexEntry, needsAgentTables } from './mcp.js';
import { t } from '../i18n.js';

const RULE = /^rules\/([^/]+)\/(\d{2}-[a-z0-9][a-z0-9-]*\.md)$/;
const SETUP = /^rules\/([^/]+)\/SETUP\.md$/;
const lf = s => s.replace(/\r\n/g, '\n');
const agentsList = agents => `[${[...agents].sort().map(a => JSON.stringify(a)).join(', ')}]`;

/** 새 ruler 프로젝트(git 루트)의 `.ruler/ruler.toml` 첫 내용. */
export const RULER_TOML_BASE = agents => `default_agents = ${agentsList(agents)}\nnested = false\n\n[gitignore]\nenabled = true\n`;

/** 중첩 단위의 `.ruler/ruler.toml` 첫 내용. nested·gitignore 는 루트의 설정이라 되풀이하지 않는다. */
export const NESTED_TOML_BASE = agents => `default_agents = ${agentsList(agents)}\n`;

export const ROOT_ONLY_REASON = () => t('render.rootOnly');

/** git 루트 단위에서만 받는 항목(스킬, 서브에이전트, MCP)인가. */
export const isRootOnly = id => id.startsWith('skills/') || id.startsWith('agents/') || id.startsWith('mcp/');

/** 출력 하나의 바라는 글자(TOML 이면 그 표). */
export function desiredPart(d) {
  return d.kind === 'file' ? d.content : Buffer.from(tableText(d.segs, d.entry));
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * 원본과 매니페스트로 프로젝트(단위 디렉터리)에 있어야 할 출력. 디스크는 보지 않는다.
 * @param {{ tree: import('../tree.js').Tree, manifest: import('../manifest.js').Manifest, items: string[],
 *   rulerAgentsEnabled?: boolean }} opts items 는 반영할 수 있는 항목(원본에 있고 막히지 않은 것)
 */
export function desiredOutputs({ tree, manifest, items, rulerAgentsEnabled = false, management = {} }) {
  const outputs = [];
  const todos = [];
  // 원본에 CRLF 가 있어도 프로젝트에는 LF 로 쓴다. 디스크 쪽도 같은 규칙(normalized)으로 읽어 비교한다.
  const file = (path, content, of, extra = {}) => outputs.push({
    path, items: of, kind: 'file', content: normalized(path, Buffer.isBuffer(content) ? content : Buffer.from(content)), ...extra,
  });
  const stacks = new Map();
  const stack = s => {
    if (!stacks.has(s)) stacks.set(s, { refs: [], setup: false });
    return stacks.get(s);
  };

  for (const id of [...items].sort()) {
    let m = RULE.exec(id);
    if (m) {
      const src = readText(tree, id);
      const body = stripFrontmatter(src);
      if (readTier(src).load === 'always') file(`.ruler/${m[1]}/${m[2]}`, body, [id], { adopt: true });
      else {
        const p = `docs/guideline/${m[1]}/${m[2]}`;
        file(p, body, [id], { adopt: true });
        stack(m[1]).refs.push({ when: readTier(src).when, path: p });
      }
      continue;
    }
    m = SETUP.exec(id);
    if (m) {
      file(`docs/guideline/${m[1]}/SETUP.md`, lf(readText(tree, id)), [id], { adopt: true });
      stack(m[1]).setup = true;
      continue;
    }
    if (id.startsWith('skills/')) {
      const name = id.slice('skills/'.length);
      for (const [rel, buf] of sourceFiles(tree, id)) file(`.ruler/skills/${name}/${rel}`, buf, [id]);
      continue;
    }
    if (id.startsWith('agents/')) {
      const name = id.slice('agents/'.length, -'.md'.length);
      if (rulerAgentsEnabled) file(`.ruler/agents/${name}.md`, lf(readText(tree, id)), [id]);
      else {
        todos.push({
          kind: 'subagents-off', item: id,
          message: t('todo.agentsDisabled', { name }),
        });
      }
      continue;
    }
    if (id.startsWith('mcp/')) {
      const name = id.slice('mcp/'.length);
      const def = readServer(tree, id);
      if (def.build) {
        // 에이전트가 서버에 따로 묻지 않고 그 절을 읽게 README 원문을 담는다.
        todos.push({
          kind: 'mcp-build', item: id, message: t('todo.mcpBuild', { name }),
          data: { readme: `${id}/README.md`, text: readText(tree, `${id}/README.md`) },
        });
        continue;
      }
      if (!def.server) {
        todos.push({ kind: 'blocked', item: id, message: t('todo.blocked', { item: id, reason: def.reason }) });
        continue;
      }
      const server = def.server;
      const vars = envVars(server);
      if (vars.length) {
        todos.push({
          kind: 'env', item: id, message: t('todo.env', { name, vars: vars.join(', '), id }),
          data: { vars, readme: `${id}/README.md` },
        });
      }
      const toml = (segs, entry) => outputs.push({ path: '.ruler/ruler.toml', key: segs.map(tomlKey).join('.'), items: [id], kind: 'toml', segs, entry });
      if (needsAgentTables(server)) {
        for (const a of [...manifest.agents].sort()) toml(['agents', a, 'mcp_servers', name], a === 'codex' ? codexEntry(server) : { ...server });
      } else toml(['mcp_servers', name], { ...server });
    }
  }

  const names = [...stacks.keys()].sort();
  for (const n of names) {
    const s = stacks.get(n);
    if (s.refs.length) file(`.ruler/${n}/99-reference.md`, indexText(n, [...s.refs].sort(byPath)), [], { owned: true });
  }
  file('.ruler/guideline.md', managementText({ ...management, setupStacks: names.filter(n => stacks.get(n).setup) }), [], { owned: true });
  if (outputs.some(o => o.path.startsWith('docs/guideline/'))) file('docs/guideline/README.md', docsReadme(), [], { owned: true });
  return { outputs, todos };
}
