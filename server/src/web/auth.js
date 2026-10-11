import { HttpError, readForm, redirect, sameOrigin, clientIp } from '../http.js';
import { makeSession, safeEqual, SESSION_COOKIE, SESSION_TTL_MS } from '../session.js';
import { html, sendPage } from './layout.js';
import { t } from '../../../cli/src/i18n.js';

/** 상태를 바꾸는 웹 요청은 PUBLIC_URL 과 같은 출처에서 와야 한다. */
export function checkOrigin(ctx) {
  if (!sameOrigin(ctx.req, ctx.config.publicUrl)) {
    throw new HttpError(403, t('web.badOrigin', { origin: ctx.config.publicUrl.origin }));
  }
}

/** 관리자 세션(또는 관리자 Bearer)인가. 바꾸기는 관리자만 한다. */
export const isAdmin = ctx => ctx.auth?.kind === 'admin';

/** 이 화면으로 돌아오는 로그인 주소. */
export const loginHref = ctx => `/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`;

/** 지침 보기 화면. PUBLIC_READ 면 누구나, 아니면 관리자 세션이 없을 때 로그인으로 보내고 false. */
export function requireReadWeb(ctx) {
  return ctx.config.publicRead || requireAdminWeb(ctx);
}

/** 관리자 세션이 없으면 로그인으로 보내고 false. */
export function requireAdminWeb(ctx) {
  if (isAdmin(ctx)) return true;
  redirect(ctx.res, loginHref(ctx));
  return false;
}

/** 이 사이트 안의 경로만 next 로 받는다. */
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

function loginPage(ctx, { status = 200, error = null, next = '/' } = {}) {
  const host = ctx.req.headers.host ?? '';
  const expected = ctx.config.publicUrl;
  const hint = host && host !== expected.host
    ? html`<p class="warn">${t('web.hostMismatch', { host, expected: expected.origin })}</p>`
    : '';
  sendPage(ctx.res, status, {
    title: t('web.login'),
    nav: false,
    body: html`${hint}${error ? html`<p class="error">${error}</p>` : ''}
<form method="post" action="/login" class="stack">
<input type="hidden" name="next" value="${next}">
<label>${t('web.adminToken')} <input type="password" name="token" autocomplete="current-password" required autofocus></label>
<button>${t('web.login')}</button>
</form>
<p class="meta"><a href="/">${t('web.backHome')}</a></p>
<p class="meta">${t('web.firstTime.before')} <a href="/llms.txt">${t('web.firstTime.link')}</a> ${t('web.firstTime.after')}</p>`,
  });
}

/** /login, /logout 을 등록한다. 로그인은 관리자가 바꾸는 일을 할 때만 필요하다. */
export function registerAuth(router) {
  router.add('GET', '/login', ctx => loginPage(ctx, { next: safeNext(ctx.url.searchParams.get('next')) }));

  router.add('POST', '/login', async ctx => {
    checkOrigin(ctx);
    const ip = clientIp(ctx.req, ctx.config.trustProxy);
    const form = await readForm(ctx.req);
    const next = safeNext(form.get('next'));
    const wait = ctx.limiter.blockedFor(ip);
    if (wait > 0) {
      loginPage(ctx, { status: 429, next, error: t('common.tooManyTries', { minutes: Math.ceil(wait / 60000) }) });
      return;
    }
    if (!safeEqual(form.get('token') ?? '', ctx.config.adminToken)) {
      ctx.limiter.fail(ip);
      loginPage(ctx, { status: 401, next, error: t('web.badToken') });
      return;
    }
    ctx.limiter.reset(ip);
    const secure = ctx.config.publicUrl.protocol === 'https:' ? '; Secure' : '';
    const cookie = `${SESSION_COOKIE}=${makeSession(ctx.key, ctx.now())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
    redirect(ctx.res, next, { 'Set-Cookie': cookie });
  });

  router.add('POST', '/logout', ctx => {
    checkOrigin(ctx);
    redirect(ctx.res, '/', { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
  });
}
