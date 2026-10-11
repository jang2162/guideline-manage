import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { startApp, login as adminLogin, postForm, getAs } from '../../server/test/helpers.js';
import { tmpDir, collect } from './helpers.js';
import { login, logout } from '../src/commands/login.js';
import { getToken, credentialsPath } from '../src/credentials.js';

function homeOf(t) {
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

/** 브라우저 대신: 로그인 화면을 열고 「발급」 을 누른 뒤 콜백으로 간다. */
function browserFor(s, cookie) {
  return async url => {
    const u = new URL(url);
    assert.equal((await getAs(s, cookie, u.pathname + u.search)).status, 200);
    const r = await postForm(s, '/cli/login', Object.fromEntries(u.searchParams), { cookie });
    await fetch(r.headers.location);
  };
}

test('브라우저로 승인하면 읽기 토큰을 받아 저장한다', async t => {
  const s = await startApp(t);
  const home = homeOf(t);
  const cookie = await adminLogin(s);
  const o = collect();
  const e = collect();
  const code = await login({ server: s.base, env: {}, home, out: o.out, err: e.out, open: browserFor(s, cookie), hostname: 'test-mac' });
  assert.equal(code, 0, e.text());
  assert.match(e.text(), /^로그인: http:\/\/127\.0\.0\.1:\d+\/cli\/login\?/m);
  assert.match(o.text(), /로그인했다: .*\(cli-test-mac-[0-9a-f]{6}\)/);
  const token = getToken(s.base, { env: {}, home });
  assert.equal(s.tokens.verify(token).scope, 'read');
  assert.equal(fs.statSync(credentialsPath({ env: {}, home })).mode & 0o777, 0o600);
});

test('시간 안에 승인하지 않으면 1', async t => {
  const s = await startApp(t);
  const e = collect();
  const code = await login({ server: s.base, env: {}, home: homeOf(t), err: e.out, out: () => {}, open: () => {}, timeoutMs: 50 });
  assert.equal(code, 1);
  assert.match(e.text(), /3분 안에 로그인하지 않았다/);
});

test('--token-stdin 은 토큰을 확인한 뒤 저장한다', async t => {
  const s = await startApp(t);
  const home = homeOf(t);
  const { token } = s.tokens.issue({ name: 'ci', scope: 'read' });
  assert.equal(await login({ server: s.base, tokenStdin: true, stdin: Readable.from([`${token}\n`]), env: {}, home, out: () => {} }), 0);
  assert.equal(getToken(s.base, { env: {}, home }), token);
  const e = collect();
  assert.equal(await login({ server: s.base, tokenStdin: true, stdin: Readable.from(['glt_wrong']), env: {}, home, out: () => {}, err: e.out }), 1);
  assert.match(e.text(), /토큰을 확인하지 못했다/);
});

test('--token-stdin 은 터미널이면 안내를 띄우고 가린 채 한 줄을 읽는다', async t => {
  const s = await startApp(t);
  const home = homeOf(t);
  const { token } = s.tokens.issue({ name: 'tty', scope: 'read' });
  const tty = (text) => {
    const r = new Readable({ read() {} });
    r.isTTY = true;
    const modes = [];
    r.setRawMode = on => modes.push(on);
    r.modes = modes;
    setImmediate(() => r.push(text));
    return r;
  };
  const shown = collect();
  const stdin = tty(`${token.slice(0, 5)}x\u007f${token.slice(5)}\r`);
  const p = s => shown.out(s);
  assert.equal(await login({ server: s.base, tokenStdin: true, stdin, env: {}, home, out: () => {}, prompt: p }), 0);
  assert.equal(getToken(s.base, { env: {}, home }), token);
  assert.match(shown.text(), /토큰을 붙여 넣고 Enter/);
  assert.ok(!shown.text().includes(token), '토큰은 화면에 나오지 않는다');
  assert.deepEqual(stdin.modes, [true, false]);
  assert.equal(await login({ server: s.base, tokenStdin: true, stdin: tty('\u0003'), env: {}, home, out: () => {}, prompt: () => {} }), 130);
});

test('서버 주소가 없으면 2', async t => {
  const e = collect();
  assert.equal(await login({ env: {}, home: homeOf(t), err: e.out }), 2);
  assert.match(e.text(), /서버 주소가 없다/);
});

test('logout 은 서버에서 폐기하고 로컬 토큰을 지운다', async t => {
  const s = await startApp(t);
  const home = homeOf(t);
  const { token } = s.tokens.issue({ name: 'cli-x', scope: 'read' });
  await login({ server: s.base, tokenStdin: true, stdin: Readable.from([token]), env: {}, home, out: () => {} });
  const o = collect();
  assert.equal(await logout({ server: s.base, env: {}, home, out: o.out }), 0);
  assert.equal(s.tokens.verify(token), null);
  assert.equal(getToken(s.base, { env: {}, home }), null);
  assert.match(o.text(), /로그아웃했다/);
  const again = collect();
  assert.equal(await logout({ server: s.base, env: {}, home, out: again.out }), 0);
  assert.match(again.text(), /로그인돼 있지 않다/);
});
