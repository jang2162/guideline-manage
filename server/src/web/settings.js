// 설정: 블록에 속하지 않는 것(작성 규칙, 뼈대 스택, 목록에서 빠진 항목, 블록 밖 파일)과 원본 경고를 보고 고치는 곳.
import { HttpError } from '../http.js';
import { requireReadWeb } from './auth.js';
import { html, hrefFor } from './layout.js';
import { catalogAt, sendView } from './frame.js';
import { blockOf, viewHref } from './blocks.js';
import { fileView } from './browse.js';
import { t } from '../../../cli/src/i18n.js';

const FIRST = 'docs/authoring.md';

function settingsPage(ctx) {
  const p = (ctx.params.path ?? '').normalize('NFC').replace(/\/+$/, '');
  const { summary } = catalogAt(ctx.store);
  const head = ctx.store.headHashes();
  const outside = [...head.keys()].filter(q => !blockOf(q, summary)).sort();
  const current = p || (outside.includes(FIRST) ? FIRST : null);
  if (current !== null && !outside.includes(current)) throw new HttpError(404, t('api.noFile'));
  const view = current ? fileView(ctx, current) : null;
  const link = q => hrefFor('/settings/', q);
  const right = html`<h2>${t('web.settings.files')}</h2>
<ul class="tree">
${outside.map(q => html`<li><a${q === current ? html` class="on"` : ''} href="${link(q)}"${q === current ? html` aria-current="page"` : ''}><span>${q}</span></a></li>
`)}</ul>
${summary.ignored.length ? html`<h2>${t('web.ignored')}</h2><ul class="plain">${summary.ignored.map(i => html`<li><code>${i.path}</code> <span class="meta">${i.reason}</span></li>`)}</ul>` : ''}
${summary.warnings.length ? html`<h2>${t('web.warningsHeading')}</h2><ul class="plain">${summary.warnings.map(w => html`<li><a href="${viewHref(w.path.replace(/\/$/, ''), summary, q => head.has(q))}">${w.path}</a> <span class="meta">${w.message}</span></li>`)}</ul>` : ''}`;
  sendView(ctx, 200, {
    title: current ? `${t('web.settings.title')} · ${current}` : t('web.settings.title'),
    h1: t('web.settings.title'),
    on: 'settings',
    actions: view?.actions ?? null,
    detail: { left: null, right },
    body: html`<p class="meta">${t('web.settings.intro')}</p>${view ? view.body : ''}`,
  });
}

/** /settings 를 등록한다. 보기는 PUBLIC_READ 를 따른다. */
export function registerSettings(router) {
  router.add('GET', '/settings/*path', ctx => {
    if (requireReadWeb(ctx)) settingsPage(ctx);
  });
}
