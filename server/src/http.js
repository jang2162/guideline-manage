import { t } from '../../cli/src/i18n.js';

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message 사용자에게 보이는 이유
   * @param {Record<string, string>} [headers] 응답에 더할 헤더
   */
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/** 요청 본문 한도. form 은 편집 폼·업로드(폼 인코딩이 내용을 부풀린다), import 는 가져오기. */
export const LIMITS = { default: 1024 * 1024, form: 4 * 1024 * 1024, proposal: 20 * 1024 * 1024 };

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

/**
 * 본문을 끝까지 읽는다. 한도를 넘으면 나머지를 버리며 읽은 뒤 413.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit]
 * @returns {Promise<Buffer>}
 */
export async function readBody(req, limit = LIMITS.default) {
  const tooLarge = () => new HttpError(413, t('http.tooLarge', { limit }));
  if (Number(req.headers['content-length']) > limit) throw tooLarge();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw tooLarge();
  return Buffer.concat(chunks);
}

/** `application/json` 본문을 읽어 해석한다. 형식이 틀리면 415·400. */
export async function readJson(req, limit = LIMITS.default) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, t('http.needJson'));
  }
  const buf = await readBody(req, limit);
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, t('http.badJson'));
  }
}

/** `application/x-www-form-urlencoded` 본문을 읽는다. */
export async function readForm(req, limit = LIMITS.default) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
    throw new HttpError(415, t('http.notForm'));
  }
  return new URLSearchParams((await readBody(req, limit)).toString('utf8'));
}

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function sendBody(res, status, body, type, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, ...headers });
  res.end(buf);
}

export function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

/** @returns {Record<string, string>} */
export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * 요청한 IP. 프록시 뒤에서는 모든 요청이 프록시 IP 로 보여서, trustProxy 면 X-Forwarded-For 의 마지막 값을 쓴다.
 * 앞쪽 값은 클라이언트가 마음대로 보낼 수 있다. 마지막 값은 믿는 프록시(하나)가 덧붙인 실제 접속 IP 다.
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',').at(-1).trim();
  }
  return req.socket.remoteAddress ?? '';
}

/** Origin(없으면 Referer 의 origin)이 PUBLIC_URL 의 origin 과 같은가. 다른 사이트가 보낸 요청을 막는다. */
export function sameOrigin(req, publicUrl) {
  let origin = req.headers.origin;
  if (!origin) {
    try {
      origin = new URL(req.headers.referer).origin;
    } catch {
      return false;
    }
  }
  return origin === publicUrl.origin;
}

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, t('http.badUrl'));
  }
}

/** 패턴 조각과 주소 조각을 맞춘다. 맞으면 params, 아니면 null. */
function matchParts(parts, segs) {
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('*')) {
      params[p.slice(1)] = segs.slice(i).map(decode).join('/');
      return params;
    }
    if (i >= segs.length) return null;
    if (p.startsWith(':')) params[p.slice(1)] = decode(segs[i]);
    else if (p !== segs[i]) return null;
  }
  return parts.length === segs.length ? params : null;
}

/**
 * 메서드와 경로로 처리기를 고른다. `:이름` 은 한 조각, `*이름` 은 나머지 전부(조각마다 디코딩해 `/` 로 잇는다).
 * HEAD 는 GET 처리기로 간다.
 */
export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method, parts: pattern.split('/').slice(1), handler });
    },
    match(method, pathname) {
      const segs = pathname.split('/').slice(1);
      const allowed = new Set();
      for (const r of routes) {
        const params = matchParts(r.parts, segs);
        if (!params) continue;
        if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { handler: r.handler, params };
        allowed.add(r.method);
      }
      return allowed.size ? { allowed: [...allowed] } : null;
    },
  };
}
