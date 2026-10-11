import { packageVersion } from './paths.js';
import { archiveTree } from './tar-read.js';
import { t } from './i18n.js';

export class ServerError extends Error {
  /**
   * @param {string} message 사용자에게 보일 이유(서버가 준 error 가 있으면 그것)
   * @param {number} [status] HTTP 상태. 서버에 닿지 못했으면 0
   * @param {any} [body] 응답 JSON
   */
  constructor(message, status = 0, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** 이 CLI 가 필요로 하는 서버 API 수준. */
export const API_LEVEL = 2;

/** 서버 주소: --server > 매니페스트 > GUIDELINE_SERVER. 끝의 / 는 뗀다. */
export function serverOf({ flag, manifest, env = process.env }) {
  const s = flag || manifest?.server || env.GUIDELINE_SERVER || null;
  return s ? s.replace(/\/+$/, '') : null;
}

/**
 * 지침 서버의 /api/v1 클라이언트.
 * @param {{ server: string, token?: string | null, fetchImpl?: typeof fetch, version?: string }} opts
 */
export function remoteClient({ server, token = null, fetchImpl = fetch, version = packageVersion() }) {
  const base = `${server.replace(/\/+$/, '')}/`;
  async function call(method, apiPath, { body, raw = false, auth = true, extra = {} } = {}) {
    const headers = { 'X-Guideline-Client': version, ...extra };
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(new URL(`api/v1/${apiPath}`, base), {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ServerError(t('remote.unreachable', { server, reason: e.cause?.code ?? e.message }));
    }
    if (raw && res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) throw new ServerError(data?.error ?? t('remote.status', { status: res.status }), res.status, data);
    return data;
  }
  return {
    server,
    health: () => call('GET', 'health', { auth: false }),
    tree: rev => call('GET', rev ? `tree?rev=${rev}` : 'tree'),
    archive: rev => call('GET', `archive?rev=${rev}`, { raw: true }),
    createForm: body => call('POST', 'forms', { body }),
    // 토큰 없이 만든 폼은 링크 토큰(폼 주소의 k)이 결과를 볼 권한이다.
    formResult: (id, wait, link = null) => call('GET', `forms/${encodeURIComponent(id)}/result?wait=${wait}`, { extra: link ? { 'X-Form-Link': link } : {} }),
    exchange: (code, verifier) => call('POST', 'cli/token', { body: { code, verifier }, auth: false }),
    revokeSelf: () => call('DELETE', 'tokens/self'),
    createProposal: body => call('POST', 'proposals', { body }),
  };
}

/** 사용자에게 보일 오류 문장. */
export function explain(e, server) {
  if (!(e instanceof ServerError)) return e.message;
  if (e.status === 401) return t('common.loginNeeded', { url: server });
  if (e.status === 426) return t('remote.cliOld', { reason: e.message });
  return e.message;
}

/** 서버 수준을 확인하고 최신 리비전의 원본 트리를 받는다. */
export async function loadSource(client) {
  const h = await client.health();
  if (!(h.api >= API_LEVEL)) throw new ServerError(t('remote.serverOld', { api: h.api ?? 1 }));
  if (!(h.revision >= 1)) throw new ServerError(t('remote.empty'));
  return { revision: h.revision, tree: archiveTree(await client.archive(h.revision)) };
}

/** 리비전 rev 의 원본 트리. 제안의 기준이다. */
export async function loadRevision(client, rev) {
  return archiveTree(await client.archive(rev));
}
