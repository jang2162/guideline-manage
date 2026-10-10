import { HttpError, readForm, redirect } from '../http.js';
import { TokenError } from '../tokens.js';
import { checkOrigin, requireAdminWeb } from './auth.js';
import { html } from './layout.js';
import { sendView } from './frame.js';
import { t } from '../../../cli/src/i18n.js';

/** 토큰 화면: 사이드바 없이 상단의 「토큰」 을 켠다. */
const view = (ctx, status, opts) => sendView(ctx, status, { on: 'tokens', ...opts });

const day = iso => (iso ? iso.replace('T', ' ').slice(0, 16) : '');

function tokensPage(ctx, { status = 200, error = null } = {}) {
  const rows = ctx.tokens.list();
  view(ctx, status, {
    title: t('web.tokens'),
    body: html`${error ? html`<p class="error">${error}</p>` : ''}
<p class="meta">${t('web.tokens.intro')}</p>
<div class="table-wrap"><table>
<tr><th>${t('web.tokens.name')}</th><th>${t('web.tokens.scope')}</th><th>${t('web.tokens.created')}</th><th>${t('web.tokens.lastUsed')}</th><th>${t('web.tokens.status')}</th></tr>
${rows.map(r => html`<tr><td>${r.name}</td><td>${r.scope}</td><td>${day(r.createdAt)}</td><td>${day(r.lastUsedAt)}</td><td>${r.revokedAt
    ? t('web.tokens.revokedOn', { day: day(r.revokedAt) })
    : html`<form method="post" action="/tokens/${r.id}/revoke" data-confirm="${t('web.tokens.confirmRevoke', { name: r.name })}"><button class="danger">${t('web.tokens.revoke')}</button></form>`}</td></tr>`)}
</table></div>
<h2>${t('web.tokens.issueHeading')}</h2>
<form method="post" action="/tokens" class="stack">
<label>${t('web.tokens.nameLabel')} <input name="name" required pattern="[A-Za-z0-9._\\-]{1,64}"></label>
<label>${t('web.tokens.scope')} <select name="scope"><option value="propose">propose</option><option value="read">read</option></select></label>
<button>${t('web.issue')}</button>
</form>`,
  });
}

/** 토큰 목록, 발급, 폐기를 등록한다. */
export function registerTokens(router) {
  router.add('GET', '/tokens', ctx => {
    if (requireAdminWeb(ctx)) tokensPage(ctx);
  });
  router.add('POST', '/tokens', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    const form = await readForm(ctx.req);
    let issued;
    try {
      issued = ctx.tokens.issue({ name: (form.get('name') ?? '').trim(), scope: form.get('scope') ?? '' });
    } catch (e) {
      if (e instanceof TokenError) {
        tokensPage(ctx, { status: 400, error: e.message });
        return;
      }
      throw e;
    }
    view(ctx, 200, {
      title: t('web.tokens.issued'),
      body: html`<p class="warn">${t('web.tokens.copyNow')}</p>
<p class="token"><code>${issued.token}</code></p>
<p><a href="/tokens">${t('web.tokens.back')}</a></p>`,
    });
  });
  router.add('POST', '/tokens/:id/revoke', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    if (!/^\d+$/.test(ctx.params.id)) throw new HttpError(404, t('web.tokens.notFound'));
    ctx.tokens.revoke(Number(ctx.params.id));
    redirect(ctx.res, '/tokens');
  });
}
