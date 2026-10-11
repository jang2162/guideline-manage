// 리비전·제안 상세의 왼쪽: 바뀐 파일을 종류 → 블록 → 파일 트리로. 가운데에는 고른 파일 하나만 보인다.
import { html, blockLabel } from './layout.js';
import { labelOf } from './frame.js';
import { t } from '../../../cli/src/i18n.js';

const ORDER = ['stack', 'skill', 'agent', 'mcp', 'docs'];
const KIND_OF_DIR = { rules: 'stack', skills: 'skill', agents: 'agent', mcp: 'mcp' };
const KIND_LABEL = {
  stack: () => t('web.tab.stacks'),
  skill: () => t('web.tab.skills'),
  agent: () => t('web.tab.agents'),
  mcp: () => 'MCP',
  docs: () => t('web.tab.docs'),
};

/**
 * 경로의 종류·블록. 카탈로그에 없는 블록(지운 블록)도 첫 두 조각으로 정한다. 어느 블록에도 안 맞으면 문서 묶음.
 * @returns {{ kind: string, name: string | null, rel: string }}
 */
function placeOf(p) {
  const segs = p.split('/');
  const kind = KIND_OF_DIR[segs[0]];
  if (kind === 'agent') {
    if (segs.length === 2 && segs[1].endsWith('.md') && segs[1] !== 'README.md') return { kind, name: segs[1].slice(0, -'.md'.length), rel: segs[1] };
  } else if (kind && segs.length >= 3) {
    return { kind, name: segs[1], rel: segs.slice(2).join('/') };
  }
  return { kind: 'docs', name: null, rel: p };
}

/**
 * 바뀐 경로를 종류 → 블록 → 파일로 묶는다. 블록·파일은 이름순, 문서 묶음은 docs/ 먼저.
 * @param {string[]} paths
 * @param {{ labels?: Record<string, string> }} summary
 * @returns {{ kind: string, blocks: { name: string | null, label: string | null, files: { path: string, rel: string }[] }[] }[]}
 */
export function groupChanges(paths, summary) {
  const kinds = new Map();
  for (const p of paths) {
    const { kind, name, rel } = placeOf(p);
    if (!kinds.has(kind)) kinds.set(kind, new Map());
    const blocks = kinds.get(kind);
    if (!blocks.has(name)) blocks.set(name, []);
    blocks.get(name).push({ path: p, rel });
  }
  const docsFirst = (a, b) => (a.path.startsWith('docs/') === b.path.startsWith('docs/') ? a.path.localeCompare(b.path) : a.path.startsWith('docs/') ? -1 : 1);
  return ORDER.filter(k => kinds.has(k)).map(kind => ({
    kind,
    blocks: [...kinds.get(kind)]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([name, files]) => ({
        name,
        label: name === null ? null : labelOf(summary, kind, name),
        files: files.sort(kind === 'docs' ? docsFirst : (a, b) => a.rel.localeCompare(b.rel)),
      })),
  }));
}

/**
 * unified diff 의 더한·뺀 줄 수. ---/+++ 머리 줄은 세지 않는다.
 * @param {string} text
 */
export function diffCounts(text) {
  let add = 0;
  let del = 0;
  for (const l of text.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) add++;
    else if (l.startsWith('-') && !l.startsWith('---')) del++;
  }
  return { add, del };
}

/** 파일 옆 +N −M. */
const countChip = c => (c ? html`<span class="cnt">${c.add ? html`<span class="add">+${c.add}</span>` : ''}${c.del ? html`<span class="del">−${c.del}</span>` : ''}</span>` : '');

/**
 * 종류·블록은 접을 수 있는 트리, 파일은 고르는 링크.
 * @param {ReturnType<typeof groupChanges>} groups
 * @param {string} current
 * @param {(p: string) => string} hrefOf
 * @param {Map<string, { add: number, del: number }>} counts
 * @param {Set<string>} [conflicts] 충돌 표시를 붙일 경로
 */
export function changeTree(groups, current, hrefOf, counts, conflicts = new Set()) {
  const file = f => {
    const on = f.path === current;
    const cls = [on ? 'on' : '', conflicts.has(f.path) ? 'conflict' : ''].filter(Boolean).join(' ');
    return html`<li><a${cls ? html` class="${cls}"` : ''} href="${hrefOf(f.path)}" title="${f.path}"${on ? html` aria-current="page"` : ''}><span class="nm">${f.rel}</span>${countChip(counts.get(f.path))}</a></li>
`;
  };
  return html`<h2>${t('web.change.files')}</h2>
<ul class="tree change-tree">
${groups.map(g => html`<li><details open><summary>${KIND_LABEL[g.kind]()}</summary>
${g.blocks.map(b => (b.name === null
    ? html`<ul class="tree">${b.files.map(file)}</ul>`
    : html`<details open class="blk-group"><summary>${blockLabel(b.name, b.label)}</summary><ul class="tree">${b.files.map(file)}</ul></details>`))}
</details></li>
`)}</ul>`;
}

/**
 * 고른 파일의 위치 표시(「스택 › 표시 이름 ›」).
 * @param {ReturnType<typeof groupChanges>} groups
 * @param {string} current
 */
export function changeCrumb(groups, current) {
  for (const g of groups) {
    for (const b of g.blocks) {
      if (b.files.some(f => f.path === current)) {
        return html`<p class="crumbs">${KIND_LABEL[g.kind]()} › ${b.name === null ? '' : html`${blockLabel(b.name, b.label)} › `}</p>`;
      }
    }
  }
  return '';
}

/** 고를 파일: ?file= 이 바뀐 파일이면 그것, 아니면 first(먼저 볼 파일, 예: 첫 충돌) 중 트리 순서로 첫 것, 그것도 없으면 트리의 첫 파일. */
export function pickCurrent(groups, wanted, first = new Set()) {
  const all = groups.flatMap(g => g.blocks.flatMap(b => b.files.map(f => f.path)));
  return all.includes(wanted) ? wanted : all.find(p => first.has(p)) ?? all[0] ?? null;
}
