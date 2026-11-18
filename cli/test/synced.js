import fs from 'node:fs';
import path from 'node:path';
import { write } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { memoryTree } from '../src/tree.js';
import { render } from '../src/render/index.js';
import { applyFiles } from '../src/apply.js';
import { diskReader } from '../src/project-state.js';
import { MANIFEST, LOCK, manifestText, lockText, checkManifest } from '../src/manifest.js';
import { virtualize, toRealLock } from '../src/workspace.js';
import { PROJECT_TOML } from '../src/layout.js';
import { RULER_TOML_BASE } from '../src/render/outputs.js';
import { composeUnit } from '../src/commands/sync-common.js';

/**
 * 서버 없이 받은 프로젝트를 만든다: .guideline/ 사본, 매니페스트 v3, 잠금 v3, ruler.project.toml, 조합한 생성물(.ruler/·.gitignore).
 * sources 를 주면 출처 여럿({ 이름: { items, aliases?, tree?, revision? } }), 아니면 default 출처 하나.
 * @returns {{ manifest: object, lock: object }}
 */
export function syncedProject(p, {
  server = 'http://x', items = ['rules/base'], source = SOURCE, revision = 1, agents = ['claude'], toml = RULER_TOML_BASE(agents), sources, nested = false,
} = {}) {
  fs.mkdirSync(path.join(p, '.ruler'), { recursive: true });
  const spec = sources ?? { default: { items, tree: source, revision } };
  const manifest = checkManifest({
    version: 3, form: 'ruler', agents,
    sources: Object.fromEntries(Object.entries(spec).map(([n, s]) => [n, { server: s.server ?? server, items: s.items, aliases: s.aliases ?? {} }])),
  });
  const trees = new Map(Object.entries(spec).map(([n, s]) => [n, { server: s.server ?? server, revision: s.revision ?? revision, tree: memoryTree(s.tree ?? source) }]));
  const v = virtualize({ manifest, lock: null, trees });
  const r = render({ tree: v.tree, revision: 0, manifest: v.view, lock: null, project: diskReader(p), management: v.management, nested });
  applyFiles(p, r.files);
  const lock = toRealLock({ viewLock: r.lock, sources: v.sources, revisions: Object.fromEntries([...trees].map(([n, x]) => [n, x.revision])) });
  write(p, MANIFEST, manifestText(manifest));
  write(p, LOCK, lockText(lock));
  if (toml !== null && !fs.existsSync(path.join(p, ...PROJECT_TOML.split('/')))) write(p, PROJECT_TOML, toml);
  applyFiles(p, composeUnit({ project: p, nested, manifest }).files);
  return { manifest, lock, todos: r.todos };
}
