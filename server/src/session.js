import crypto from 'node:crypto';

export const SESSION_COOKIE = 'gs_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** 세션 서명 키. ADMIN_TOKEN 에서 만들어서, 토큰을 바꾸면 모든 세션이 끊긴다. */
export function sessionKey(adminToken) {
  return crypto.createHmac('sha256', adminToken).update('guideline-session').digest();
}

const sign = (key, payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

/** 길이가 달라도 같은 시간에 비교한다(두 값의 해시를 비교). */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** `<base64url {"exp":…}>.<서명>` */
export function makeSession(key, now = new Date()) {
  const payload = Buffer.from(JSON.stringify({ exp: now.getTime() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(key, payload)}`;
}

/** 서명이 맞고 만료 전이면 true. */
export function checkSession(key, value, now = new Date()) {
  if (typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const payload = value.slice(0, dot);
  if (!safeEqual(value.slice(dot + 1), sign(key, payload))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && now.getTime() < exp;
  } catch {
    return false;
  }
}
