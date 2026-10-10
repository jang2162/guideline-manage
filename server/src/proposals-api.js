import { HttpError, sendJson, readJson, LIMITS } from './http.js';
import { requireToken } from './api.js';
import { t } from '../../cli/src/i18n.js';

const HASH = /^[0-9a-f]{64}$/;
const STATUSES = ['pending', 'accepted', 'rejected'];
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 본문의 changes 를 { path, content, base } 로 바꾼다. */
function parseChanges(list) {
  if (!Array.isArray(list)) throw new HttpError(400, t('proposal.changesArray'));
  return list.map((c, i) => {
    if (!isObj(c) || typeof c.path !== 'string') throw new HttpError(400, t('proposal.noPath', { i }));
    const kinds = ['text', 'base64', 'delete'].filter(k => c[k] !== undefined);
    if (kinds.length !== 1) throw new HttpError(400, t('proposal.oneOf', { i }));
    if (!Object.hasOwn(c, 'base') || !(c.base === null || (typeof c.base === 'string' && HASH.test(c.base)))) {
      throw new HttpError(400, t('proposal.badBase', { i }));
    }
    let content;
    if (kinds[0] === 'delete') {
      if (c.delete !== true) throw new HttpError(400, t('proposal.badDelete', { i }));
      content = null;
    } else if (kinds[0] === 'text') {
      if (typeof c.text !== 'string') throw new HttpError(400, t('proposal.badText', { i }));
      content = Buffer.from(c.text, 'utf8');
    } else {
      if (typeof c.base64 !== 'string') throw new HttpError(400, t('proposal.badBase64', { i }));
      content = Buffer.from(c.base64, 'base64');
    }
    return { path: c.path, content, base: c.base };
  });
}

const optString = (body, k) => {
  if (body[k] === undefined || body[k] === null) return null;
  if (typeof body[k] !== 'string') throw new HttpError(400, t('proposal.notString', { name: k }));
  return body[k];
};

/** API 응답의 제안 하나. 대기 중이면 지금 원본에 얹어 본 Outdated 여부를 담는다. */
export function proposalView(p, { proposals, config }) {
  const pl = p.status === 'pending' ? proposals.plan(p.changes) : null;
  return {
    id: p.id, title: p.title, description: p.description, project: p.project, author: p.author, status: p.status,
    createdAt: p.createdAt, decidedAt: p.decidedAt, note: p.note, revision: p.revisionId,
    outdated: pl ? pl.conflicts.length > 0 : false,
    conflicts: pl ? pl.conflicts : [],
    changes: p.changes.map(c => ({ path: c.path, kind: c.content === null ? 'delete' : c.base === null ? 'add' : 'modify', base: c.base })),
    url: new URL(`/proposals/${p.id}`, config.publicUrl).href,
  };
}

/** /api/v1/proposals 를 등록한다. */
export function registerProposalsApi(router, { proposals, config }) {
  router.add('POST', '/api/v1/proposals', async ctx => {
    requireToken(ctx);
    const admin = ctx.auth.kind === 'admin';
    if (!admin && ctx.auth.scope !== 'propose') throw new HttpError(403, t('proposal.denied'));
    const body = await readJson(ctx.req, LIMITS.proposal);
    if (!isObj(body)) throw new HttpError(400, t('proposal.bodyObject'));
    const apply = body.apply === true;
    if (apply && !admin) throw new HttpError(403, t('proposal.applyAdmin'));
    const r = proposals.submit({
      title: body.title,
      description: optString(body, 'description') ?? '',
      project: optString(body, 'project'),
      tokenId: admin ? null : ctx.auth.id,
      author: admin ? 'admin' : ctx.auth.name,
      changes: parseChanges(body.changes),
    }, { apply });
    sendJson(ctx.res, 201, { ...r, url: new URL(`/proposals/${r.id}`, config.publicUrl).href });
  });

  router.add('GET', '/api/v1/proposals', ctx => {
    requireToken(ctx);
    const status = ctx.url.searchParams.get('status');
    if (status !== null && !STATUSES.includes(status)) throw new HttpError(400, t('proposal.badStatus', { list: STATUSES.join(', ') }));
    const tokenId = ctx.auth.kind === 'admin' ? null : ctx.auth.id;
    sendJson(ctx.res, 200, { proposals: proposals.list({ status, tokenId }) });
  });

  router.add('GET', '/api/v1/proposals/:id', ctx => {
    requireToken(ctx);
    const p = /^\d+$/.test(ctx.params.id) ? proposals.get(Number(ctx.params.id)) : null;
    if (!p || (ctx.auth.kind !== 'admin' && p.tokenId !== ctx.auth.id)) throw new HttpError(404, t('proposal.notFound'));
    sendJson(ctx.res, 200, proposalView(p, { proposals, config }));
  });
}
