import crypto from 'node:crypto';
import { HttpError, readForm, redirect } from '../http.js';
import { checkOrigin, requireAdminWeb } from './auth.js';
import { html, sendPage } from './layout.js';
import { t } from '../../../cli/src/i18n.js';

const B64URL = /^[A-Za-z0-9_-]{16,128}$/;

/** 발급 토큰 이름. 토큰 이름 규칙(영문·숫자·._-, 64자)에 맞춘다. */
export function tokenName(host) {
  const base = String(host ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40) || 'host';
  return `cli-${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/** 콜백은 이 기기(127.0.0.1·localhost)의 http 만 받는다. */
function params(get) {
  let callback;
  try {
    callback = new URL(get('callback') ?? '');
  } catch {
    throw new HttpError(400, t('web.cli.badCallback'));
  }
  if (callback.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(callback.hostname)) {
    throw new HttpError(400, t('web.cli.callbackLocal'));
  }
  const state = get('state') ?? '';
  const challenge = get('challenge') ?? '';
  if (!B64URL.test(state) || !B64URL.test(challenge)) throw new HttpError(400, t('web.cli.badState'));
  return { callback, state, challenge, name: String(get('name') ?? '').slice(0, 64) };
}

/** /cli/login 을 등록한다. */
export function registerCliLogin(router) {
  router.add('GET', '/cli/login', ctx => {
    if (!requireAdminWeb(ctx)) return;
    const p = params(k => ctx.url.searchParams.get(k));
    sendPage(ctx.res, 200, {
      title: t('web.cli.title'),
      nav: false,
      body: html`<p>${t('web.cli.ask', { name: p.name || t('web.cli.noName') })}</p>
<form method="post" action="/cli/login" class="stack">
<input type="hidden" name="callback" value="${p.callback.href}">
<input type="hidden" name="state" value="${p.state}">
<input type="hidden" name="challenge" value="${p.challenge}">
<input type="hidden" name="name" value="${p.name}">
<button>${t('web.issue')}</button>
</form>
<p class="meta">${t('web.cli.revokeHint')}</p>`,
    });
  });

  router.add('POST', '/cli/login', async ctx => {
    checkOrigin(ctx);
    if (ctx.auth?.kind !== 'admin') throw new HttpError(403, t('web.cli.needAdmin'));
    const form = await readForm(ctx.req);
    const p = params(k => form.get(k));
    const code = ctx.cliLogins.issue({ challenge: p.challenge, name: tokenName(p.name) });
    const back = new URL(p.callback.href);
    back.searchParams.set('code', code);
    back.searchParams.set('state', p.state);
    redirect(ctx.res, back.href);
  });
}
