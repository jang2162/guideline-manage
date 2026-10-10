import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createForms } from '../src/forms.js';
import { createCliLogins } from '../src/cli-login.js';

/** 손으로 움직이는 시계. */
function manualClock(start = '2026-10-08T00:00:00.000Z') {
  let t = Date.parse(start);
  const now = () => new Date(t);
  now.advance = ms => {
    t += ms;
  };
  return now;
}

function forms(t, timers) {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const now = manualClock();
  return { f: createForms(db, { now, timers: { notOpenedMs: 1000, gapMs: 500, keepMs: 10_000, ...timers } }), now };
}

test('만들고 링크로 찾고, 틀린 링크는 null', t => {
  const { f } = forms(t);
  const { id, link } = f.create({ tokenId: 7, revision: 3, payload: { a: 1 } });
  const got = f.checkLink(id, link);
  assert.equal(got.tokenId, 7);
  assert.equal(got.revision, 3);
  assert.deepEqual(got.payload, { a: 1 });
  assert.equal(got.status, 'pending');
  assert.equal(f.checkLink(id, 'wrong'), null);
  assert.equal(f.checkLink('none', link), null);
});

test('열지 않고 notOpenedMs 가 지나면 만료', t => {
  const { f, now } = forms(t);
  const { id } = f.create({ tokenId: null, revision: 1, payload: {} });
  now.advance(999);
  assert.equal(f.load(id).status, 'pending');
  now.advance(1);
  assert.equal(f.load(id).status, 'expired');
});

test('연 뒤에는 마지막 ping 에서 gapMs 가 지나면 만료', t => {
  const { f, now } = forms(t);
  const { id } = f.create({ tokenId: null, revision: 1, payload: {} });
  f.open(id);
  now.advance(400);
  f.ping(id);
  now.advance(400);
  assert.equal(f.load(id).status, 'pending');
  now.advance(100);
  assert.equal(f.load(id).status, 'expired');
});

test('finish 는 한 번만 된다', t => {
  const { f } = forms(t);
  const { id } = f.create({ tokenId: null, revision: 1, payload: {} });
  assert.equal(f.finish(id, 'submitted', { items: [] }), true);
  assert.equal(f.finish(id, 'cancelled'), false);
  assert.deepEqual(f.load(id).selection, { items: [] });
  assert.equal(f.load(id).status, 'submitted');
});

test('keepMs 가 지난 폼은 다음 create 때 지운다', t => {
  const { f, now } = forms(t);
  const { id } = f.create({ tokenId: null, revision: 1, payload: {} });
  now.advance(10_001);
  f.create({ tokenId: null, revision: 1, payload: {} });
  assert.equal(f.load(id), null);
});

test('로그인 코드는 verifier 가 맞을 때 한 번만, ttl 안에서만 바뀐다', () => {
  let t = 0;
  const logins = createCliLogins({ now: () => t, ttlMs: 100 });
  const verifier = 'v'.repeat(43);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = logins.issue({ challenge, name: 'cli-a' });
  assert.deepEqual(logins.redeem(code, verifier), { name: 'cli-a' });
  assert.equal(logins.redeem(code, verifier), null);
  const wrong = logins.issue({ challenge, name: 'cli-b' });
  assert.equal(logins.redeem(wrong, 'x'.repeat(43)), null);
  assert.equal(logins.redeem(wrong, verifier), null, '틀린 시도 뒤에는 쓸 수 없다');
  const late = logins.issue({ challenge, name: 'cli-c' });
  t = 100;
  assert.equal(logins.redeem(late, verifier), null);
});
