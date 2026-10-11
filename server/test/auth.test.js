import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createTokens, TokenError } from '../src/tokens.js';
import { sessionKey, makeSession, checkSession, safeEqual, SESSION_TTL_MS } from '../src/session.js';
import { createLoginLimiter } from '../src/rate-limit.js';

function tokensAt(start = '2026-10-07T00:00:00.000Z') {
  const time = { t: Date.parse(start) };
  const db = openDb(':memory:');
  return { db, time, tokens: createTokens(db, { now: () => new Date(time.t) }) };
}

test('발급한 토큰은 원문 없이 해시로 저장되고 verify 로 확인된다', () => {
  const { db, tokens } = tokensAt();
  const { id, token } = tokens.issue({ name: 'jang-macbook', scope: 'read' });
  assert.match(token, /^glt_[A-Za-z0-9_-]{43}$/);
  const stored = db.prepare('SELECT hash FROM tokens WHERE id = ?').get(id).hash;
  assert.notEqual(stored, token);
  assert.ok(!stored.includes(token));
  assert.deepEqual(tokens.verify(token), { id, name: 'jang-macbook', scope: 'read' });
  assert.equal(tokens.verify('glt_wrong'), null);
  assert.equal(tokens.verify('nope'), null);
  assert.deepEqual(tokens.list().map(t => [t.name, t.scope, t.revokedAt]), [['jang-macbook', 'read', null]]);
  assert.equal('token' in tokens.list()[0], false);
});

test('폐기한 토큰은 verify 가 null 이고, 이름은 다시 쓸 수 없다', () => {
  const { tokens } = tokensAt();
  const { id, token } = tokens.issue({ name: 'ci', scope: 'propose' });
  assert.equal(tokens.revoke(id), true);
  assert.equal(tokens.revoke(id), false);
  assert.equal(tokens.verify(token), null);
  assert.throws(() => tokens.issue({ name: 'ci', scope: 'read' }), e => e instanceof TokenError && e.message === '이미 있는 이름: ci');
});

test('이름과 범위가 틀리면 TokenError', () => {
  const { tokens } = tokensAt();
  assert.throws(() => tokens.issue({ name: '한글', scope: 'read' }), e => e.message === '이름은 영문·숫자와 . _ - 로 1~64자');
  assert.throws(() => tokens.issue({ name: '', scope: 'read' }), TokenError);
  assert.throws(() => tokens.issue({ name: 'a', scope: 'owner' }), e => e.message === '범위는 read·propose·admin 중 하나여야 함');
});

test('last_used_at 은 1분에 한 번까지만 바뀐다', () => {
  const { tokens, time } = tokensAt();
  const { token } = tokens.issue({ name: 'a', scope: 'read' });
  tokens.verify(token);
  const first = tokens.list()[0].lastUsedAt;
  assert.equal(first, '2026-10-07T00:00:00.000Z');
  time.t += 30_000;
  tokens.verify(token);
  assert.equal(tokens.list()[0].lastUsedAt, first);
  time.t += 30_000;
  tokens.verify(token);
  assert.equal(tokens.list()[0].lastUsedAt, '2026-10-07T00:01:00.000Z');
});

test('세션은 같은 키로만, 만료 전에만 통과하고, ADMIN_TOKEN 을 바꾸면 끊긴다', () => {
  const key = sessionKey('a'.repeat(32));
  const now = new Date('2026-10-07T00:00:00Z');
  const s = makeSession(key, now);
  assert.equal(checkSession(key, s, now), true);
  assert.equal(checkSession(key, s, new Date(now.getTime() + SESSION_TTL_MS - 1)), true);
  assert.equal(checkSession(key, s, new Date(now.getTime() + SESSION_TTL_MS)), false);
  assert.equal(checkSession(sessionKey('b'.repeat(32)), s, now), false);
  const [payload, sig] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 1e12 })).toString('base64url');
  assert.equal(checkSession(key, `${forged}.${sig}`, now), false);
  assert.equal(checkSession(key, payload, now), false);
  assert.equal(checkSession(key, undefined, now), false);
});

test('safeEqual 은 길이가 달라도 던지지 않는다', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

test('로그인 제한은 10분 안에 5번 틀리면 막고, 창이 지나면 풀고, 성공하면 지운다', () => {
  let t = 0;
  const limiter = createLoginLimiter({ now: () => t });
  for (let i = 0; i < 4; i++) limiter.fail('1.1.1.1');
  assert.equal(limiter.blockedFor('1.1.1.1'), 0);
  limiter.fail('1.1.1.1');
  assert.equal(limiter.blockedFor('1.1.1.1'), 10 * 60 * 1000);
  assert.equal(limiter.blockedFor('2.2.2.2'), 0);
  t = 10 * 60 * 1000;
  assert.equal(limiter.blockedFor('1.1.1.1'), 0);
  for (let i = 0; i < 4; i++) limiter.fail('3.3.3.3');
  limiter.reset('3.3.3.3');
  limiter.fail('3.3.3.3');
  assert.equal(limiter.blockedFor('3.3.3.3'), 0);
});
