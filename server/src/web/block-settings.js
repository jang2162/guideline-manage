// 블록 설정 페이지: 블록 하나의 표시 이름·분류, 파일 더하기, 이름 바꾸기·삭제. 관리자만 연다.
// 이름 바꾸기는 frontmatter 의 name: 줄도 같이 고쳐, 웹으로 바꾼 블록이 목록에서 빠지지 않게 한다.
import { HttpError, readForm, redirect } from '../http.js';
import { WriteError, ConflictError } from '../store.js';
import { checkOrigin, requireAdminWeb } from './auth.js';
import { html } from './layout.js';
import { catalogAt, sendView, labelOf } from './frame.js';
import { KINDS, TAB, LIST_HREF, namesOf, blockDir, blockHref, metaFile, settingsHref } from './blocks.js';
import { NAME, DOMAIN } from './add.js';
import { frontmatter, setFrontmatterValue, categoriesValue, readQuoted } from '../../../cli/src/frontmatter.js';
import { parseCategories } from '../../../cli/src/categories.js';
import { splitStackName } from '../../../cli/src/stack-name.js';
import { t } from '../../../cli/src/i18n.js';

const META = { author: 'admin', source: 'web' };

/** 블록의 저장 파일들(서브에이전트는 파일 하나). */
function filesOf(hashes, kind, name) {
  if (kind === 'agent') return hashes.has(metaFile(kind, name)) ? [metaFile(kind, name)] : [];
  const prefix = `${blockDir(kind, name)}/`;
  return [...hashes.keys()].filter(p => p.startsWith(prefix));
}

function blockOrThrow(ctx) {
  const kind = ctx.params.kind;
  const name = ctx.params.name.normalize('NFC');
  if (!KINDS.includes(kind)) throw new HttpError(404, t('web.noBlock'));
  if (!namesOf(catalogAt(ctx.store).summary, kind).includes(name)) throw new HttpError(404, t('web.noBlock'));
  return { kind, name };
}

function settingsPage(ctx, { kind, name }, { status = 200, error = null } = {}) {
  const store = ctx.store;
  const metaPath = metaFile(kind, name);
  const fm = frontmatter(store.fileAt(metaPath)?.toString('utf8') ?? '') ?? {};
  const label = fm.label ? (readQuoted(fm.label) ?? fm.label) : '';
  const cats = fm.categories ? (parseCategories(fm.categories).categories ?? []).join(', ') : '';
  const dir = blockDir(kind, name);
  const { tool, domain } = splitStackName(name);
  const hashes = JSON.stringify(Object.fromEntries(filesOf(store.headHashes(), kind, name).filter(p => !p.slice(dir.length + 1).includes('/')).map(p => [p.slice(dir.length + 1), store.hashAt(p)])));
  const kindLabel = t(`web.add.kind.${kind}`);
  sendView(ctx, status, {
    title: t('web.blockSettings.title', { kind: kindLabel, name }),
    h1: t('web.blockSettings.title', { kind: kindLabel, name: labelOf(catalogAt(store).summary, kind, name) ?? name }),
    crumbs: [{ label: kindLabel, href: LIST_HREF[kind] }, { label: name, href: blockHref(kind, name) }],
    tab: TAB[kind],
    body: html`${error ? html`<p class="error">${error}</p>` : ''}
<section class="panel">
<h2>${t('web.blockSettings.basic')}</h2>
<form method="post" class="stack">
<input type="hidden" name="action" value="meta">
<label>${t('web.add.label')} <input name="label" value="${label}"></label>
<label>${t('web.add.categories')} <input name="categories" value="${cats}"></label>
<label>${t('web.message')} <input name="message" required></label>
<button>${t('web.save')}</button>
<p class="meta">${t('web.blockSettings.metaHint', { path: metaPath })}</p>
</form>
</section>
${kind === 'agent' ? '' : html`<section class="panel">
<h2>${t('web.files')}</h2>
<p><a class="button secondary" href="${`/new?dir=${encodeURIComponent(dir)}`}">${t('web.newFile')}</a></p>
<form class="stack upload" data-upload="${dir}" data-hashes="${hashes}">
<label>${t('web.upload.file')} <input type="file" name="file" required></label>
<label>${t('web.message')} <input name="message" required></label>
<button>${t('web.upload.button')}</button>
<p class="upload-status" aria-live="polite"></p>
</form>
<p class="meta">${t('web.blockSettings.filesHint')}</p>
</section>`}
<section class="panel danger-zone">
<h2>${t('web.blockSettings.danger')}</h2>
<form method="post" class="stack">
<input type="hidden" name="action" value="rename">
<label>${t('web.add.name')} <input name="name" value="${kind === 'stack' ? tool : name}" required pattern="[a-z][a-z0-9\\-]{0,63}"></label>
${kind === 'stack' ? html`<label>${t('web.add.domain')} <input name="domain" value="${domain ?? ''}" placeholder="gitlab.example.com"></label>` : ''}
<label>${t('web.message')} <input name="message" required></label>
<button class="secondary">${t('web.blockSettings.rename')}</button>
<p class="meta">${t('web.blockSettings.renameHint')}</p>
</form>
<form method="post" class="stack" data-confirm="${t('web.confirmDeleteDir', { path: kind === 'agent' ? metaFile(kind, name) : dir })}">
<input type="hidden" name="action" value="delete">
<label>${t('web.message')} <input name="message" required></label>
<button class="danger">${t('web.blockSettings.delete')}</button>
</form>
</section>`,
  });
}

/** 표시 이름·분류를 frontmatter 파일에 쓴다. 파일이 없으면(README 없는 MCP 등) 만든다. */
function saveMeta(ctx, { kind, name }, form, message) {
  const p = metaFile(kind, name);
  const before = ctx.store.fileAt(p);
  const cats = (form.get('categories') ?? '').split(',').map(c => c.trim()).filter(Boolean);
  let text = before?.toString('utf8') ?? '';
  text = setFrontmatterValue(text, 'label', (form.get('label') ?? '').trim() || null);
  text = setFrontmatterValue(text, 'categories', cats.length ? categoriesValue([...new Set(cats)]) : null, { raw: true });
  if (before !== null && text === before.toString('utf8')) return settingsHref(kind, name);
  ctx.store.commit({ ...META, message, changes: { [p]: text }, base: { [p]: ctx.store.headHashes().get(p) ?? null } });
  return settingsHref(kind, name);
}

/** 블록을 새 이름으로 옮긴다. 스킬 SKILL.md 와 서브에이전트 파일의 name: 줄도 새 이름으로. */
function rename(ctx, { kind, name }, form, message) {
  const base = (form.get('name') ?? '').trim();
  const domain = kind === 'stack' ? (form.get('domain') ?? '').trim() : '';
  if (!NAME.test(base)) throw new HttpError(400, t('web.add.badName'));
  if (domain && !DOMAIN.test(domain)) throw new HttpError(400, t('web.add.badDomain'));
  const to = domain ? `${base}__${domain}` : base;
  if (to === name) return settingsHref(kind, name);
  const hashes = ctx.store.headHashes();
  if (filesOf(hashes, kind, to).length) throw new HttpError(409, t('web.add.exists'));
  const from = kind === 'agent' ? metaFile(kind, name) : `${blockDir(kind, name)}/`;
  const dest = kind === 'agent' ? metaFile(kind, to) : `${blockDir(kind, to)}/`;
  const changes = {};
  const baseHashes = {};
  for (const p of filesOf(hashes, kind, name)) {
    const q = dest + p.slice(from.length);
    let content = ctx.store.fileAt(p);
    if ((kind === 'agent' || kind === 'skill') && q === metaFile(kind, to)) {
      const text = content.toString('utf8');
      if (frontmatter(text)?.name !== undefined) content = setFrontmatterValue(text, 'name', to);
    }
    changes[p] = null;
    changes[q] = content;
    baseHashes[p] = hashes.get(p);
    baseHashes[q] = null;
  }
  ctx.store.commit({ ...META, message, changes, base: baseHashes });
  return settingsHref(kind, to);
}

function remove(ctx, { kind, name }, message) {
  const hashes = ctx.store.headHashes();
  const files = filesOf(hashes, kind, name);
  ctx.store.commit({
    ...META, message,
    changes: Object.fromEntries(files.map(p => [p, null])),
    base: Object.fromEntries(files.map(p => [p, hashes.get(p)])),
  });
  return LIST_HREF[kind];
}

const ACTIONS = { meta: saveMeta, rename, delete: (ctx, b, form, message) => remove(ctx, b, message) };

/** /settings/<종류>/<이름> 을 등록한다. 관리자만. */
export function registerBlockSettings(router) {
  router.add('GET', '/settings/:kind/:name', ctx => {
    if (requireAdminWeb(ctx)) settingsPage(ctx, blockOrThrow(ctx));
  });
  router.add('POST', '/settings/:kind/:name', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    const block = blockOrThrow(ctx);
    const form = await readForm(ctx.req);
    const action = ACTIONS[form.get('action') ?? ''];
    if (!action) throw new HttpError(400, t('web.blockSettings.badAction'));
    const message = (form.get('message') ?? '').trim();
    if (!message) throw new HttpError(400, t('web.needMessage'));
    try {
      redirect(ctx.res, action(ctx, block, form, message));
    } catch (e) {
      if (e instanceof WriteError || e instanceof ConflictError) {
        settingsPage(ctx, block, { status: e instanceof ConflictError ? 409 : 400, error: e.message });
        return;
      }
      throw e;
    }
  });
}
