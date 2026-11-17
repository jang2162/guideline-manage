import { write } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { memoryTree } from '../src/tree.js';
import { checkManifest, qualify } from '../src/manifest.js';
import { virtualize } from '../src/workspace.js';
import { expandBlocks } from '../src/catalog.js';
import { desiredOutputs, desiredPart, RULER_TOML_BASE } from '../src/render/outputs.js';
import { setTable } from '../src/toml-table.js';
import { sha256, itemHash, treeHashes } from '../src/hashes.js';

/**
 * 옛 배치(0.23 까지) 프로젝트를 디스크에 만든다: .ruler/<스택>/·docs/guideline/ 사본, ruler.toml 의 MCP 표, 매니페스트 v2(파일 id), 잠금 v2.
 * 그때의 render 가 쓰던 것과 같은 desiredOutputs 로 만든다. 잠금이 없는(0.10 이전) 프로젝트는 lock: false.
 * @returns {{ manifest: object, lock: object | null }}
 */
export function writeOldLayout(p, {
  server = 'http://x', items = ['rules/base/00-a.md', 'rules/base/01-b.md', 'rules/base/SETUP.md', 'skills/s', 'mcp/c7'],
  source = SOURCE, revision = 1, agents = ['claude'], toml = RULER_TOML_BASE(agents), rulerAgentsEnabled = false, lock: withLock = true,
  aliases = {}, only = null, v1 = false,
} = {}) {
  // v1(0.13 까지)은 출처 하나를 최상위에 적고 잠금도 출처를 붙이지 않는다
  const raw = v1
    ? { version: 1, server, form: 'ruler', instructionFiles: [], agents, items }
    : { version: 2, form: 'ruler', agents, sources: { default: { server, items, ...(Object.keys(aliases).length ? { aliases } : {}) } } };
  const manifest = checkManifest(raw);
  const tree = memoryTree(source);
  const v = virtualize({ manifest, lock: null, trees: new Map([['default', { server, revision, tree }]]) });
  // only 를 주면 그 파일 id 만 받은 프로젝트(v2 의 파일 단위 선택)
  const ids = expandBlocks(v.tree, v.view.items).filter(id => !only || only.includes(id));
  const { outputs } = desiredOutputs({ tree: v.tree, manifest: v.view, items: ids, rulerAgentsEnabled });
  let text = toml;
  const real = id => (v1 ? id : qualify('default', realId(id, aliases)));
  const lockOutputs = [];
  for (const o of outputs) {
    if (o.kind === 'file') write(p, o.path, o.content);
    else text = setTable(text, o.segs, o.entry).text;
    lockOutputs.push({ path: o.path, ...(o.key ? { key: o.key } : {}), items: o.items.map(real), hash: sha256(desiredPart(o)) });
  }
  write(p, '.ruler/ruler.toml', text);
  write(p, 'guideline.json', `${JSON.stringify(raw, null, 2)}\n`);
  if (!withLock) return { manifest, lock: null };
  const hashes = treeHashes(v.tree);
  const lock = {
    version: v1 ? 1 : 2, ...(v1 ? { revision } : { revisions: { default: revision } }),
    sources: Object.fromEntries(ids.map(id => [real(id), itemHash(hashes, id)])),
    outputs: lockOutputs,
  };
  write(p, 'guideline-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  return { manifest, lock };
}

/**
 * 옛 배치의 render 가 빈 프로젝트에 쓰던 파일(0.23 까지): 원본(가상 트리)에서 바로 만든 .ruler/·docs/guideline/ 출력과,
 * 기본 설정에 MCP 표를 얹은 .ruler/ruler.toml. 조합(compose)이 같은 바이트를 내는지 견줄 때 쓴다.
 * @returns {Record<string, Buffer>}
 */
export function oldRenderFiles({ tree, view, management = {}, rulerAgentsEnabled = false }) {
  const { outputs } = desiredOutputs({ tree, manifest: view, items: expandBlocks(tree, view.items), rulerAgentsEnabled, management });
  const files = {};
  let toml = RULER_TOML_BASE(view.agents);
  for (const o of outputs) {
    if (o.kind === 'file') files[o.path] = o.content;
    else toml = setTable(toml, o.segs, o.entry).text;
  }
  files['.ruler/ruler.toml'] = Buffer.from(toml);
  return files;
}

/** 별칭을 입힌 가상 id 를 원래 id 로(최상위 단위만). */
function realId(id, aliases) {
  for (const [k, name] of Object.entries(aliases)) {
    const kind = k.split('/')[0];
    const virtual = kind === 'agents' ? `agents/${name}.md` : `${kind}/${name}`;
    if (id === virtual || id.startsWith(`${virtual}/`)) return k + id.slice(virtual.length);
  }
  return id;
}
