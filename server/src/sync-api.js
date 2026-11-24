import { HttpError, sendJson, sendBody, readJson, clientIp } from './http.js';
import { requireToken, requireRead, parseRev } from './api.js';
import { tarGz } from './tar.js';
import { TokenError } from './tokens.js';
import { t } from '../../cli/src/i18n.js';
import { isBlockKey } from '../../cli/src/blocks.js';

export const FORM_BODY_LIMIT = 2 * 1024 * 1024;
const MIN_CLIENT = [0, 12, 0];
/**
 * 폼 본문·응답의 모양 판. 2 는 스택 단위로 고르는 폼(하위 스택)이다. CLI 는 이 값을 본문에 싣고(0.24.0 부터),
 * 응답에 이 값이 없으면 옛 서버로 보고 멈춘다. 이 값이 없는 옛 CLI 의 폼은 파일 단위로 골라 받으므로 거절한다.
 * 버전 문자열이 아니라 본문으로 보는 것은 릴리스 전 개발판(0.23.x)도 새 폼을 쓰기 때문이다.
 */
export const FORM_VERSION = 2;
const POLL_MS = 250;
/**
 * 이 서버의 폼이 여는 모드. 'personal' 은 프로젝트 선택 위에 개인 더함·뺌을 고르는 폼이다(커밋되는 파일을 바꾸지 않는다).
 * 폼 모양 판(FORM_VERSION)은 그대로 두고, CLI 는 응답의 modes 로 개인 모드를 아는 서버인지 본다.
 */
export const FORM_MODES = ['project', 'personal'];
const PRESETS = ['local', 'defaults', 'none'];

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

const keyList = v => Array.isArray(v) && v.every(k => typeof k === 'string' && isBlockKey(k));
/** 개인 모드 payload: 키는 모두 블록 키(별칭을 입힌 가상 키), preset 은 미리 체크한 출처. */
const okPersonal = p => isObj(p) && ['chosen', 'required', 'add', 'remove'].every(f => keyList(p[f])) && PRESETS.includes(p.preset);

/** 추천: 블록 키 → 이유. */
const reasons = v => isObj(v) && Object.values(v).every(x => typeof x === 'string');

function checkFormBody(body, head) {
  const ok = isObj(body) && Number.isInteger(body.revision) && body.revision >= 1 && body.revision <= head
    && isObj(body.project) && typeof body.project.name === 'string'
    && Array.isArray(body.items) && Array.isArray(body.overrides)
    && (body.diffs === undefined || isObj(body.diffs))
    && (body.recommend === undefined || reasons(body.recommend))
    && (body.recommendRemove === undefined || reasons(body.recommendRemove))
    && (body.mode === undefined || FORM_MODES.includes(body.mode))
    && (body.required === undefined || keyList(body.required))
    && (body.mode !== 'personal' || okPersonal(body.personal));
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
    if (body.formVersion !== FORM_VERSION) throw new HttpError(426, t('sync.cliOldForms'));
    const f = forms.create({ tokenId: ownerOf(ctx.auth), revision: body.revision, payload: body });
    const url = new URL(`/forms/${f.id}?k=${encodeURIComponent(f.link)}`, config.publicUrl).href;
    const expiresAt = new Date(Date.parse(f.createdAt) + forms.timers.notOpenedMs).toISOString();
    sendJson(ctx.res, 201, { id: f.id, url, expiresAt, formVersion: FORM_VERSION, modes: FORM_MODES });
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
