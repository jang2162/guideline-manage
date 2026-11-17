import { memoryTree, joinPath } from './tree.js';
import { t } from './i18n.js';
import { blockKey, isWithin, ancestorKeys } from './blocks.js';

// 여러 출처(지침 서버)의 원본을 한 프로젝트에 합칠 때 쓰는 이름 규칙과 별칭.
// 렌더링·상태 코드는 출처 하나의 트리와 항목 id 만 안다. 그래서 출처마다 별칭을 입힌 「가상 트리」 를 만들어 합치고,
// 매니페스트·잠금을 읽고 쓸 때만 가상 id 와 `<출처>:<원래 id>` 를 오간다.

/** 출처 이름과 별칭의 규칙. 별칭은 경로 조각이 된다. */
export const NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** 단위 종류의 사용자용 이름. */
export function kindLabel(root) {
  if (root === 'rules') return t('kind.rules');
  if (root === 'skills') return t('kind.skills');
  if (root === 'agents') return t('kind.agents');
  return t('kind.mcp');
}

/**
 * 항목·경로 id 의 블록 키. 하위 스택(`rules/<스택>/<하위>`)은 그 하위 스택이다. 블록이 아니면 null.
 * 별칭은 최상위 스택에만 붙으므로 별칭 계산은 aliasUnitOf 를 쓴다.
 */
export const unitOf = blockKey;

/**
 * 항목·경로 id 가 속한 별칭 단위. 별칭은 최상위 스택·스킬·MCP·서브에이전트에만 붙는다.
 * `rules/<스택>/…`(하위 스택 포함) → `rules/<스택>`, 나머지는 blockKey.
 * @param {string} id
 * @returns {string | null}
 */
export function aliasUnitOf(id) {
  const key = blockKey(id);
  return key?.startsWith('rules/') ? key.split('/').slice(0, 2).join('/') : key;
}

/** 단위의 이름 부분. `agents/rev.md` → `rev`. */
export function unitName(unit) {
  const name = unit.slice(unit.indexOf('/') + 1);
  return unit.startsWith('agents/') ? name.slice(0, -'.md'.length) : name;
}

/**
 * 별칭을 입힌 단위.
 * @param {string} unit
 * @param {Record<string, string>} aliases
 */
export function finalUnit(unit, aliases) {
  const base = aliasUnitOf(unit) ?? unit;
  const alias = aliases[base];
  if (!alias) return unit;
  const root = unit.slice(0, unit.indexOf('/'));
  return (root === 'agents' ? `agents/${alias}.md` : `${root}/${alias}`) + unit.slice(base.length);
}

/** 항목·경로 id 의 단위 부분만 별칭으로 바꾼다. */
export function toVirtual(id, aliases) {
  const u = aliasUnitOf(id);
  if (!u || !aliases[u]) return id;
  return finalUnit(u, aliases) + id.slice(u.length);
}

/**
 * 맨 앞 frontmatter 의 `name:` 줄 값을 바꾼다. frontmatter·`name:` 이 없으면 그대로.
 * Claude Code 는 스킬 이름이 디렉터리 이름과 같기를 기대한다.
 */
export function setNameLine(text, name) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m || !/^name:.*$/m.test(m[1])) return text;
  const fm = m[1].replace(/^name:.*$/m, () => `name: ${name}`);
  const start = m[0].indexOf(m[1]);
  return m[0].slice(0, start) + fm + m[0].slice(start + m[1].length) + text.slice(m[0].length);
}

/** 트리의 모든 파일 경로. */
function allFiles(tree, dir = '') {
  const out = [];
  for (const e of tree.list(dir)) {
    const p = joinPath(dir, e.name);
    if (e.dir) out.push(...allFiles(tree, p));
    else out.push(p);
  }
  return out;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 원본 트리를 별칭을 입힌 가상 트리로. `docs/` 아래는 뺀다(출처마다 따로 다룬다).
 * 별칭 스킬의 `SKILL.md`·별칭 서브에이전트 파일은 `name:` 줄도 바꾸고,
 * 같은 출처 스택 README(하위 스택 포함)의 바꿈 표가 가리키는 `` `<스택>/ `` 도 별칭으로 바꾼다.
 * skip 에 든 최종 단위(다른 출처가 고른 것)는 뺀다 — 고르지 않은 같은 이름 단위가 합칠 때 그것을 덮지 않게.
 * @param {import('./tree.js').Tree} tree
 * @param {Record<string, string>} aliases
 * @param {Set<string>} [skip]
 */
export function sourceView(tree, aliases, skip = new Set()) {
  const stackAliases = new Map(Object.entries(aliases).filter(([k]) => k.startsWith('rules/')).map(([k, v]) => [unitName(aliasUnitOf(k)), v]));
  const stackRef = stackAliases.size ? new RegExp(`\`(${[...stackAliases.keys()].map(escape).join('|')})/`, 'g') : null;
  const files = {};
  for (const p of allFiles(tree)) {
    if (p.startsWith('docs/')) continue;
    const unit = aliasUnitOf(p);
    if (unit && skip.has(finalUnit(unit, aliases))) continue;
    let content = tree.read(p);
    const u = unit;
    const alias = u ? aliases[u] : undefined;
    if (alias && ((u.startsWith('skills/') && p === `${u}/SKILL.md`) || (u.startsWith('agents/') && p === u))) {
      content = Buffer.from(setNameLine(content.toString('utf8'), alias));
    }
    if (stackRef && /^rules\/.+\/README\.md$/.test(p)) {
      content = Buffer.from(content.toString('utf8').replace(stackRef, (_, name) => `\`${stackAliases.get(name)}/`));
    }
    files[toVirtual(p, aliases)] = content;
  }
  return memoryTree(files);
}

/**
 * 가상 트리들의 합집합. 먼저 나온 것이 이긴다(충돌은 미리 막는다).
 * @param {import('./tree.js').Tree[]} views
 */
export function mergeViews(views) {
  const files = {};
  for (const v of views) {
    for (const p of allFiles(v)) if (!Object.hasOwn(files, p)) files[p] = v.read(p);
  }
  return memoryTree(files);
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * 출처 이름순으로, 최종 단위가 같거나 한쪽이 다른 쪽 안(조상·자손 스택)인 항목을 가진 앞 출처(a)와 뒤 출처(b).
 * 같은 출처 안의 부모·자식은 충돌이 아니다. 한 출처에서 조상 스택이 이미 충돌했으면 그 아래 하위 스택은 따로 세지 않는다.
 * @param {{ name: string, items: string[], aliases: Record<string, string> }[]} sources
 * @returns {{ kind: string, final: string, unit: string, a: string, b: string }[]}
 */
export function collisions(sources) {
  const owned = [];
  const out = [];
  for (const s of [...sources].sort(byName)) {
    const units = [...new Set(s.items.map(unitOf).filter(Boolean))].sort();
    const clashed = new Set();
    for (const unit of units) {
      const final = finalUnit(unit, s.aliases ?? {});
      const prev = owned.find(o => o.final === final || (o.source !== s.name && (isWithin(final, o.final) || isWithin(o.final, final))));
      if (prev) {
        if (!ancestorKeys(unit).some(k => clashed.has(k))) {
          out.push({ kind: kindLabel(unit.slice(0, unit.indexOf('/'))), final, unit, a: prev.source, b: s.name });
        }
        clashed.add(unit);
      } else owned.push({ final, source: s.name });
    }
  }
  return out;
}

/** 충돌 하나를 사용자에게 보일 문장. 별칭은 뒤 출처에 준다. */
export function collisionMessage(c) {
  if (c.a === c.b) return t('sources.clashSame', { kind: c.kind, name: unitName(c.final), a: c.a });
  return t('sources.clash', { kind: c.kind, name: unitName(c.final), a: c.a, b: c.b, unit: c.unit, unitName: unitName(c.unit) });
}

/**
 * 원본에 없는 단위에 준 별칭, 같은 별칭을 두 단위에 준 것.
 * @param {{ name: string, aliases: Record<string, string> }} source
 * @param {import('./tree.js').Tree} tree 그 출처의 원본 트리
 */
export function aliasProblems(source, tree) {
  const out = [];
  const seen = new Set();
  for (const [k, v] of Object.entries(source.aliases ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!tree.exists(k)) out.push({ kind: 'alias', item: null, message: t('sources.aliasNoUnit', { source: source.name, key: k, value: v }) });
    if (seen.has(v)) out.push({ kind: 'alias', item: null, message: t('sources.aliasTwice', { source: source.name, key: k, value: v }) });
    seen.add(v);
  }
  return out;
}

/**
 * 가상 id 를 출처와 원래 id 로 되돌린다. 모르면 null.
 * @param {string} virtualId
 * @param {{ name: string, items?: string[], aliases?: Record<string, string> }[]} sources
 */
export function realOf(virtualId, sources) {
  const u = unitOf(virtualId);
  if (!u) return null;
  // 별칭은 최상위 단위에만 붙는다. 하위 스택·스택 자산(`rules/base/LICENSE`)은 그 최상위 단위로 별칭과 주인을 찾는다.
  const top = aliasUnitOf(virtualId);
  for (const s of sources) {
    for (const k of Object.keys(s.aliases ?? {})) {
      if (finalUnit(k, s.aliases) === top) return { source: s.name, id: k + virtualId.slice(top.length) };
    }
  }
  const plain = sources.filter(s => !(s.aliases ?? {})[top]);
  // 주인은 그 id 를 품는 가장 깊은 블록 키를 가진 출처, 없으면 같은 최상위 단위를 가진 출처.
  let owner = null;
  let depth = -1;
  for (const s of plain) {
    for (const k of s.items ?? []) {
      if (isWithin(u, k) && k.length > depth) [owner, depth] = [s, k.length];
    }
  }
  owner ??= plain.find(s => (s.items ?? []).some(i => aliasUnitOf(i) === top));
  if (owner) return { source: owner.name, id: virtualId };
  if (sources.length === 1 && plain.length === 1) return { source: plain[0].name, id: virtualId };
  return null;
}
