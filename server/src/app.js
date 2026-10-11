import { createRouter, HttpError, sendJson, SECURITY_HEADERS, parseCookies } from './http.js';
import { createStore, ConflictError, WriteError } from './store.js';
import { createTokens } from './tokens.js';
import { sessionKey, checkSession, safeEqual, SESSION_COOKIE } from './session.js';
import { createLoginLimiter } from './rate-limit.js';
import { registerApi } from './api.js';
import { createForms } from './forms.js';
import { createCliLogins } from './cli-login.js';
import { registerSyncApi } from './sync-api.js';
import { createProposals, ProposalError } from './proposals.js';
import { registerProposalsApi } from './proposals-api.js';
import { registerAuth } from './web/auth.js';
import { registerBrowse } from './web/browse.js';
import { registerEdit } from './web/edit.js';
import { registerAdd } from './web/add.js';
import { registerDocs } from './web/docs.js';
import { registerBlockSettings } from './web/block-settings.js';
import { registerHistory } from './web/history.js';
import { registerTokens } from './web/tokens.js';
import { registerCliLogin } from './web/cli-login.js';
import { registerForms } from './web/forms.js';
import { registerProposals } from './web/proposals.js';
import { errorPage } from './web/layout.js';
import { t } from '../../cli/src/i18n.js';

/** 웹 경로의 오류 응답. */
function webError(res, status, message, headers = {}) {
  errorPage(res, status, message, headers);
}

/**
 * 라우터에 API 와 웹 화면을 등록하고 요청 처리기를 만든다.
 * @param {{ config: import('./config.js').Config, db: import('node:sqlite').DatabaseSync,
 *   now?: () => Date, log?: (line: string) => void }} opts
 */
export function createApp({ config, db, now = () => new Date(), log = line => console.log(line), formTimers }) {
  const store = createStore(db, { now });
  const tokens = createTokens(db, { now });
  const forms = createForms(db, { now, ...(formTimers ? { timers: formTimers } : {}) });
  const proposals = createProposals(db, store, { now });
  const cliLogins = createCliLogins({ now: () => now().getTime() });
  const limiter = createLoginLimiter({ now: () => now().getTime() });
  const key = sessionKey(config.adminToken);
  const router = createRouter();
  const deps = { config, store, tokens, forms, cliLogins, proposals, limiter, key, now };
  registerApi(router, deps);
  registerSyncApi(router, deps);
  registerProposalsApi(router, deps);
  registerAuth(router);
  registerBrowse(router);
  registerEdit(router);
  registerAdd(router);
  registerBlockSettings(router);
  registerDocs(router);
  registerHistory(router);
  registerTokens(router);
  registerCliLogin(router);
  registerForms(router);
  registerProposals(router);

  /** Bearer 토큰(관리자 토큰·발급 토큰) 또는 관리자 세션 쿠키. 틀린·폐기한 Bearer 는 badToken. */
  function authenticate(req) {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      if (safeEqual(token, config.adminToken)) return { kind: 'admin', via: 'bearer' };
      const t = tokens.verify(token);
      return t ? { kind: 'token', ...t } : { badToken: true };
    }
    const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (cookie && checkSession(key, cookie, now())) return { kind: 'admin', via: 'session' };
    return null;
  }

  function fail(ctx, e) {
    const { res } = ctx;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    let status = 500;
    let message = t('web.serverError');
    let headers = {};
    let extra = {};
    if (e instanceof HttpError) {
      ({ status, message, headers } = e);
    } else if (e instanceof WriteError) {
      status = 400;
      message = e.message;
      extra = { problems: e.problems };
    } else if (e instanceof ConflictError) {
      status = 409;
      message = e.message;
      extra = { paths: e.paths };
    } else if (e instanceof ProposalError) {
      status = e.status;
      message = e.message;
      extra = e.extra;
    } else {
      console.error(e);
    }
    if (ctx.isApi) sendJson(res, status, { error: message, ...extra }, headers);
    else webError(res, status, message, headers);
  }

  async function handler(req, res) {
    const started = Date.now();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      url = new URL('http://localhost/');
    }
    res.on('finish', () => log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));
    const isApi = url.pathname.startsWith('/api/') || /^\/forms\/[^/]+\/(data|diff|ping|submit|cancel)$/.test(url.pathname);
    const ctx = { req, res, url, params: {}, auth: null, badToken: false, isApi, ...deps };
    try {
      const m = router.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, t('web.notFound'));
      if (m.allowed) throw new HttpError(405, t('web.methodNotAllowed'), { Allow: m.allowed.join(', ') });
      ctx.params = m.params;
      const auth = authenticate(req);
      ctx.badToken = auth?.badToken === true;
      ctx.auth = ctx.badToken ? null : auth;
      await m.handler(ctx);
    } catch (e) {
      fail(ctx, e);
    }
  }

  return { handler, store, tokens, proposals, router, deps };
}
