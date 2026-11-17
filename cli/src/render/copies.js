import { readText } from '../tree.js';
import { sourceFiles } from '../inspect.js';
import { readServer, envVars } from '../mcp.js';
import { normalized } from '../hashes.js';
import { expandBlocks } from '../catalog.js';
import { copyPath, managementCopy } from '../layout.js';
import { t } from '../i18n.js';

/**
 * 새 배치(.guideline/)에 있어야 할 사본. 원본의 모양과 바이트를 그대로 둔다 — frontmatter 를 벗기거나 색인·toml 을 만드는 것은
 * apply 가 사본에서 조합한다. 디스크는 보지 않는다.
 * @param {{ tree: import('../tree.js').Tree, manifest: import('../manifest.js').Manifest, items: string[],
 *   management?: { additions?: { source: string, text: string }[] } }} opts
 *   items 는 반영할 수 있는 항목(원본에 있고 막히지 않은 것). 스택 키는 그 스택의 파일로 펼친다
 */
export function desiredCopies({ tree, items, management = {} }) {
  const outputs = [];
  const todos = [];
  // 원본에 CRLF 가 있어도 프로젝트에는 LF 로 쓴다. 디스크 쪽도 같은 규칙(normalized)으로 읽어 비교한다.
  const file = (path, content, of, extra = {}) => outputs.push({
    path, items: of, kind: 'file', content: normalized(path, Buffer.isBuffer(content) ? content : Buffer.from(content)), ...extra,
  });

  for (const id of expandBlocks(tree, items)) {
    if (id.startsWith('skills/')) {
      for (const [rel, buf] of sourceFiles(tree, id)) file(copyPath(`${id}/${rel}`), buf, [id]);
      continue;
    }
    if (id.startsWith('agents/')) {
      // 서브에이전트는 ruler 가 [agents] 를 켜야 쓴다. 사본은 켜기 전에도 두고, 켜지 않았다는 할 일은 조합(compose)이 낸다.
      file(copyPath(id), tree.read(id), [id]);
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
      const vars = envVars(def.server);
      if (vars.length) {
        todos.push({
          kind: 'env', item: id, message: t('todo.env', { name, vars: vars.join(', '), id }),
          data: { vars, readme: `${id}/README.md` },
        });
      }
      for (const [rel, buf] of sourceFiles(tree, id)) file(copyPath(`${id}/${rel}`), buf, [id]);
      continue;
    }
    // 지침 파일(규칙, SETUP)
    file(copyPath(id), tree.read(id), [id]);
  }

  for (const a of management.additions ?? []) {
    if (a.text.trim() !== '') file(managementCopy(a.source), a.text, [], { owned: true });
  }
  return { outputs, todos };
}
