import { sendBody } from '../http.js';
import { t, currentLocale, messageKeys } from '../../../cli/src/i18n.js';
import { splitStackName } from '../../../cli/src/stack-name.js';
import { packageVersion } from '../../../cli/src/paths.js';

/** 이스케이프하지 않고 그대로 넣을 HTML. */
class Raw {
  constructor(s) {
    this.s = s;
  }

  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const raw = s => new Raw(String(s));

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ESC[c]);
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

/** 보간 값을 이스케이프하는 템플릿 태그. 결과는 Raw 라서 다른 html`` 안에 그대로 들어간다. 배열은 이어 붙인다. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Raw(out);
}

/** 경로 조각마다 인코딩한 주소. hrefFor('/raw/', 'rules/한/a.md') → '/raw/rules/%ED%95%9C/a.md' */
export function hrefFor(prefix, p) {
  return prefix + p.split('/').map(encodeURIComponent).join('/');
}

/**
 * 블록 이름. 도메인 스택(`<도구>__<도메인>`)은 도구 이름 옆에 도메인 꼬리표를 붙이고, 전체 이름은 title 로 둔다.
 * 표시 이름(label)이 있으면 그것을 제목으로, 도구 이름은 옆에 작게 둔다.
 * @param {string} name
 * @param {string | null} [label]
 */
export function blockLabel(name, label = null) {
  const { tool, domain } = splitStackName(name);
  return html`<span class="nm" title="${name}">${label || tool}</span>${label ? html`<span class="real">${tool}</span>` : ''}${domain ? html`<span class="domain">${domain}</span>` : ''}`;
}

/** 상위 디렉터리 경로. 최상위면 ''. */
export function parentOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

const TABS = [
  { key: 'docs', get label() { return t('web.tab.docs'); }, href: '/docs' },
  { key: 'stacks', get label() { return t('web.tab.stacks'); }, href: '/' },
  { key: 'skills', get label() { return t('web.tab.skills'); }, href: '/skills' },
  { key: 'agents', get label() { return t('web.tab.agents'); }, href: '/agents' },
  { key: 'mcp', label: 'MCP', href: '/mcp' },
];
// admin 인 것은 관리자에게만 보인다.
const UTILS = [
  { key: 'proposals', get label() { return t('web.nav.proposals'); }, href: '/proposals', admin: true },
  { key: 'history', get label() { return t('web.nav.history'); }, href: '/history' },
  { key: 'tokens', get label() { return t('web.tokens'); }, href: '/tokens', admin: true },
  { key: 'usage', get label() { return t('web.nav.usage'); }, href: '/usage' },
];

/**
 * 틀의 상단. counts 는 탭 키 → 개수, on 은 켜진 탭이나 이력·토큰 키.
 * 관리자가 아니면 관리자 링크 대신 login(이 화면으로 돌아오는 로그인 주소)을 건다.
 * @param {{ counts?: Record<string, number>, on?: string | null, admin?: boolean, login?: string }} frame
 */
function topBar({ counts = {}, on = null, admin = false, login = '/login' }) {
  const cur = k => (k === on ? html` aria-current="page"` : '');
  const utils = UTILS.filter(u => admin || !u.admin);
  const session = admin
    ? html`<form method="post" action="/logout"><button class="link">${t('web.logout')}</button></form>`
    : html`<a href="${login}">${t('web.login')}</a>`;
  return html`<header class="top">
<span class="ver">v${packageVersion()}</span>
<nav class="tabs" aria-label="${t('web.nav.kinds')}">${TABS.map(t => html`<a class="${t.key === on ? 'tab on' : 'tab'}" href="${t.href}"${cur(t.key)}>${t.label} <small>${counts[t.key] ?? 0}</small></a>`)}</nav>
<nav class="util">${utils.map(u => html`<a${u.key === on ? html` class="on"` : ''} href="${u.href}"${cur(u.key)}>${u.label}${u.key === 'proposals' && counts.proposals ? html` <small>${counts.proposals}</small>` : ''}</a>`)}${session}</nav>
</header>`;
}


/** 제목 줄: 빵부스러기, h1, 오른쪽 버튼. */
function headBlock({ h1, crumbs = [], actions = null }) {
  return html`<div class="head">
${crumbs.length ? html`<nav class="crumbs">${crumbs.map((c, i) => html`${i ? ' › ' : ''}<a href="${c.href}">${c.label}</a>`)}</nav>` : ''}
<div class="head-row"><h1>${h1}</h1>${actions ? html`<div class="actions">${actions}</div>` : ''}</div>
</div>`;
}

/**
 * 한 화면의 HTML. nav 가 false 면 틀 없이(로그인·오류) 그린다.
 * frame 은 상단 탭의 개수와 켜진 탭이다. frame.js 의 frameFor 가 만든다.
 * @param {{ title: string, body: unknown, nav?: boolean, h1?: string, crumbs?: { label: string, href: string }[], actions?: unknown,
 *   frame?: { counts?: Record<string, number>, on?: string | null, admin?: boolean, login?: string }, detail?: { left: unknown, right?: unknown } | null,
 *   scripts?: string[], wide?: boolean }} opts
 * detail 이 있으면 블록 상세의 3단(왼쪽 블록 목록 · 가운데 본문 · 오른쪽 파일 목록)으로 그린다.
 * @returns {string}
 */
/** 브라우저 스크립트가 쓰는 문구(web.client.*)를 JSON 으로. < 는 \u003c 로 바꿔 script 블록을 닫지 못하게 한다. */
function clientMessages() {
  const m = Object.fromEntries(messageKeys('web.client.').map(k => [k, t(k)]));
  return JSON.stringify(m).replace(/</g, '\\u003c');
}

export function page({ title, body, nav = true, h1 = title, crumbs = [], actions = null, frame = {}, detail = null, scripts = [], wide = false }) {
  const head = headBlock({ h1, crumbs, actions });
  const main = nav && detail
    ? html`<div class="${detail.left ? 'detail' : 'detail no-left'}">
${detail.left ? html`<aside class="blocks">${detail.left}</aside>` : ''}
<main>
${head}
${body}
</main>
${detail.right ? html`<aside class="files">${detail.right}</aside>` : ''}
</div>`
    : html`<main class="${nav ? 'solo' : wide ? 'bare wide' : 'bare'}">
${head}
${body}
</main>`;
  return html`<!doctype html>
<html lang="${currentLocale().lang}">
<head>
<meta charset="utf-8">
<script type="application/json" id="i18n">${raw(clientMessages())}</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/static/app.css">
<script src="/static/app.js" defer></script>
${scripts.map(src => html`<script type="module" src="${src}"></script>`)}
</head>
<body>
${nav ? topBar(frame) : ''}
${main}
</body>
</html>
`.toString();
}

export function sendPage(res, status, opts, headers = {}) {
  sendBody(res, status, page(opts), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', ...headers });
}

export function errorPage(res, status, message, headers = {}) {
  sendPage(res, status, { title: String(status), nav: false, body: html`<p class="error">${message}</p><p><a href="/">${t('web.backHome')}</a></p>` }, headers);
}

/** 목록 한 쪽의 행 수. */
export const PAGE_SIZE = 30;

// 이 위의 쪽 번호는 1쪽으로 본다. offset 이 SQLite 정수 범위를 넘으면 쿼리가 실패한다.
const MAX_PAGE = 1_000_000;

/** `?page=` 를 1 이상 MAX_PAGE 이하 정수로. 아니면 1. */
export function pageOf(url) {
  const n = Number(url.searchParams.get('page'));
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
}

/**
 * 목록 아래의 「이전」·「N쪽」·「다음」.
 * @param {number} page
 * @param {boolean} hasNext
 * @param {(n: number) => string} hrefOf
 */
export function pager(page, hasNext, hrefOf) {
  if (page === 1 && !hasNext) return '';
  return html`<nav class="pager">${page > 1 ? html`<a href="${hrefOf(page - 1)}">${t('web.pager.prev')}</a>` : ''}<span class="meta">${t('web.pager.page', { n: page })}</span>${hasNext ? html`<a href="${hrefOf(page + 1)}">${t('web.pager.next')}</a>` : ''}</nav>`;
}

/** diff 줄들을 색칠한 pre. */
const diffLines = lines => html`<pre class="diff">${lines.map(l => {
  const cls = l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : '';
  return cls ? html`<span class="${cls}">${l}</span>` : html`${l}\n`;
})}</pre>`;

/**
 * unifiedDiff 의 결과를 색칠한 블록. 빈 문자열이면 「차이 없음」.
 * limit 줄이 넘으면 앞 limit 줄만 보이고 나머지는 「나머지 N줄 보기」 로 접는다.
 */
export function diffBlock(text, { limit = 80 } = {}) {
  if (!text) return html`<p class="meta">${t('web.noDiff')}</p>`;
  const lines = text.split('\n');
  if (lines.length <= limit) return diffLines(lines);
  const rest = lines.slice(limit);
  return html`${diffLines(lines.slice(0, limit))}<details class="diff-more"><summary>${t('web.diff.more', { n: rest.length })}</summary>${diffLines(rest)}</details>`;
}
