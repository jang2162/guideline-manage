import fs from 'node:fs';
import path from 'node:path';
import { diskTree, joinPath } from './tree.js';
import { GUIDE_DIR, PROJECT_TOML, RULER_TOML } from './layout.js';
import { desiredOutputs, RULER_TOML_BASE, NESTED_TOML_BASE, isRootOnly } from './render/outputs.js';
import { setTable, tableSlice } from './toml-table.js';
import { expandBlocks } from './catalog.js';
import { withAncestors } from './blocks.js';
import { unitOf, unitName, finalUnit } from './sources.js';
import { readBlock, writeBlock } from './gitignore-block.js';
import { t } from './i18n.js';

// 조합: 커밋된 .guideline/(원본 모양 사본)에서 에이전트가 읽는 생성물(.ruler/·docs/guideline/·ruler.toml)을 만든다.
// 서버·잠금 없이 디스크만 읽는다. 예전 반영과 같은 desiredOutputs 를 써서 같은 원본이면 바이트 단위로 같은 파일이 나온다.

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lf = s => s.replace(/\r\n/g, '\n');
const GITIGNORE = '.gitignore';
const MANAGEMENT = 'management';
const OVERRIDES = 'overrides';

/**
 * 블록에서 읽은 경로 중 조합이 지워도 되는 것. 조합이 만드는 자리(.ruler/·docs/guideline/) 안의 평범한 상대 경로만 —
 * 손으로 고친 블록에 든 `../x`·프로젝트 설정이 지워지지 않게.
 */
function removable(p) {
  const segs = p.split('/');
  if (segs.some(s => s === '' || s === '.' || s === '..') || p.includes('\\')) return false;
  if (p === PROJECT_TOML) return false;
  return p.startsWith('.ruler/') || p.startsWith('docs/guideline/');
}

/** 매니페스트 출처마다 별칭을 입힌 가상 블록 키(조상 포함). */
function virtualKeys(manifest) {
  const keys = Object.keys(manifest.sources).sort(byStr)
    .flatMap(name => manifest.sources[name].items.map(id => finalUnit(id, manifest.sources[name].aliases ?? {})));
  return withAncestors(keys);
}

/**
 * render 가 받는 모양의 관리 지침 인자. 추가분은 .guideline/management/<출처>.md, 세팅 표의 출처 열은 출처가 둘 이상일 때만
 * (virtualize 와 같은 규칙). 매니페스트에 없거나 항목이 없는 출처의 사본은 넣지 않는다.
 */
function managementOf(tree, manifest) {
  const names = Object.keys(manifest.sources).sort(byStr);
  const additions = [];
  for (const e of tree.list(MANAGEMENT)) {
    if (e.dir || !e.name.endsWith('.md')) continue;
    const source = e.name.slice(0, -'.md'.length);
    if (!names.includes(source) || manifest.sources[source].items.length === 0) continue;
    additions.push({ source, text: tree.read(joinPath(MANAGEMENT, e.name)).toString('utf8') });
  }
  let stackSource = null;
  if (names.length > 1) {
    stackSource = {};
    for (const name of names) {
      const s = manifest.sources[name];
      for (const id of s.items) {
        const u = unitOf(id);
        if (u?.startsWith('rules/')) stackSource[unitName(finalUnit(u, s.aliases ?? {}))] = name;
      }
    }
  }
  return { stackSource, additions };
}

/** .guideline/overrides/<스택 경로>/override.md·override.d/*.md → .ruler/<스택 경로>/…. 경로 → 내용. */
function overrideCopies(tree) {
  const out = new Map();
  const walk = stack => {
    const base = joinPath(OVERRIDES, stack);
    for (const e of tree.list(base)) {
      if (e.name.startsWith('.')) continue;
      if (!e.dir) {
        if (stack && e.name === 'override.md') out.set(`.ruler/${stack}/override.md`, tree.read(joinPath(base, e.name)));
        continue;
      }
      if (e.name === 'override.d') {
        if (!stack) continue;
        for (const f of tree.list(joinPath(base, e.name))) {
          if (!f.dir && f.name.endsWith('.md') && !f.name.startsWith('.')) {
            out.set(`.ruler/${stack}/override.d/${f.name}`, tree.read(joinPath(base, `override.d/${f.name}`)));
          }
        }
        continue;
      }
      walk(joinPath(stack, e.name));
    }
  };
  walk('');
  return out;
}

/**
 * .guideline/ 에서 생성물을 조합한다. 디스크는 읽기만 하고, 쓸 것(바뀐 것만, null 은 지움)을 돌려준다. 잠금은 보지 않는다.
 * @param {{ project: string, manifest: import('./manifest.js').Manifest, nested?: boolean, rulerAgentsEnabled?: boolean }} opts
 *   project 는 단위 디렉터리(절대경로), manifest 는 v3(출처별 실제 id·별칭)
 * @returns {{ files: Record<string, Buffer | null>, generated: string[], todos: object[] }}
 *   generated 는 이번에 만든 경로 전부(단위 기준, 정렬). .gitignore 블록에 그대로 적힌다
 */
export function compose({ project, manifest, nested = false, rulerAgentsEnabled = false }) {
  const tree = diskTree(path.join(project, GUIDE_DIR));
  const readRel = rel => {
    try {
      return fs.readFileSync(path.join(project, ...rel.split('/')));
    } catch {
      return null;
    }
  };

  // 사본이 있는 항목만 조합한다. 막혔거나 원본에서 사라진 항목은 동기화가 지난 사본을 남겨 두므로 그것을 쓴다.
  const keys = virtualKeys(manifest).filter(k => !(nested && isRootOnly(k)));
  const items = expandBlocks(tree, keys).filter(id => tree.exists(id));
  const view = { version: 1, form: 'ruler', instructionFiles: [], agents: manifest.agents, items: keys };
  const { outputs, todos } = desiredOutputs({ tree, manifest: view, items, rulerAgentsEnabled, management: managementOf(tree, manifest) });

  const want = new Map();
  for (const o of outputs) if (o.kind === 'file') want.set(o.path, o.content);

  // ruler.toml = ruler.project.toml(없으면 기본 설정) + 고른 MCP 표. 프로젝트가 둔 같은 이름 표는 프로젝트 것이 이긴다.
  const projectRaw = readRel(PROJECT_TOML);
  const projectText = projectRaw === null ? null : lf(projectRaw.toString('utf8'));
  let toml = projectText ?? (nested ? NESTED_TOML_BASE : RULER_TOML_BASE)(manifest.agents);
  for (const o of outputs) {
    if (o.kind !== 'toml') continue;
    const r = setTable(toml, o.segs, o.entry);
    const reason = r.conflict ?? (projectText !== null && tableSlice(projectText, o.segs) !== null ? t('compose.projectTable', { file: PROJECT_TOML }) : null);
    if (reason) {
      todos.push({ kind: 'mcp-conflict', item: o.items[0] ?? null, message: t('todo.mcpConflict', { table: o.key, reason }) });
      continue;
    }
    toml = r.text;
  }
  want.set(RULER_TOML, Buffer.from(toml));

  for (const [p, c] of overrideCopies(tree)) want.set(p, c);

  const generated = [...want.keys()].sort(byStr);
  const files = {};
  for (const p of generated) {
    const cur = readRel(p);
    if (cur === null || !cur.equals(want.get(p))) files[p] = want.get(p);
  }

  // 지난 조합이 블록에 적은 것 중 이번에 만들지 않는 것을 지운다. 블록에 없는 파일(프로젝트 자체 .ruler/*.md 등)은 모른다.
  const giRaw = readRel(GITIGNORE);
  const gi = giRaw === null ? null : giRaw.toString('utf8');
  for (const line of readBlock(gi)) {
    const p = line.replace(/^\//, '');
    if (line === p || want.has(p) || !removable(p)) continue;
    let isFile = false;
    try {
      isFile = fs.statSync(path.join(project, ...p.split('/'))).isFile();
    } catch {
      isFile = false;
    }
    if (isFile) files[p] = null;
  }

  const nextGi = writeBlock(gi, generated.map(p => `/${p}`));
  if (nextGi !== (gi ?? '')) files[GITIGNORE] = Buffer.from(nextGi);
  return { files, generated, todos };
}
