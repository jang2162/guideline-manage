import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, login, getAs, postForm } from './helpers.js';

test('발급 폼에 admin 범위와 경고가 있다', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  const page = await getAs(s, cookie, '/tokens');
  assert.match(page.text, /<option value="admin">admin<\/option>/);
  assert.ok(page.text.includes('admin 토큰은 제안 검토 없이 원본을 바로 바꿀 수 있음'));
});

test('폐기한 토큰에만 삭제 버튼이 있고, 삭제하면 목록에서 사라진다', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  const { id } = s.tokens.issue({ name: 'old-laptop', scope: 'read' });
  assert.ok(!(await getAs(s, cookie, '/tokens')).text.includes(`/tokens/${id}/delete`));
  s.tokens.revoke(id);
  const listed = await getAs(s, cookie, '/tokens');
  assert.ok(listed.text.includes(`/tokens/${id}/delete`));
  assert.ok(listed.text.includes('old-laptop 토큰을 삭제할까요?'));
  const r = await postForm(s, `/tokens/${id}/delete`, {}, { cookie });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/tokens');
  assert.ok(!(await getAs(s, cookie, '/tokens')).text.includes('old-laptop'));
});

test('다른 출처의 삭제 요청은 403, 세션 없으면 로그인으로', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  const { id } = s.tokens.issue({ name: 'x', scope: 'read' });
  s.tokens.revoke(id);
  assert.equal((await postForm(s, `/tokens/${id}/delete`, {}, { cookie, origin: 'http://evil.test' })).status, 403);
  const anon = await postForm(s, `/tokens/${id}/delete`, {});
  assert.equal(anon.status, 303);
  assert.match(anon.headers.location, /^\/login\?next=/);
  assert.ok((await getAs(s, cookie, '/tokens')).text.includes('>x<'));
});
