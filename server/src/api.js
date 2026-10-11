import { HttpError, sendJson, sendBody } from './http.js';
import { dbTree } from './db-tree.js';
import { SCHEMA_VERSION } from './db.js';
import { catalogSummary } from '../../cli/src/summary.js';
import { isTextPath } from '../../cli/src/store-paths.js';
import { unifiedDiff } from '../../cli/src/diff.js';
import { packageVersion } from '../../cli/src/paths.js';
import { t } from '../../cli/src/i18n.js';

/** 토큰(또는 관리자 세션)이 없으면 401. */
export function requireToken(ctx) {
  if (!ctx.auth) throw new HttpError(401, t('api.tokenNeeded'), { 'WWW-Authenticate': 'Bearer' });
}

/**
 * 지침 읽기. PUBLIC_READ 면 누구나, 아니면 토큰(또는 관리자 세션)이 있어야 한다.
 * 공개여도 틀린·폐기한 토큰을 보내면 401 이다(조용히 익명으로 받지 않아서 CLI 가 토큰을 확인할 수 있다).
 */
export function requireRead(ctx) {
  if (ctx.badToken || !ctx.config.publicRead) requireToken(ctx);
}

/** 관리자가 아니면 401·403. */
export function requireAdmin(ctx) {
  requireToken(ctx);
  if (ctx.auth.kind !== 'admin') throw new HttpError(403, t('api.adminOnly'));
}

/**
 * ?rev= 를 읽는다. 없으면 최신(저장소가 비었으면 0).
 * @param {string | null | undefined} value
 * @param {number} head
 */
export function parseRev(value, head) {
  if (value === null || value === undefined || value === '') return head;
  if (!/^\d+$/.test(value)) throw new HttpError(404, t('api.noRevision'));
  const rev = Number(value);
  if (rev < 1 || rev > head) throw new HttpError(404, t('api.noRevision'));
  return rev;
}

/** 파일 응답의 Content-Type. */
export function contentType(p) {
  const lower = p.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (isTextPath(p)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function intParam(value, { def, min, max, name }) {
  if (value === null || value === '') return def;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new HttpError(400, t('api.badInt', { name, min, max }));
  }
  return Number(value);
}

/** 리비전 id 의 바뀐 파일 하나의 줄 차이. 텍스트가 아니면 null. */
function changeDiff(store, id, change) {
  if (!isTextPath(change.path)) return null;
  const before = store.fileAt(change.path, id - 1)?.toString('utf8') ?? '';
  const after = store.fileAt(change.path, id)?.toString('utf8') ?? '';
  return unifiedDiff(before, after, { aLabel: `r${id - 1}`, bLabel: `r${id}` });
}

/** /api/v1 를 등록한다. */
export function registerApi(router, { store, config }) {
  const rev = ctx => parseRev(ctx.url.searchParams.get('rev'), store.headRevision());

  router.add('GET', '/api/v1/health', ({ res }) => sendJson(res, 200, {
    ok: true, version: packageVersion(), schema: SCHEMA_VERSION, api: 2, revision: store.headRevision(), publicRead: config.publicRead,
  }));

  router.add('GET', '/api/v1/catalog', ctx => {
    requireRead(ctx);
    const r = rev(ctx);
    sendJson(ctx.res, 200, { revision: r, ...catalogSummary(dbTree(store, r)) });
  });

  router.add('GET', '/api/v1/tree', ctx => {
    requireRead(ctx);
    const r = rev(ctx);
    const prefix = ctx.url.searchParams.get('prefix') ?? '';
    sendJson(ctx.res, 200, { revision: r, files: store.pathsAt(r).filter(f => f.path.startsWith(prefix)) });
  });

  router.add('GET', '/api/v1/files/*path', ctx => {
    requireRead(ctx);
    const r = rev(ctx);
    const p = ctx.params.path.normalize('NFC');
    const content = store.fileAt(p, r);
    if (content === null) throw new HttpError(404, t('api.noFile'));
    sendBody(ctx.res, 200, content, contentType(p), { 'X-Guideline-Revision': String(r), ETag: `"${store.hashAt(p, r)}"` });
  });

  router.add('GET', '/api/v1/revisions', ctx => {
    requireRead(ctx);
    const sp = ctx.url.searchParams;
    const limit = intParam(sp.get('limit'), { def: 50, min: 1, max: 200, name: 'limit' });
    const before = intParam(sp.get('before'), { def: undefined, min: 1, max: Number.MAX_SAFE_INTEGER, name: 'before' });
    sendJson(ctx.res, 200, { revisions: store.revisions({ before, limit }) });
  });

  router.add('GET', '/api/v1/revisions/:id', ctx => {
    requireRead(ctx);
    const id = /^\d+$/.test(ctx.params.id) ? Number(ctx.params.id) : 0;
    const info = store.revision(id);
    if (!info) throw new HttpError(404, t('api.noRevision'));
    const withDiff = ctx.url.searchParams.get('diff') === '1';
    const changes = store.changes(id).map(c => (withDiff ? { ...c, diff: changeDiff(store, id, c) } : c));
    sendJson(ctx.res, 200, { ...info, changes });
  });
}
