import { HttpError, readForm, redirect } from '../http.js';
import { isTextPath } from '../../../cli/src/store-paths.js';
import { unifiedDiff } from '../../../cli/src/diff.js';
import { checkOrigin, requireAdminWeb, requireReadWeb, isAdmin } from './auth.js';
import { html, hrefFor, diffBlock, pageOf, pager, PAGE_SIZE } from './layout.js';
import { sendView, hereHref, catalogAt } from './frame.js';
import { groupChanges, changeTree, changeCrumb, diffCounts, pickCurrent } from './change-tree.js';
import { t } from '../../../cli/src/i18n.js';

/** 이력 쪽 화면: 사이드바 없이 상단의 「이력」 을 켠다. */
const view = (ctx, status, opts) => sendView(ctx, status, { on: 'history', ...opts });

const SOURCE = {
  get import() { return t('web.source.import'); },
  get web() { return t('web.source.web'); },
  get revert() { return t('web.source.revert'); },
  get proposal() { return t('web.source.proposal'); },
  get seed() { return t('web.source.seed'); },
};
const KIND = {
  get add() { return t('change.add'); },
  get modify() { return t('web.change.modify'); },
  get delete() { return t('web.change.delete'); },
};

const text = buf => (buf === null ? '' : buf.toString('utf8'));
const size = buf => (buf === null ? t('web.none') : t('web.bytes', { n: buf.length }));

function revisionRows(rows, { withHash = false } = {}) {
  return html`<div class="table-wrap"><table>
<tr><th>${t('web.col.revision')}</th><th>${t('web.col.time')}</th><th>${t('web.col.author')}</th><th>${t('web.col.source')}</th><th>${t('web.message')}</th><th>${withHash ? '' : t('web.col.file')}</th></tr>
${rows.map(r => html`<tr><td><a href="/r/${r.id}">r${r.id}</a></td><td>${r.createdAt.replace('T', ' ').slice(0, 19)}</td><td>${r.author}</td><td>${SOURCE[r.source] ?? r.source}</td><td>${r.message}</td><td>${withHash ? (r.hash === null ? t('web.change.delete') : '') : r.files}</td></tr>`)}
</table></div>`;
}

function parseId(value) {
  return /^\d+$/.test(value ?? '') ? Number(value) : 0;
}

/** 한 쪽의 행과 다음 쪽이 있는지. 한 행을 더 가져와 본다. */
function onePage(fetch, page) {
  const rows = fetch({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

function historyPage(ctx) {
  const page = pageOf(ctx.url);
  const { rows, hasNext } = onePage(o => ctx.store.revisions(o), page);
  view(ctx, 200, { title: t('web.nav.history'), body: html`${revisionRows(rows)}${pager(page, hasNext, n => `/history?page=${n}`)}` });
}

function fileHistoryPage(ctx) {
  const p = ctx.params.path.normalize('NFC');
  const page = pageOf(ctx.url);
  const { rows, hasNext } = onePage(o => ctx.store.fileHistory(p, o), page);
  if (!rows.length && page === 1) throw new HttpError(404, t('web.noHistory'));
  const revertForms = rows.map(r => html`<form method="post" action="/revert" class="row">
<input type="hidden" name="kind" value="file"><input type="hidden" name="path" value="${p}"><input type="hidden" name="rev" value="${r.id}">
<button class="secondary">${t('web.revertTo', { rev: r.id })}</button></form>`);
  view(ctx, 200, {
    title: t('web.historyOf', { path: p }),
    body: html`<p class="meta"><a href="${hereHref(ctx.store, p)}">${t('web.viewFile')}</a></p>${revisionRows(rows, { withHash: true })}${pager(page, hasNext, n => `${hrefFor('/history/', p)}?page=${n}`)}
${isAdmin(ctx) ? html`<details class="manage"><summary>${t('web.revert')}</summary>${revertForms}</details>` : ''}`,
  });
}

/** 리비전에서 파일 하나의 차이 텍스트(바이너리면 null). */
function changeDiff(store, id, path) {
  if (!isTextPath(path)) return null;
  return unifiedDiff(text(store.fileAt(path, id - 1)), text(store.fileAt(path, id)), { aLabel: `r${id - 1}`, bLabel: `r${id}` });
}

function changeBlock(store, id, c, diff) {
  const detail = diff !== null
    ? diffBlock(diff)
    : html`<p class="meta">${t('web.binaryChange', { from: size(store.fileAt(c.path, id - 1)), to: size(store.fileAt(c.path, id)) })}</p>`;
  const href = hereHref(store, c.path);
  return html`<section><h3>${KIND[c.kind]} ${href === '/' ? c.path : html`<a href="${href}">${c.path}</a>`} <a class="meta" href="${hrefFor('/history/', c.path)}">${t('web.nav.history')}</a></h3>${detail}</section>`;
}

/** 리비전 상세: 왼쪽에 바뀐 파일 트리, 가운데에 고른 파일 하나. */
function revisionPage(ctx) {
  const id = parseId(ctx.params.id);
  const info = ctx.store.revision(id);
  if (!info) throw new HttpError(404, t('api.noRevision'));
  const changes = ctx.store.changes(id);
  const diffs = new Map(changes.map(c => [c.path, changeDiff(ctx.store, id, c.path)]));
  const counts = new Map([...diffs].map(([p, d]) => [p, d === null ? null : diffCounts(d)]));
  const total = [...counts.values()].reduce((a, c) => ({ add: a.add + (c?.add ?? 0), del: a.del + (c?.del ?? 0) }), { add: 0, del: 0 });
  const groups = groupChanges(changes.map(c => c.path), catalogAt(ctx.store).summary);
  const current = pickCurrent(groups, (ctx.url.searchParams.get('file') ?? '').normalize('NFC'));
  const c = changes.find(x => x.path === current);
  view(ctx, 200, {
    title: `r${id}`,
    detail: { left: changeTree(groups, current, p => `/r/${id}?file=${encodeURIComponent(p)}`, counts), right: null },
    body: html`<p class="meta">${info.createdAt.replace('T', ' ').slice(0, 19)} · ${info.author} · ${SOURCE[info.source] ?? info.source} · ${t('web.change.summary', { n: changes.length, add: total.add, del: total.del })}</p>
<p>${info.message}</p>
${isAdmin(ctx) ? html`<form method="post" action="/revert" class="row"><input type="hidden" name="kind" value="revision"><input type="hidden" name="rev" value="${id}">
<button class="secondary">${t('web.revertRevision')}</button></form>` : ''}
${c ? html`${changeCrumb(groups, current)}${changeBlock(ctx.store, id, c, diffs.get(c.path))}` : ''}`,
  });
}

function confirmForm(fields, defaultMessage) {
  return html`<form method="post" action="/revert" class="stack">
${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
<input type="hidden" name="confirmed" value="1">
<label>${t('web.message')} <input name="message" placeholder="${defaultMessage}"></label>
<button>${t('web.revert')}</button>
</form>`;
}

async function postRevert(ctx) {
  checkOrigin(ctx);
  const { store } = ctx;
  const form = await readForm(ctx.req);
  const kind = form.get('kind');
  if (kind !== 'file' && kind !== 'revision') throw new HttpError(400, t('web.badRevertTarget'));
  const rev = parseId(form.get('rev'));
  if (!store.revision(rev)) throw new HttpError(404, t('api.noRevision'));
  const confirmed = form.get('confirmed') === '1';
  const message = (form.get('message') ?? '').trim() || undefined;
  const nothing = () => view(ctx, 200, { title: t('web.revert'), body: html`<p class="notice">${t('web.revertNoop')}</p><p><a href="/history">${t('web.backHistory')}</a></p>` });

  if (kind === 'file') {
    const p = (form.get('path') ?? '').normalize('NFC');
    if (!p) throw new HttpError(400, t('web.noPathGiven'));
    if (confirmed) {
      const id = store.revertFile(p, rev, { author: 'admin', message });
      if (id === null) nothing();
      else redirect(ctx.res, `/r/${id}`);
      return;
    }
    const target = store.fileAt(p, rev);
    const current = store.fileAt(p);
    const detail = isTextPath(p)
      ? diffBlock(unifiedDiff(text(current), text(target), { aLabel: t('web.edit.now'), bLabel: `r${rev}` }))
      : html`<p class="meta">${t('web.binaryChange', { from: size(current), to: size(target) })}</p>`;
    view(ctx, 200, {
      title: t('store.revertFile', { path: p, rev }),
      body: html`${target === null ? html`<p class="warn">${t('web.revertDeletes', { rev })}</p>` : ''}${detail}
${confirmForm({ kind, path: p, rev }, t('store.revertFile', { path: p, rev }))}`,
    });
    return;
  }

  if (confirmed) {
    const id = store.revertRevision(rev, { author: 'admin', message });
    if (id === null) nothing();
    else redirect(ctx.res, `/r/${id}`);
    return;
  }
  const plan = store.revertPlan(rev);
  view(ctx, 200, {
    title: t('store.revertRevision', { rev }),
    body: html`<ul>${Object.entries(plan.changes).map(([p, c]) => html`<li>${p} — ${c === null ? t('web.revertPlanDelete') : t('web.revertPlanTo', { rev: rev - 1 })}</li>`)}</ul>
${plan.laterTouched.length ? html`<div class="warn"><p>${t('web.revertLater')}</p><ul>${plan.laterTouched.map(p => html`<li>${p}</li>`)}</ul></div>` : ''}
${confirmForm({ kind, rev }, t('store.revertRevision', { rev }))}`,
  });
}

/** 이력, 리비전, 되돌리기를 등록한다. 보기는 requireReadWeb, 되돌리기는 관리자만. */
export function registerHistory(router) {
  router.add('GET', '/history', ctx => {
    if (requireReadWeb(ctx)) historyPage(ctx);
  });
  router.add('GET', '/history/*path', ctx => {
    if (requireReadWeb(ctx)) fileHistoryPage(ctx);
  });
  router.add('GET', '/r/:id', ctx => {
    if (requireReadWeb(ctx)) revisionPage(ctx);
  });
  router.add('POST', '/revert', async ctx => {
    if (requireAdminWeb(ctx)) await postRevert(ctx);
  });
}
