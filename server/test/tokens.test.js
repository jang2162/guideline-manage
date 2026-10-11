import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createTokens } from '../src/tokens.js';

function setup(t) {
  const db = openDb(':memory:');
  t.after(() => db.close());
  return { db, tokens: createTokens(db) };
}

test('admin 범위 토큰을 발급하고 verify 는 scope admin 을 돌려준다', t => {
  const { tokens } = setup(t);
  const { token } = tokens.issue({ name: 'a', scope: 'admin' });
  assert.equal(tokens.verify(token).scope, 'admin');
});

test('remove 는 폐기한 토큰만 목록에서 숨기고 이름을 다시 쓰게 한다', t => {
  const { tokens } = setup(t);
  const { id } = tokens.issue({ name: 'a', scope: 'read' });
  tokens.issue({ name: 'b', scope: 'read' });
  assert.equal(tokens.remove(id), false);
  assert.ok(tokens.list().some(r => r.id === id));
  tokens.revoke(id);
  assert.equal(tokens.remove(id), true);
  assert.equal(tokens.remove(id), false);
  assert.ok(!tokens.list().some(r => r.id === id));
  const again = tokens.issue({ name: 'a', scope: 'read' });
  assert.notEqual(again.id, id);
});

test('지운 토큰의 id 는 마지막 행이어도 다시 쓰지 않는다', t => {
  const { tokens } = setup(t);
  tokens.issue({ name: 'a', scope: 'read' });
  const last = tokens.issue({ name: 'b', scope: 'read' });
  tokens.revoke(last.id);
  tokens.remove(last.id);
  assert.ok(tokens.issue({ name: 'c', scope: 'read' }).id > last.id);
});

test('숨긴 토큰이 리비전에 남아 있어도 remove 는 성공한다', t => {
  const { db, tokens } = setup(t);
  const { id } = tokens.issue({ name: 'a', scope: 'propose' });
  db.prepare("INSERT INTO revisions (created_at, author, token_id, message, source) VALUES ('2026-01-01', 'a', ?, 'm', 'proposal')").run(id);
  tokens.revoke(id);
  assert.equal(tokens.remove(id), true);
});
