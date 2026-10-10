import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRouter, readBody, parseCookies, clientIp, sameOrigin, HttpError } from '../src/http.js';

test('라우터는 :이름 과 *이름 을 디코딩해 넘기고, 메서드가 다르면 허용 메서드를 낸다', () => {
  const router = createRouter();
  const h1 = () => 1;
  const h2 = () => 2;
  router.add('GET', '/api/v1/files/*path', h1);
  router.add('POST', '/tokens/:id/revoke', h2);
  router.add('GET', '/d/*path', h1);
  assert.deepEqual(router.match('GET', '/api/v1/files/rules/%ED%95%9C/00-a.md'), { handler: h1, params: { path: 'rules/한/00-a.md' } });
  assert.deepEqual(router.match('HEAD', '/api/v1/files/x.md').params, { path: 'x.md' });
  assert.deepEqual(router.match('POST', '/tokens/7/revoke'), { handler: h2, params: { id: '7' } });
  assert.deepEqual(router.match('GET', '/tokens/7/revoke'), { allowed: ['POST'] });
  assert.equal(router.match('GET', '/tokens/7'), null);
  assert.deepEqual(router.match('GET', '/d/').params, { path: '' });
  assert.deepEqual(router.match('GET', '/d').params, { path: '' });
  assert.throws(() => router.match('GET', '/d/%E0%A4%A'), e => e instanceof HttpError && e.status === 400);
});

const fakeReq = (chunks, headers = {}) => Object.assign(Readable.from(chunks), { headers });

test('readBody 는 한도를 넘으면 413', async () => {
  assert.equal((await readBody(fakeReq([Buffer.from('abc')]), 5)).toString(), 'abc');
  await assert.rejects(readBody(fakeReq([Buffer.from('abc'), Buffer.from('def')]), 5), e => e.status === 413);
  await assert.rejects(readBody(fakeReq([], { 'content-length': '6' }), 5), e => e.status === 413);
});

test('parseCookies, clientIp, sameOrigin', () => {
  assert.deepEqual(parseCookies('a=1; gs_session=x.y; b=%ED%95%9C'), { a: '1', gs_session: 'x.y', b: '한' });
  assert.deepEqual(parseCookies(undefined), {});
  const req = (headers, remoteAddress = '10.0.0.1') => ({ headers, socket: { remoteAddress } });
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), false), '10.0.0.1');
  // 클라이언트가 보낸 값(앞)이 아니라 프록시가 덧붙인 실제 접속 IP(마지막)를 쓴다
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }), true), '5.6.7.8');
  assert.equal(clientIp(req({ 'x-forwarded-for': '9.9.9.9' }), true), '9.9.9.9');
  assert.equal(clientIp(req({}), true), '10.0.0.1');
  const pub = new URL('https://g.example.com');
  assert.equal(sameOrigin(req({ origin: 'https://g.example.com' }), pub), true);
  assert.equal(sameOrigin(req({ origin: 'http://10.0.0.5:3000' }), pub), false);
  assert.equal(sameOrigin(req({ referer: 'https://g.example.com/edit/x' }), pub), true);
  assert.equal(sameOrigin(req({}), pub), false);
});
