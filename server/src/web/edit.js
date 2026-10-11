import { HttpError, readForm, readBody, redirect, sendJson, LIMITS } from '../http.js';
import { dbTree } from '../db-tree.js';
import { ConflictError, WriteError } from '../store.js';
import { catalogSummary } from '../../../cli/src/summary.js';
import { overlayTree } from '../../../cli/src/tree.js';
import { isTextPath, writeProblems } from '../../../cli/src/store-paths.js';
import { unifiedDiff } from '../../../cli/src/diff.js';
import { checkOrigin, requireAdminWeb } from './auth.js';
import { html, hrefFor, parentOf, diffBlock } from './layout.js';
import { sendView, tabOf, crumbsFor, hereHref, catalogAt } from './frame.js';
import { blockOf, LIST_HREF, PROTECTED_DOCS } from './blocks.js';
import { TEMPLATES } from './templates.js';
import { t } from '../../../cli/src/i18n.js';

// 브라우저는 textarea 의 줄바꿈을 CRLF 로 보낸다. 웹 저장이 파일 전체를 CRLF 로 바꾸지 않게 LF 로 맞춘다.
// HTML 파서는 <textarea> 바로 뒤의 줄바꿈 하나를 버린다. 첫 줄이 빈 파일이 줄어들지 않게 editBody 가 하나를 앞에 둔다.
const lf = s => s.replace(/\r\n/g, '\n');
const nfc = s => s.normalize('NFC');
const META = { author: 'admin', source: 'web' };

/** 바뀐 내용을 얹었을 때의 경로·내용 문제와 목록 경고. */
function preview(store, p, content) {
  const changes = { [p]: content };
  const problems = writeProblems({ [p]: Buffer.from(content) }, store.headHashes().keys());
  const warnings = catalogSummary(overlayTree(dbTree(store), changes)).warnings;
  return { problems, warnings };
}

const problemText = problems => problems.map(x => (x.path ? `${x.path}: ${x.message}` : x.message)).join('\n');

/**
 * 편집·새 파일 폼.
 * @param {{ action: string, path: string, content: string, base: string, message?: string, cancel: string, isNew?: boolean,
 *   problems?: { path: string, message: string }[], warnings?: { path: string, message: string }[] | null, conflict?: string | null }} o
 */
function editBody(o) {
  const { problems = [], warnings = null, conflict = null } = o;
  return html`${problems.length ? html`<p class="error">${problemText(problems)}</p>` : ''}
${conflict !== null ? html`<div class="warn"><p>${t('web.edit.conflict')}</p>${diffBlock(conflict)}</div>` : ''}
${warnings ? (warnings.length
    ? html`<div class="warn"><p>${t('web.edit.warnings')}</p><ul>${warnings.map(w => html`<li>${w.path} — ${w.message}</li>`)}</ul></div>`
    : html`<p class="notice">${t('web.edit.noWarnings')}</p>`) : ''}
<form method="post" action="${o.action}" class="stack wide">
${o.isNew ? html`<label>${t('web.path')} <input name="path" value="${o.path}" required></label>` : ''}
<input type="hidden" name="base" value="${o.base}">
<textarea name="content" spellcheck="false">\n${o.content}</textarea>
<label>${t('web.message')} <input name="message" value="${o.message ?? ''}"></label>
<div class="row"><button name="action" value="save">${t('web.save')}</button><button class="secondary" name="action" value="preview">${t('web.preview')}</button><a href="${o.cancel}">${t('web.cancel')}</a></div>
</form>`;
}

function textOnly(p) {
  if (!isTextPath(p)) throw new HttpError(400, t('web.edit.textOnly'));
}

async function postEdit(ctx) {
  checkOrigin(ctx);
  const { store } = ctx;
  const p = nfc(ctx.params.path);
  textOnly(p);
  const form = await readForm(ctx.req, LIMITS.form);
  const content = lf(form.get('content') ?? '');
  const message = (form.get('message') ?? '').trim();
  const baseField = form.get('base') ?? 'none';
  const again = (status, extra) => sendView(ctx, status, {
    title: t('web.edit.title', { path: p }),
    tab: tabOf(p, catalogAt(store).summary),
    crumbs: crumbsFor(p, catalogAt(store)),
    body: editBody({ action: hrefFor('/edit/', p), path: p, content, base: baseField, message, cancel: hereHref(store, p), ...extra }),
  });
  if (form.get('action') === 'preview') {
    again(200, preview(store, p, content));
    return;
  }
  if (!message) {
    again(400, { problems: [{ path: '', message: t('web.needMessage') }] });
    return;
  }
  try {
    store.commit({ ...META, changes: { [p]: content }, base: { [p]: baseField === 'none' ? null : baseField }, message });
  } catch (e) {
    if (e instanceof ConflictError) {
      const current = store.fileAt(p)?.toString('utf8') ?? '';
      again(409, { conflict: unifiedDiff(current, content, { aLabel: t('web.edit.now'), bLabel: t('web.edit.mine') }), base: store.hashAt(p) ?? 'none' });
      return;
    }
    if (e instanceof WriteError) {
      again(400, { problems: e.problems });
      return;
    }
    throw e;
  }
  redirect(ctx.res, hereHref(store, p));
}

function newPage(ctx) {
  const dir = nfc(ctx.url.searchParams.get('dir') ?? '').replace(/^\/+|\/+$/g, '');
  const key = ctx.url.searchParams.get('template') ?? 'empty';
  const tpl = TEMPLATES[key] ?? TEMPLATES.empty;
  const p = tpl.file ? (dir ? `${dir}/${tpl.file}` : tpl.file) : (dir ? `${dir}/` : '');
  const links = Object.entries(TEMPLATES).map(([k, v]) => html` <a class="${k === key ? 'chip on' : 'chip'}" href="${`/new?dir=${encodeURIComponent(dir)}&template=${k}`}">${v.label}</a>`);
  sendView(ctx, 200, {
    title: t('web.newFile'),
    tab: tabOf(dir, catalogAt(ctx.store).summary),
    crumbs: crumbsFor(dir, catalogAt(ctx.store)),
    body: html`<nav class="chips" aria-label="${t('web.templates')}"><span class="meta">${t('web.templates')}</span>${links}</nav>${editBody({ action: '/new', path: p, content: tpl.content, base: 'none', cancel: hereHref(ctx.store, dir), isNew: true })}`,
  });
}

async function postNew(ctx) {
  checkOrigin(ctx);
  const { store } = ctx;
  const form = await readForm(ctx.req, LIMITS.form);
  const p = nfc((form.get('path') ?? '').trim());
  const content = lf(form.get('content') ?? '');
  const message = (form.get('message') ?? '').trim();
  const again = (status, extra) => sendView(ctx, status, {
    title: t('web.newFile'),
    tab: tabOf(parentOf(p), catalogAt(store).summary),
    body: editBody({ action: '/new', path: p, content, base: 'none', message, cancel: hereHref(store, parentOf(p)), isNew: true, ...extra }),
  });
  if (form.get('action') === 'preview') {
    again(200, preview(store, p, content));
    return;
  }
  if (!message) {
    again(400, { problems: [{ path: '', message: t('web.needMessage') }] });
    return;
  }
  try {
    store.commit({ ...META, changes: { [p]: content }, base: { [p]: null }, message });
  } catch (e) {
    if (e instanceof ConflictError) {
      again(409, { problems: [{ path: p, message: t('web.pathExists') }] });
      return;
    }
    if (e instanceof WriteError) {
      again(400, { problems: e.problems });
      return;
    }
    throw e;
  }
  redirect(ctx.res, hereHref(store, p));
}

/** 경로가 파일이면 [그 경로], 디렉터리면 그 아래 파일들. */
function filesUnder(hashes, p) {
  if (hashes.has(p)) return [p];
  return [...hashes.keys()].filter(q => q.startsWith(`${p}/`));
}

async function postDelete(ctx) {
  checkOrigin(ctx);
  const { store } = ctx;
  const p = nfc(ctx.params.path).replace(/\/+$/, '');
  const form = await readForm(ctx.req);
  const message = (form.get('message') ?? '').trim();
  if (!message) throw new HttpError(400, t('web.needMessage'));
  const hashes = store.headHashes();
  const targets = p ? filesUnder(hashes, p) : [];
  if (!targets.length) throw new HttpError(404, t('web.noPath'));
  if (targets.some(q => PROTECTED_DOCS.includes(q))) throw new HttpError(400, t('web.docs.protected'));
  const block = blockOf(p, catalogAt(store).summary);
  store.commit({
    ...META, message,
    changes: Object.fromEntries(targets.map(q => [q, null])),
    base: Object.fromEntries(targets.map(q => [q, hashes.get(q)])),
  });
  // 블록 전체를 지웠으면 그 탭 목록으로, 아니면 남은 상위(블록 상세나 설정)로.
  redirect(ctx.res, block && block.rel === '' ? LIST_HREF[block.kind] : hereHref(store, parentOf(p)));
}

async function postRename(ctx) {
  checkOrigin(ctx);
  const { store } = ctx;
  const form = await readForm(ctx.req);
  const from = nfc((form.get('from') ?? '').trim()).replace(/\/+$/, '');
  const to = nfc((form.get('to') ?? '').trim()).replace(/\/+$/, '');
  const message = (form.get('message') ?? '').trim();
  if (!message) throw new HttpError(400, t('web.needMessage'));
  if (!from || !to || from === to) throw new HttpError(400, t('web.rename.same'));
  if (to.startsWith(`${from}/`)) throw new HttpError(400, t('web.rename.intoSelf'));
  if (PROTECTED_DOCS.includes(from) || PROTECTED_DOCS.some(d => d.startsWith(`${from}/`))) throw new HttpError(400, t('web.docs.protected'));
  const hashes = store.headHashes();
  const moved = filesUnder(hashes, from).map(q => [q, to + q.slice(from.length)]);
  if (!moved.length) throw new HttpError(404, t('web.noPath'));
  if (filesUnder(hashes, to).length) throw new HttpError(409, t('web.rename.taken', { path: to }));
  const changes = {};
  const base = {};
  for (const [a, b] of moved) {
    changes[a] = null;
    changes[b] = store.fileAt(a);
    base[a] = hashes.get(a);
    base[b] = null;
  }
  store.commit({ ...META, message, changes, base });
  redirect(ctx.res, hereHref(store, to));
}

/** 브라우저 JS 가 부른다. 응답은 언제나 JSON 이다. */
async function putUpload(ctx) {
  const json = (status, body) => sendJson(ctx.res, status, body);
  if (ctx.auth?.kind !== 'admin') {
    json(401, { error: t('web.loginNeeded') });
    return;
  }
  try {
    checkOrigin(ctx);
    const p = nfc(ctx.params.path);
    const header = ctx.req.headers['x-base-hash'];
    const base = !header || header === 'none' ? null : String(header);
    let message = '';
    try {
      message = decodeURIComponent(String(ctx.req.headers['x-message'] ?? '')).trim();
    } catch {
      message = '';
    }
    if (!message) {
      json(400, { error: t('web.needMessage') });
      return;
    }
    const content = await readBody(ctx.req, LIMITS.form);
    const revision = ctx.store.commit({ ...META, message, changes: { [p]: content }, base: { [p]: base } });
    json(200, { revision });
  } catch (e) {
    if (e instanceof ConflictError) json(409, { error: t('web.upload.conflict') });
    else if (e instanceof WriteError) json(400, { error: e.message });
    else if (e instanceof HttpError) json(e.status, { error: e.message });
    else throw e;
  }
}

/** 편집, 새 파일, 삭제, 이름 바꾸기, 올리기를 등록한다. */
export function registerEdit(router) {
  router.add('GET', '/edit/*path', ctx => {
    if (!requireAdminWeb(ctx)) return;
    const p = nfc(ctx.params.path);
    textOnly(p);
    const content = ctx.store.fileAt(p);
    if (content === null) throw new HttpError(404, t('web.edit.noFile'));
    sendView(ctx, 200, {
      title: t('web.edit.title', { path: p }),
      tab: tabOf(p, catalogAt(ctx.store).summary),
      crumbs: crumbsFor(p, catalogAt(ctx.store)),
      body: editBody({ action: hrefFor('/edit/', p), path: p, content: content.toString('utf8'), base: ctx.store.hashAt(p), cancel: hereHref(ctx.store, p) }),
    });
  });
  router.add('POST', '/edit/*path', async ctx => {
    if (requireAdminWeb(ctx)) await postEdit(ctx);
  });
  router.add('GET', '/new', ctx => {
    if (requireAdminWeb(ctx)) newPage(ctx);
  });
  router.add('POST', '/new', async ctx => {
    if (requireAdminWeb(ctx)) await postNew(ctx);
  });
  router.add('POST', '/delete/*path', async ctx => {
    if (requireAdminWeb(ctx)) await postDelete(ctx);
  });
  router.add('POST', '/rename', async ctx => {
    if (requireAdminWeb(ctx)) await postRename(ctx);
  });
  router.add('PUT', '/upload/*path', putUpload);
}
