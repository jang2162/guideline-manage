// 화면 틀(상단 탭의 개수, 왼쪽 사이드바)에 쓰는 목록 정보와 그 HTML.
import { dbTree } from '../db-tree.js';
import { catalogSummary } from '../../../cli/src/summary.js';
import { frontmatter, yamlString } from '../../../cli/src/frontmatter.js';
import { firstSentence } from './markdown.js';
import { html, hrefFor, sendPage, stackLabel } from './layout.js';
import { blockHref, blockOf, viewHref, TAB, LIST_HREF } from './blocks.js';
import { t } from '../../../cli/src/i18n.js';
import { isAdmin, loginHref } from './auth.js';

/**
 * @typedef {object} Catalog
 * @property {number} rev
 * @property {ReturnType<typeof catalogSummary>} summary
 * @property {Map<string, { intro: string, sideFiles: string[] }>} stacks 스택 이름 → README 첫 문장, 사이드바에 펼칠 파일 이름
 * @property {{ name: string, description: string, entries: { name: string, dir: boolean }[] }[]} skills
 * @property {{ name: string, description: string }[]} agents
 * @property {{ name: string, envVars: string[], build: boolean, intro: string, entries: { name: string, dir: boolean }[] }[]} mcp
 */

// 리비전은 바뀌지 않으므로 같은 리비전의 목록은 다시 계산하지 않는다. 저장소마다 마지막 하나만 둔다.
const cache = new WeakMap();

/** 최신 리비전의 목록 정보. */
export function catalogAt(store) {
  const rev = store.headRevision();
  const hit = cache.get(store);
  if (hit && hit.rev === rev) return hit;
  const tree = dbTree(store, rev);
  const summary = catalogSummary(tree);
  const text = p => tree.read(p)?.toString('utf8') ?? null;
  const description = p => {
    const raw = frontmatter(text(p) ?? '')?.description;
    return raw ? (yamlString(raw) ?? raw) : '';
  };
  const intro = p => {
    const t = text(p);
    return t === null ? '' : firstSentence(t);
  };
  const entries = dir => tree.list(dir).filter(e => !e.name.startsWith('.'));
  /** @type {Catalog} */
  const data = {
    rev,
    summary,
    stacks: new Map(summary.stacks.map(st => {
      const dir = `rules/${st.name}`;
      const extra = name => (tree.exists(`${dir}/${name}`) ? [name] : []);
      return [st.name, {
        intro: intro(`${dir}/README.md`),
        sideFiles: [...extra('README.md'), ...st.files.map(f => f.path.slice(dir.length + 1)), ...extra('SETUP.md')],
      }];
    })),
    skills: summary.skills.map(name => ({ name, description: description(`skills/${name}/SKILL.md`), entries: entries(`skills/${name}`) })),
    agents: summary.subagents.map(name => ({ name, description: description(`agents/${name}.md`) })),
    mcp: summary.mcp.map(m => ({ ...m, intro: intro(`mcp/${m.name}/README.md`), entries: entries(`mcp/${m.name}`) })),
  };
  cache.set(store, data);
  return data;
}

/** 저장 경로가 속한 탭(블록 밖이면 null). */
export function tabOf(p, summary) {
  const b = blockOf(p, summary);
  return b ? TAB[b.kind] : null;
}

/** 편집·새 파일 화면의 빵부스러기: 블록 안이면 탭 목록 › 블록, 밖이면 설정. */
export function crumbsFor(p, cat) {
  const b = blockOf(p, cat.summary);
  if (!b) return [{ label: t('web.nav.settings'), href: '/settings' }];
  const label = { stack: t('web.tab.stacks'), skill: t('web.tab.skills'), agent: t('web.tab.agents'), mcp: 'MCP' }[b.kind];
  return [{ label, href: LIST_HREF[b.kind] }, { label: b.name, href: blockHref(b.kind, b.name) }];
}

/** 지금 저장소 기준의 화면 주소(저장 직후에도 새 목록으로 판단한다). */
export const hereHref = (store, p) => {
  const head = store.headHashes();
  return viewHref(p, catalogAt(store).summary, q => head.has(q));
};

const PLACEHOLDER = {
  get stacks() { return t('web.find.stacks'); },
  get skills() { return t('web.find.skills'); },
  get agents() { return t('web.find.agents'); },
  get mcp() { return t('web.find.mcp'); },
};

/**
 * 블록 상세의 왼쪽: 같은 종류 블록 카드 목록(다른 블록으로 옮겨 가기). 지금 블록에 aria-current.
 * @param {Catalog} cat
 * @param {'stack' | 'skill' | 'agent' | 'mcp'} kind
 * @param {string | null} current
 */
export function blockList(cat, kind, current) {
  const items = kind === 'stack' ? cat.summary.stacks.map(st => ({ name: st.name, label: stackLabel(st.name), desc: cat.stacks.get(st.name).intro }))
    : kind === 'skill' ? cat.skills.map(x => ({ name: x.name, label: x.name, desc: x.description }))
      : kind === 'agent' ? cat.agents.map(x => ({ name: x.name, label: x.name, desc: x.description }))
        : cat.mcp.map(x => ({ name: x.name, label: x.name, desc: x.intro }));
  return html`<label class="side-find"><input type="search" class="side-search" placeholder="${PLACEHOLDER[TAB[kind]]}" aria-label="${PLACEHOLDER[TAB[kind]]}" autocomplete="off" data-side-search><kbd>/</kbd></label>
<ul class="side-list">
${items.map(x => html`<li><a class="${x.name === current ? 'blk on' : 'blk'}" href="${blockHref(kind, x.name)}"${x.name === current ? html` aria-current="page"` : ''}><b>${x.label}</b>${x.desc ? html`<span>${x.desc}</span>` : ''}</a></li>
`)}</ul>
<p class="side-none" hidden>${t('web.side.noMatch')}</p>`;
}

/**
 * 틀에 넣을 것: 상단 탭의 개수와 켜진 탭(또는 상단 링크).
 * @param {{ store: object }} ctx
 * @param {string | null} tab 켜진 탭(stacks, skills, agents, mcp)
 * @param {string | null} [on] 탭 대신 켤 상단 링크(history, tokens, settings, usage, proposals)
 */
export function frameFor(ctx, tab, on = null) {
  const cat = catalogAt(ctx.store);
  const s = cat.summary;
  const admin = isAdmin(ctx);
  return {
    counts: {
      stacks: s.stacks.length, skills: s.skills.length, agents: s.subagents.length, mcp: s.mcp.length,
      proposals: admin && ctx.proposals ? ctx.proposals.pendingCount() : 0,
    },
    on: tab ?? on,
    admin,
    login: loginHref(ctx),
  };
}

/**
 * 틀을 씌운 화면을 보낸다. detail 이 있으면 블록 상세의 3단으로 그린다.
 * @param {object} ctx
 * @param {number} status
 * @param {Parameters<typeof import('./layout.js').page>[0] & { tab?: string | null, where?: { tab: string } | null, on?: string }} opts
 */
export function sendView(ctx, status, { tab = null, where = null, on = null, ...opts }) {
  sendPage(ctx.res, status, { ...opts, frame: frameFor(ctx, tab ?? where?.tab ?? null, on) });
}
