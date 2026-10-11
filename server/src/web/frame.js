// 화면 틀(상단 탭의 개수, 왼쪽 사이드바)에 쓰는 목록 정보와 그 HTML.
import { dbTree } from '../db-tree.js';
import { catalogSummary } from '../../../cli/src/summary.js';
import { frontmatter, yamlString } from '../../../cli/src/frontmatter.js';
import { firstSentence } from './markdown.js';
import { html, hrefFor, sendPage } from './layout.js';
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

const TOP = {
  rules: { tab: 'stacks', get label() { return t('web.tab.stacks'); }, href: '/' },
  skills: { tab: 'skills', get label() { return t('web.tab.skills'); }, href: '/skills' },
  agents: { tab: 'agents', get label() { return t('web.tab.agents'); }, href: '/agents' },
  mcp: { tab: 'mcp', label: 'MCP', href: '/mcp' },
};

/**
 * 저장 경로가 속한 탭과 사이드바에서 펼칠 묶음. 네 갈래 밖이면 스택 탭이다.
 * @param {string} p
 * @returns {{ tab: string, group: string | null, current: string | null }}
 */
export function whereOf(p) {
  const segs = p.split('/').filter(Boolean);
  const top = TOP[segs[0]];
  if (!top) return { tab: 'stacks', group: null, current: null };
  const group = segs[1] ? (segs[0] === 'agents' ? segs[1].replace(/\.md$/, '') : segs[1]) : null;
  return { tab: top.tab, group, current: p };
}

/**
 * 파일·디렉터리 화면의 빵부스러기(마지막 조각은 h1 이라 뺀다).
 * @param {string} p
 * @param {Catalog} cat
 * @returns {{ label: string, href: string }[]}
 */
export function crumbsOf(p, cat) {
  const segs = p.split('/').filter(Boolean);
  if (!segs.length) return [];
  const top = TOP[segs[0]];
  if (!top || segs.length === 1) return [{ label: t('web.allFiles'), href: '/d/' }, ...segs.slice(0, -1).map((s, i) => ({ label: s, href: hrefFor('/d/', segs.slice(0, i + 1).join('/')) }))];
  const out = [{ label: top.label, href: top.href }];
  for (let i = 1; i < segs.length - 1; i++) {
    const dir = segs.slice(0, i + 1).join('/');
    const href = i === 1 && segs[0] === 'rules' && cat.stacks.has(segs[1]) ? hrefFor('/s/', segs[1]) : hrefFor('/d/', dir);
    out.push({ label: segs[i], href });
  }
  return out;
}

const fileLink = (p, name, current) => (p === current
  ? html`<a class="f on" href="${hrefFor('/f/', p)}" aria-current="page">${name}</a>`
  : html`<a class="f" href="${hrefFor('/f/', p)}">${name}</a>`);

/** 사이드바 한 묶음: 이름 줄과 그 아래 파일들(펼치지 않은 묶음은 찾기 때만 보인다). */
function group({ name, href, count, open, children }) {
  return html`<li class="grp"><a class="${open ? 'it on' : 'it'}" href="${href}" title="${name}"><span class="nm">${name}</span>${count === undefined ? '' : html` <span>${count}</span>`}</a>${children.length
    ? html`<ul class="files"${open ? '' : html` hidden`}>
${children.map(c => html`<li>${c}</li>`)}</ul>` : ''}</li>`;
}

function entryLinks(dir, entries, current) {
  return entries.map(e => (e.dir
    ? html`<a class="f" href="${hrefFor('/d/', `${dir}/${e.name}`)}">${e.name}/</a>`
    : fileLink(`${dir}/${e.name}`, e.name, current)));
}

const PLACEHOLDER = {
  get stacks() { return t('web.find.stacks'); },
  get skills() { return t('web.find.skills'); },
  get agents() { return t('web.find.agents'); },
  get mcp() { return t('web.find.mcp'); },
};

/**
 * @param {Catalog} cat
 * @param {{ tab: string, group: string | null, current: string | null }} where
 * @param {boolean} admin 「새 파일」 링크를 둘지
 */
function sidebar(cat, where, admin) {
  const { tab, group: open, current } = where;
  let items;
  if (tab === 'skills') {
    items = cat.skills.map(s => group({ name: s.name, href: hrefFor('/d/', `skills/${s.name}`), open: s.name === open, children: entryLinks(`skills/${s.name}`, s.entries, current) }));
  } else if (tab === 'agents') {
    items = cat.agents.map(a => html`<li class="grp">${fileLink(`agents/${a.name}.md`, a.name, current)}</li>`);
  } else if (tab === 'mcp') {
    items = cat.mcp.map(m => group({ name: m.name, href: hrefFor('/d/', `mcp/${m.name}`), open: m.name === open, children: entryLinks(`mcp/${m.name}`, m.entries, current) }));
  } else {
    items = cat.summary.stacks.map(st => group({
      name: st.name,
      href: hrefFor('/s/', st.name),
      count: st.files.length,
      open: st.name === open,
      children: cat.stacks.get(st.name).sideFiles.map(f => fileLink(`rules/${st.name}/${f}`, f, current)),
    }));
  }
  return html`<details class="side" open><summary>${t('web.side.list')}</summary>
<div class="side-in">
<label class="side-find"><input type="search" class="side-search" placeholder="${PLACEHOLDER[tab]}" aria-label="${PLACEHOLDER[tab]}" autocomplete="off" data-side-search><kbd>/</kbd></label>
<ul class="side-list">
${items.length ? items : html`<li class="empty">${t('web.none')}</li>`}
</ul>
<p class="side-none" hidden>${t('web.side.noMatch')}</p>
<p class="side-foot"><a href="/d/">${t('web.allFiles')}</a>${admin ? html` · <a href="/new">${t('web.newFile')}</a>` : ''}</p>
</div>
</details>`;
}

/**
 * 틀에 넣을 것. where 가 null 이면 사이드바 없이(이력·토큰) 그린다.
 * @param {{ store: object }} ctx
 * @param {{ tab: string, group?: string | null, current?: string | null } | null} where
 * @param {string | null} [on] 켜진 탭 대신 켤 상단 링크(history, tokens)
 */
export function frameFor(ctx, where, on = null) {
  const cat = catalogAt(ctx.store);
  const s = cat.summary;
  const admin = isAdmin(ctx);
  return {
    counts: {
      stacks: s.stacks.length, skills: s.skills.length, agents: s.subagents.length, mcp: s.mcp.length,
      proposals: admin && ctx.proposals ? ctx.proposals.pendingCount() : 0,
    },
    on: where ? where.tab : on,
    sidebar: where ? sidebar(cat, { group: null, current: null, ...where }, admin) : null,
    admin,
    login: loginHref(ctx),
  };
}

/**
 * 틀을 씌운 화면을 보낸다.
 * @param {object} ctx
 * @param {number} status
 * @param {Parameters<typeof import('./layout.js').page>[0] & { where?: Parameters<typeof frameFor>[1], on?: string }} opts
 */
export function sendView(ctx, status, { where = null, on = null, ...opts }) {
  sendPage(ctx.res, status, { ...opts, frame: frameFor(ctx, where, on) });
}
