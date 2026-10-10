/**
 * IP 별 로그인 실패 횟수. 첫 실패부터 windowMs 안에 max 번 틀리면 그 창이 끝날 때까지 막는다.
 * @param {{ max?: number, windowMs?: number, now?: () => number }} [opts]
 */
export function createLoginLimiter({ max = 5, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const fails = new Map();
  const current = ip => {
    const f = fails.get(ip);
    if (f && now() - f.start >= windowMs) {
      fails.delete(ip);
      return null;
    }
    return f ?? null;
  };
  const prune = () => {
    for (const ip of [...fails.keys()]) current(ip);
  };
  return {
    /** 막혀 있으면 남은 ms, 아니면 0. */
    blockedFor(ip) {
      const f = current(ip);
      return f && f.count >= max ? windowMs - (now() - f.start) : 0;
    },
    fail(ip) {
      if (fails.size > 10000) prune();
      const f = current(ip);
      if (f) f.count++;
      else fails.set(ip, { count: 1, start: now() });
    },
    reset(ip) {
      fails.delete(ip);
    },
  };
}
