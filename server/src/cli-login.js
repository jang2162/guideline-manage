import crypto from 'node:crypto';
import { safeEqual } from './session.js';

export const CODE_TTL_MS = 2 * 60 * 1000;

/**
 * CLI 로그인(PKCE)의 한 번 쓰는 코드. 메모리에만 둔다 — 서버가 다시 시작하면 진행 중인 로그인은 사라진다.
 * @param {{ now?: () => number, ttlMs?: number }} [opts]
 */
export function createCliLogins({ now = () => Date.now(), ttlMs = CODE_TTL_MS } = {}) {
  const codes = new Map();
  const prune = () => {
    for (const [c, v] of codes) if (v.expires <= now()) codes.delete(c);
  };
  return {
    issue({ challenge, name }) {
      prune();
      const code = crypto.randomBytes(24).toString('base64url');
      codes.set(code, { challenge, name, expires: now() + ttlMs });
      return code;
    },
    /** 맞으면 { name }, 아니면 null. 맞든 틀리든 코드는 한 번 쓰면 없어진다. */
    redeem(code, verifier) {
      const c = typeof code === 'string' ? codes.get(code) : undefined;
      if (!c) return null;
      codes.delete(code);
      if (c.expires <= now() || typeof verifier !== 'string') return null;
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      return safeEqual(challenge, c.challenge) ? { name: c.name } : null;
    },
  };
}
