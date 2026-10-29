import { HttpError, readForm, redirect } from '../http.js';
import { checkOrigin, requireAdminWeb } from './auth.js';
import { html, diffBlock, pageOf, pager, PAGE_SIZE } from './layout.js';
import { sendView, catalogAt } from './frame.js';
import { groupChanges, changeTree, changeCrumb, diffCounts, pickCurrent } from './change-tree.js';
import { unifiedDiff } from '../../../cli/src/diff.js';
import { sha256 } from '../store.js';
import { readableText, proposalDiff } from '../proposals.js';
import { t } from '../../../cli/src/i18n.js';
import { markOurs, markTheirs } from '../../../cli/src/merge3.js';

const STATUS_LABEL = {
  get pending() { return t('web.proposal.pending'); },
  get accepted() { return t('web.proposal.accepted'); },
  get rejected() { return t('web.proposal.rejected'); },
};
const KIND_LABEL = {
  get add() { return t('change.add'); },
  get modify() { return t('change.modify'); },
  get delete() { return t('change.delete'); },
};
const day = iso => (iso ? iso.replace('T', ' ').slice(0, 16) : '');
const lf = s => s.replace(/\r\n/g, '\n');
const view = (ctx, status, opts) => sendView(ctx, status, { on: 'proposals', ...opts });
const kindOf = c => (c.content === null ? 'delete' : c.base === null ? 'add' : 'modify');

function proposalOf(ctx) {
  const p = /^\d+$/.test(ctx.params.id) ? ctx.proposals.get(Number(ctx.params.id)) : null;
  if (!p) throw new HttpError(404, t('proposal.notFound'));
  return p;
}

function listPage(ctx) {
  const status = ctx.url.searchParams.get('status') ?? 'pending';
  const page = pageOf(ctx.url);
  const fetched = ctx.proposals.list({ status: status === 'all' ? null : status in STATUS_LABEL ? status : 'pending', limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const rows = fetched.slice(0, PAGE_SIZE);
  const tab = (key, label) => html`<a class="${key === status ? 'tab on' : 'tab'}" href="/proposals?status=${key}">${label}</a>`;
  view(ctx, 200, {
    title: t('web.nav.proposals'),
    body: html`<nav class="tabs">${tab('pending', STATUS_LABEL.pending)}${tab('accepted', STATUS_LABEL.accepted)}${tab('rejected', STATUS_LABEL.rejected)}${tab('all', t('web.proposal.all'))}</nav>
${rows.length ? html`<div class="table-wrap"><table>
<tr><th>${t('web.proposal.colNo')}</th><th>${t('web.proposal.colTitle')}</th><th>${t('web.col.source')}</th><th>${t('web.proposal.colBy')}</th><th>${t('web.tokens.status')}</th><th>${t('web.proposal.colWhen')}</th><th>${t('web.col.file')}</th></tr>
${rows.map(r => html`<tr><td>#${r.id}</td><td><a href="/proposals/${r.id}">${r.title}</a></td><td>${r.project ?? ''}</td><td>${r.author}</td><td>${STATUS_LABEL[r.status]}</td><td>${day(r.createdAt)}</td><td>${r.changeCount}</td></tr>`)}
</table></div>` : html`<p class="meta">${t('web.proposal.none')}</p>`}
${pager(page, fetched.length > PAGE_SIZE, n => `/proposals?status=${encodeURIComponent(status)}&page=${n}`)}`,
  });
}

/** 파일 하나: 기준 대비 제안 차이, 원본이 바뀌었으면 합친 결과나 충돌. */
function changeBlock(ctx, p, c, f) {
  const pt = c.content === null ? '' : readableText(c.content);
  const pending = p.status === 'pending';
  const d = diffOf(ctx, c);
  const diff = d === null
    ? html`<p class="meta">${t('web.proposal.binary', { what: c.content === null ? t('web.change.delete') : t('web.bytes', { n: c.content.length }) })}</p>`
    : diffBlock(d);
  let state = '';
  if (c.content !== null) {
    const h = sha256(c.content);
    const was = ctx.store.lastRevisionWithHash(c.path, h);
    if (was !== null && ctx.store.headHashes().get(c.path) !== h) {
      state = html`<p class="warn">${t('web.proposal.revertsOld', { rev: was })}</p>`;
    }
  }
  if (f?.headChanged && f.result === 'merged') {
    const head = readableText(ctx.store.fileAt(c.path, ctx.store.headRevision()) ?? Buffer.alloc(0)) ?? '';
    state = html`${state}<p class="warn">${t('web.proposal.merged')}</p>${diffBlock(unifiedDiff(head, f.content.toString('utf8'), { aLabel: t('web.proposal.currentSource'), bLabel: t('web.proposal.mergedLabel') }))}`;
  } else if (f?.result === 'conflict') {
    state = html`${state}<p class="error">${t('web.proposal.conflict', { reason: f.reason })}</p>`;
  } else if (f?.result === 'same') {
    state = html`${state}<p class="meta">${t('web.proposal.alreadySame')}</p>`;
  }
  const actions = pending ? html`<div class="actions">
${pt !== null && c.content !== null ? html`<a class="button secondary" href="/proposals/${p.id}/edit?path=${encodeURIComponent(c.path)}">${t('web.proposal.edit')}</a>` : ''}
<form method="post" action="/proposals/${p.id}/drop"><input type="hidden" name="path" value="${c.path}"><button class="secondary">${t('web.proposal.drop')}</button></form>
</div>` : '';
  return html`<section class="change"><h2><code>${c.path}</code> <span class="tag">${KIND_LABEL[kindOf(c)]}</span></h2>${state}${diff}${actions}</section>`;
}

/** 제안 파일 하나의 기준 대비 차이 텍스트(바이너리면 null). */
const diffOf = (ctx, c) => proposalDiff(ctx.store, c, { aLabel: t('web.proposal.base'), bLabel: t('diff.proposal') });

/** 제안 상세: 위에 전체 수락·거절, 왼쪽에 파일 트리, 가운데에 고른 파일 하나와 그 파일의 편집·빼기. */
function detailPage(ctx, p) {
  const pl = p.status === 'pending' ? ctx.proposals.plan(p.changes) : null;
  const byPath = new Map((pl?.files ?? []).map(f => [f.path, f]));
  const blocked = pl ? pl.conflicts.length > 0 : true;
  const counts = new Map(p.changes.map(c => {
    const d = diffOf(ctx, c);
    return [c.path, d === null ? null : diffCounts(d)];
  }));
  const conflicts = new Set((pl?.files ?? []).filter(f => f.result === 'conflict').map(f => f.path));
  const total = [...counts.values()].reduce((a, n) => ({ add: a.add + (n?.add ?? 0), del: a.del + (n?.del ?? 0) }), { add: 0, del: 0 });
  const groups = groupChanges(p.changes.map(c => c.path), catalogAt(ctx.store).summary);
  const current = pickCurrent(groups, (ctx.url.searchParams.get('file') ?? '').normalize('NFC'), conflicts);
  const c = p.changes.find(x => x.path === current);
  view(ctx, 200, {
    title: t('web.proposal.titleNo', { id: p.id }),
    h1: t('web.proposal.titleFull', { id: p.id, title: p.title }),
    crumbs: [{ label: t('web.nav.proposals'), href: '/proposals' }],
    detail: { left: changeTree(groups, current, q => `/proposals/${p.id}?file=${encodeURIComponent(q)}`, counts, conflicts), right: null },
    body: html`<p class="meta">${STATUS_LABEL[p.status]} · ${p.author}${p.project ? ` · ${p.project}` : ''} · ${day(p.createdAt)}${p.revisionId ? html` · <a href="/r/${p.revisionId}">r${p.revisionId}</a>` : ''} · ${t('web.change.summary', { n: p.changes.length, add: total.add, del: total.del })}</p>
${p.description ? html`<p>${p.description}</p>` : ''}
${p.status === 'rejected' && p.note ? html`<p class="warn">${t('web.proposal.rejectedNote', { note: p.note })}</p>` : ''}
${pl && pl.conflicts.length ? html`<p class="error">${t('web.proposal.outdated')}</p>` : ''}
${p.status === 'pending' ? html`<div class="actions">
<form method="post" action="/proposals/${p.id}/accept"><button${blocked ? html` disabled` : ''}>${t('web.proposal.accept')}</button></form>
<form method="post" action="/proposals/${p.id}/reject" class="inline"><input name="note" placeholder="${t('web.proposal.rejectReason')}"><button class="danger">${t('web.proposal.reject')}</button></form>
</div>` : ''}
${c ? html`${changeCrumb(groups, current)}${changeBlock(ctx, p, c, byPath.get(c.path))}` : ''}`,
  });
}

function editPage(ctx, p, path) {
  const c = p.changes.find(x => x.path === path);
  if (!c || c.content === null) throw new HttpError(404, t('web.proposal.notEditable'));
  const f = ctx.proposals.plan([c]).files[0];
  const text = f.result === 'merged' ? f.content.toString('utf8') : f.result === 'conflict' && f.conflictText ? f.conflictText : readableText(c.content);
  if (text === null) throw new HttpError(400, t('web.proposal.binaryNoEdit'));
  view(ctx, 200, {
    title: t('web.proposal.editTitle', { id: p.id }),
    h1: t('web.proposal.editPath', { path }),
    crumbs: [{ label: t('web.nav.proposals'), href: '/proposals' }, { label: `#${p.id}`, href: `/proposals/${p.id}` }],
    body: html`<p class="meta">${t('web.proposal.editHint', { ours: markOurs(), theirs: markTheirs() })}</p>
<form method="post" action="/proposals/${p.id}/edit" class="stack">
<input type="hidden" name="path" value="${path}">
<textarea name="content" spellcheck="false">\n${text}</textarea>
<button>${t('web.save')}</button>
</form>`,
  });
}

/** /proposals 화면을 등록한다. 모두 관리자 세션. */
export function registerProposals(router) {
  router.add('GET', '/proposals', ctx => {
    if (requireAdminWeb(ctx)) listPage(ctx);
  });
  router.add('GET', '/proposals/:id', ctx => {
    if (requireAdminWeb(ctx)) detailPage(ctx, proposalOf(ctx));
  });
  router.add('GET', '/proposals/:id/edit', ctx => {
    if (requireAdminWeb(ctx)) editPage(ctx, proposalOf(ctx), (ctx.url.searchParams.get('path') ?? '').normalize('NFC'));
  });
  router.add('POST', '/proposals/:id/accept', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    await readForm(ctx.req);
    const p = proposalOf(ctx);
    ctx.proposals.accept(p.id);
    redirect(ctx.res, `/proposals/${p.id}`);
  });
  router.add('POST', '/proposals/:id/reject', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    const form = await readForm(ctx.req);
    const p = proposalOf(ctx);
    ctx.proposals.reject(p.id, (form.get('note') ?? '').trim());
    redirect(ctx.res, `/proposals/${p.id}`);
  });
  router.add('POST', '/proposals/:id/edit', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    const form = await readForm(ctx.req, 4 * 1024 * 1024);
    const p = proposalOf(ctx);
    const path = (form.get('path') ?? '').normalize('NFC');
    ctx.proposals.setChange(p.id, path, Buffer.from(lf(form.get('content') ?? '')));
    redirect(ctx.res, `/proposals/${p.id}?file=${encodeURIComponent(path)}`);
  });
  router.add('POST', '/proposals/:id/drop', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    const form = await readForm(ctx.req);
    const p = proposalOf(ctx);
    ctx.proposals.dropChange(p.id, (form.get('path') ?? '').normalize('NFC'));
    redirect(ctx.res, `/proposals/${p.id}`);
  });
}
