import { HttpError, sendJson, sendBody, readJson, clientIp } from './http.js';
import { requireToken, requireRead, parseRev } from './api.js';
import { tarGz } from './tar.js';
import { TokenError } from './tokens.js';
import { t } from '../../cli/src/i18n.js';

export const FORM_BODY_LIMIT = 2 * 1024 * 1024;
const MIN_CLIENT = [0, 12, 0];
const POLL_MS = 250;

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** X-Guideline-Client 가 있고 0.12.0 보다 낮으면 참. 없으면 거부하지 않는다. */
export function clientTooOld(req) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(req.headers['x-guideline-client'] ?? ''));
  if (!m) return false;
  const v = m.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (v[i] !== MIN_CLIENT[i]) return v[i] < MIN_CLIENT[i];
  return false;
}

function checkFormBody(body, head) {
  const ok = isObj(body) && Number.isInteger(body.revision) && body.revision >= 1 && body.revision <= head
    && isObj(body.project) && typeof body.project.name === 'string'
    && Array.isArray(body.items) && Array.isArray(body.overrides)
    && (body.diffs === undefined || isObj(body.diffs))
    && (body.recommend === undefined || (isObj(body.recommend) && Object.values(body.recommend).every(v => typeof v === 'string')));
  if (!ok) throw new HttpError(400, t('sync.badFormBody'));
}

const ownerOf = auth => (auth?.kind === 'token' ? auth.id : null);

/**
 * 폼 결과를 볼 수 있는가. 토큰 폼은 그 토큰만, 토큰 없이 만든 폼은 관리자나 링크 토큰(X-Form-Link)을 가진 쪽만.
 * 링크 토큰은 만든 쪽(CLI)만 안다.
 */
function owns(ctx, form) {
  const { auth } = ctx;
  if (form.tokenId !== null) return auth?.kind === 'token' && auth.id === form.tokenId;
  if (auth?.kind === 'admin') return true;
  const link = ctx.req.headers['x-form-link'];
  return typeof link === 'string' && ctx.forms.checkLink(form.id, link) !== null;
}

/** 프로젝트 반영(2a)이 쓰는 API. */
export function registerSyncApi(router, { store, tokens, forms, cliLogins, limiter, config }) {
  router.add('GET', '/api/v1/archive', ctx => {
    requireRead(ctx);
    const head = store.headRevision();
    if (head === 0) throw new HttpError(404, t('sync.empty'));
    const r = parseRev(ctx.url.searchParams.get('rev'), head);
    const files = store.pathsAt(r).map(f => ({ path: f.path, content: store.fileAt(f.path, r) }));
    sendBody(ctx.res, 200, tarGz(files, { mtime: ctx.now() }), 'application/gzip', {
      'X-Guideline-Revision': String(r), 'Cache-Control': 'no-store',
    });
  });

  router.add('DELETE', '/api/v1/tokens/self', ctx => {
    requireToken(ctx);
    if (ctx.auth.kind !== 'token') throw new HttpError(400, t('sync.notIssued'));
    tokens.revoke(ctx.auth.id);
    sendJson(ctx.res, 200, { ok: true });
  });

  // 폼은 지침을 받아 고르는 일이라 읽기와 같은 권한이다.
  router.add('POST', '/api/v1/forms', async ctx => {
    requireRead(ctx);
    if (clientTooOld(ctx.req)) throw new HttpError(426, t('sync.cliOld'));
    const body = await readJson(ctx.req, FORM_BODY_LIMIT);
    checkFormBody(body, store.headRevision());
    const f = forms.create({ tokenId: ownerOf(ctx.auth), revision: body.revision, payload: body });
    const url = new URL(`/forms/${f.id}?k=${encodeURIComponent(f.link)}`, config.publicUrl).href;
    const expiresAt = new Date(Date.parse(f.createdAt) + forms.timers.notOpenedMs).toISOString();
    sendJson(ctx.res, 201, { id: f.id, url, expiresAt });
  });

  router.add('GET', '/api/v1/forms/:id/result', async ctx => {
    requireRead(ctx);
    const wait = Math.min(30, Math.max(0, Number.parseInt(ctx.url.searchParams.get('wait') ?? '0', 10) || 0));
    let f = forms.load(ctx.params.id);
    if (!f || !owns(ctx, f)) throw new HttpError(404, t('sync.noForm'));
    const until = Date.now() + wait * 1000;
    while (f.status === 'pending' && Date.now() < until && !ctx.req.destroyed) {
      await sleep(POLL_MS);
      f = forms.load(ctx.params.id);
      // 기다리는 사이 폼이 지워졌으면(DB 를 갈아 끼우는 등) CLI 가 알아볼 수 있게 404.
      if (!f) throw new HttpError(404, t('sync.noForm'));
    }
    sendJson(ctx.res, 200, { status: f.status, ...(f.selection ? { selection: f.selection } : {}) });
  });

  router.add('POST', '/api/v1/cli/token', async ctx => {
    const ip = clientIp(ctx.req, config.trustProxy);
    const wait = limiter.blockedFor(ip);
    if (wait > 0) throw new HttpError(429, t('common.tooManyTries', { minutes: Math.ceil(wait / 60000) }));
    const body = await readJson(ctx.req);
    const r = cliLogins.redeem(body?.code, body?.verifier);
    if (!r) {
      limiter.fail(ip);
      throw new HttpError(400, t('sync.badCode'));
    }
    let issued;
    try {
      issued = tokens.issue({ name: r.name, scope: 'read' });
    } catch (e) {
      if (e instanceof TokenError) throw new HttpError(400, e.message);
      throw e;
    }
    sendJson(ctx.res, 200, { token: issued.token, name: r.name });
  });
}
