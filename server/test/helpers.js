import http from 'node:http';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createApp } from '../src/app.js';

/** 메모리 DB 위의 저장소. */
export function memoryStore({ now } = {}) {
  return createStore(openDb(':memory:'), { now });
}

/** 부를 때마다 1초씩 가는 시계. */
export function clock(start = '2026-10-07T00:00:00.000Z') {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

export const META = { author: 'admin', message: '테스트', source: 'web' };

export const ADMIN = 'admin-token-'.padEnd(40, 'x');

/** 테스트용 설정. PUBLIC_URL 은 http://guideline.test */
export function testConfig(over = {}) {
  return {
    adminToken: ADMIN, publicUrl: new URL('http://guideline.test'), dataDir: '', port: 0, backupKeep: 3, trustProxy: false, publicRead: true, ...over,
  };
}

/**
 * node:http 로 요청한다. fetch 와 달리 Origin·Host 같은 헤더를 그대로 보낸다. 리다이렉트는 따라가지 않는다.
 * @param {string} base
 * @param {string} path
 * @param {{ method?: string, headers?: Record<string, string>, body?: string | Buffer, auth?: string }} [opts]
 */
export function request(base, path, { method = 'GET', headers = {}, body, auth } = {}) {
  const all = { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers };
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers: all }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: buf.toString('utf8'), json: () => JSON.parse(buf.toString('utf8')) });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** 메모리 DB 로 앱을 띄운다. 테스트가 끝나면 닫는다. */
export async function startApp(t, { config = testConfig(), now, formTimers } = {}) {
  const db = openDb(':memory:');
  const lines = [];
  const app = createApp({ config, db, now, log: line => lines.push(line), formTimers });
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }).then(() => db.close()));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, base, store: app.store, tokens: app.tokens, proposals: app.proposals, lines, config, req: (path, opts) => request(base, path, opts) };
}

/** 폼을 POST 한다. Origin 은 기본으로 PUBLIC_URL 의 origin 이다. origin: null 이면 보내지 않는다. */
export function postForm(s, path, fields, { cookie, origin = s.config.publicUrl.origin, headers = {} } = {}) {
  return s.req(path, {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
  });
}

/** 관리자로 로그인하고 Cookie 헤더에 넣을 값을 돌려준다. */
export async function login(s) {
  const r = await postForm(s, '/login', { token: ADMIN, next: '/' });
  return r.headers['set-cookie'][0].split(';')[0];
}

/** 쿠키를 붙여 GET 한다. */
export function getAs(s, cookie, path) {
  return s.req(path, { headers: { Cookie: cookie } });
}
