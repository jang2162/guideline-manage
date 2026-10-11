import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { serverOf, remoteClient, explain } from '../remote.js';
import { saveToken, getToken, removeToken } from '../credentials.js';
import { openBrowser } from '../browser.js';
import { t } from '../i18n.js';

export const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

async function readAll(stream) {
  let s = '';
  for await (const chunk of stream) s += chunk;
  return s;
}

/**
 * 터미널에서 토큰 한 줄을 읽는다. 입력한 글자는 화면에 보이지 않는다.
 * 파이프가 아닌 터미널은 EOF 가 오지 않아서, readAll 로는 아무 안내 없이 멈춘 것처럼 보인다.
 * @returns {Promise<string | null>} Ctrl-C 면 null
 */
function readHiddenLine(stdin, write) {
  return new Promise(resolve => {
    let s = '';
    const done = value => {
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      write('\n');
      resolve(value);
    };
    const onData = chunk => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(s);
        if (ch === '\u0003') return done(null);
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
        else s += ch;
      }
    };
    stdin.setRawMode?.(true);
    stdin.setEncoding?.('utf8');
    stdin.on('data', onData);
    stdin.resume();
  });
}

/** 127.0.0.1 의 임시 포트에서 /cb 한 번을 기다린다. */
async function callbackServer() {
  let resolve;
  const got = new Promise(r => {
    resolve = r;
  });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (u.pathname !== '/cb') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>guideline</title><p>${t('login.callbackPage')}</p>`);
    resolve({ code: u.searchParams.get('code'), state: u.searchParams.get('state') });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const close = () => new Promise(r => {
    server.closeAllConnections();
    server.close(() => r());
  });
  return { url: `http://127.0.0.1:${server.address().port}/cb`, got, close };
}

/**
 * 지침 서버에 로그인해 읽기 토큰을 저장한다. 브라우저 승인(PKCE) 또는 --token-stdin.
 * @returns {Promise<number>}
 */
export async function login({
  server, tokenStdin = false, env = process.env, out = console.log, err = console.error, open = openBrowser, fetchImpl = fetch,
  home, stdin = process.stdin, hostname = os.hostname(), timeoutMs = LOGIN_TIMEOUT_MS,
  prompt = s => process.stderr.write(s),
}) {
  const url = serverOf({ flag: server, env });
  if (!url) {
    err(t('common.noServer'));
    return 2;
  }
  if (tokenStdin) {
    let token;
    if (stdin.isTTY) {
      prompt(t('login.pasteToken'));
      token = await readHiddenLine(stdin, prompt);
      if (token === null) return 130;
    } else {
      token = await readAll(stdin);
    }
    token = token.trim();
    if (!token) {
      err(t('login.noStdinToken'));
      return 2;
    }
    try {
      await remoteClient({ server: url, token, fetchImpl }).tree();
    } catch (e) {
      err(t('login.tokenCheckFailed', { reason: explain(e, url) }));
      return 1;
    }
    saveToken(url, { token, name: 'stdin' }, { env, home });
    out(t('login.saved', { url }));
    return 0;
  }

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const cb = await callbackServer();
  const loginUrl = `${url}/cli/login?${new URLSearchParams({ callback: cb.url, state, challenge, name: hostname })}`;
  err(t('login.openUrl', { url: loginUrl }));
  open(loginUrl);
  let timer;
  const timeout = new Promise(r => {
    timer = setTimeout(() => r(null), timeoutMs);
  });
  const got = await Promise.race([cb.got, timeout]);
  clearTimeout(timer);
  await cb.close();
  if (!got) {
    err(t('login.timeout'));
    return 1;
  }
  if (got.state !== state || !got.code) {
    err(t('login.badState'));
    return 1;
  }
  try {
    const r = await remoteClient({ server: url, fetchImpl }).exchange(got.code, verifier);
    saveToken(url, { token: r.token, name: r.name }, { env, home });
    out(t('login.done', { url, name: r.name }));
    return 0;
  } catch (e) {
    err(explain(e, url));
    return 1;
  }
}

/**
 * 저장한 토큰을 서버에서 폐기하고(닿지 않아도 계속) 로컬에서 지운다.
 * @returns {Promise<number>}
 */
export async function logout({ server, env = process.env, out = console.log, err = console.error, fetchImpl = fetch, home }) {
  const url = serverOf({ flag: server, env });
  if (!url) {
    err(t('common.noServer'));
    return 2;
  }
  const fileEnv = { ...env };
  delete fileEnv.GUIDELINE_TOKEN;
  const token = getToken(url, { env: fileEnv, home });
  if (!token) {
    out(t('login.notLoggedIn'));
    return 0;
  }
  try {
    await remoteClient({ server: url, token, fetchImpl }).revokeSelf();
  } catch {
    // 서버에 닿지 않아도 로컬 토큰은 지운다
  }
  removeToken(url, { env: fileEnv, home });
  out(t('login.loggedOut', { url }));
  return 0;
}
