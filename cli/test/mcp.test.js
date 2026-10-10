import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, write } from './helpers.js';
import { readServer, envVars, serverWarnings } from '../src/mcp.js';

function serverDir(t, content) {
  const root = tmpDir('guideline-mcp-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (content !== undefined) write(root, 'x/server.json', content);
  else fs.mkdirSync(path.join(root, 'x'));
  return path.join(root, 'x');
}

test('readServer 는 stdio·http 서버를 읽는다', t => {
  const stdio = { type: 'stdio', command: 'npx', args: ['-y', 'a'] };
  assert.deepEqual(readServer(serverDir(t, JSON.stringify(stdio))), { server: stdio });
  const http = { type: 'http', url: 'https://example.com/mcp' };
  assert.deepEqual(readServer(serverDir(t, JSON.stringify(http))), { server: http });
});

test('readServer 는 server.json 이 없으면 이유를 돌려준다', t => {
  assert.deepEqual(readServer(serverDir(t)), { reason: 'server.json 없음' });
});

test('readServer 는 JSON 이 아니거나 객체가 아니면 읽을 수 없다고 한다', t => {
  for (const content of ['{ 깨짐', '[]', 'null', '"문자열"']) {
    assert.deepEqual(readServer(serverDir(t, content)), { reason: 'server.json 을 읽을 수 없음' }, content);
  }
});

test('readServer 는 server.json 이 디렉터리여도 크래시하지 않는다', t => {
  const dir = serverDir(t);
  fs.mkdirSync(path.join(dir, 'server.json'));
  assert.deepEqual(readServer(dir), { reason: 'server.json 을 읽을 수 없음' });
});

test('readServer 는 type 과 필수 필드가 맞지 않으면 이유를 돌려준다', t => {
  const bad = [
    { command: 'npx' },
    { type: 'sse', url: 'https://x' },
    { type: 'stdio', url: 'https://x' },
    { type: 'http', command: 'npx' },
    { type: 'stdio', command: '' },
    { type: 'http', url: 42 },
  ];
  for (const s of bad) {
    assert.deepEqual(
      readServer(serverDir(t, JSON.stringify(s))),
      { reason: 'type 이 stdio·http 가 아니거나 command·url 없음' },
      JSON.stringify(s),
    );
  }
});

test('envVars 는 env·headers 값의 참조 이름을 모아 정렬하고 중복을 없앤다', () => {
  const server = {
    type: 'http',
    url: 'https://x',
    env: { B: '${B}', LOG: 'info' },
    headers: { Authorization: 'Bearer ${A}', 'X-B': '${B}' },
  };
  assert.deepEqual(envVars(server), ['A', 'B']);
  assert.deepEqual(envVars({ type: 'stdio', command: 'npx' }), []);
});

test('envVars 는 env·headers 가 객체가 아니거나 값이 문자열이 아니어도 크래시하지 않는다', () => {
  assert.deepEqual(envVars({ type: 'stdio', command: 'npx', env: ['${A}'], headers: null }), []);
  assert.deepEqual(envVars({ type: 'stdio', command: 'npx', env: { N: 1 } }), []);
});

test('serverWarnings 는 규칙을 지킨 서버에 경고하지 않는다', () => {
  assert.deepEqual(serverWarnings({ type: 'stdio', command: 'npx', args: ['-y', 'a'], env: { DB_PASSWORD: '${DB_PASSWORD}' } }), []);
  assert.deepEqual(serverWarnings({ type: 'http', url: 'https://x', headers: { Authorization: 'Bearer ${T}', 'X-K': '${K}' } }), []);
});

test('serverWarnings 는 헤더 이름의 대소문자를 가리지 않고 Bearer 를 받아들인다', () => {
  assert.deepEqual(serverWarnings({ type: 'http', url: 'https://x', headers: { authorization: 'Bearer ${T}' } }), []);
});

test('serverWarnings 는 env 고정값과 이름이 다른 참조를 경고한다', () => {
  const w = serverWarnings({ type: 'stdio', command: 'npx', env: { LOG: 'info', PW: '${DB_PW}', N: 1, D: '${D:-x}' } });
  assert.deepEqual(w, [
    'env.LOG 가 변수 참조가 아님',
    'env.PW 는 ${PW} 로만 참조할 수 있음',
    'env.N 가 변수 참조가 아님',
    'env.D 는 ${D} 로만 참조할 수 있음',
  ]);
});

test('serverWarnings 는 headers 고정값과 옮길 수 없는 참조 형식을 경고한다', () => {
  const w = serverWarnings({
    type: 'http',
    url: 'https://x',
    headers: { 'X-Static': 'abc', 'X-Token': 'Bearer ${T}', 'X-Mixed': 'k=${K}' },
  });
  assert.deepEqual(w, [
    'headers.X-Static 가 변수 참조가 아님',
    'headers.X-Token 의 참조 형식을 Codex 로 옮길 수 없음',
    'headers.X-Mixed 의 참조 형식을 Codex 로 옮길 수 없음',
  ]);
});

test('serverWarnings 는 command·args·url 의 참조를 경고한다', () => {
  assert.deepEqual(
    serverWarnings({ type: 'stdio', command: '${BIN}', args: ['--token', '${T}', '--x', '${U}'] }),
    ['command 에는 변수 참조를 쓸 수 없음', 'args 에는 변수 참조를 쓸 수 없음'],
  );
  assert.deepEqual(
    serverWarnings({ type: 'http', url: 'https://x/mcp?key=${K}' }),
    ['url 에는 변수 참조를 쓸 수 없음'],
  );
});

test('readServer 는 env·headers 가 객체가 아니거나 args 가 문자열 배열이 아니면 이유를 돌려준다', t => {
  const bad = [
    { type: 'stdio', command: 'x', env: ['DB_PASSWORD=hunter2'] },
    { type: 'http', url: 'https://x', headers: ['Authorization: Bearer abc'] },
    { type: 'stdio', command: 'x', args: '--token abc' },
    { type: 'stdio', command: 'x', args: ['-y', 1] },
    { type: 'stdio', command: 'x', env: null },
  ];
  for (const s of bad) {
    assert.deepEqual(
      readServer(serverDir(t, JSON.stringify(s))),
      { reason: 'env·headers 는 객체, args 는 문자열 배열이어야 함' },
      JSON.stringify(s),
    );
  }
});

const BUILD = '# gitlab\n\n## 반영할 때 항목 만들기\n\n`git remote get-url origin` 에서 호스트를 뽑는다.\n';

test('readServer 는 server.json 없이 README.md 에 반영할 때 항목 만들기 절이 있으면 build 로 판정한다', t => {
  const dir = serverDir(t);
  write(dir, 'README.md', BUILD);
  assert.deepEqual(readServer(dir), { build: true });
});

test('readServer 는 README.md 에 그 절이 없으면 server.json 없음으로 둔다', t => {
  const dir = serverDir(t);
  write(dir, 'README.md', '# gitlab\n\n## 반영할 때\n\n호스트를 뽑는다.\n');
  assert.deepEqual(readServer(dir), { reason: 'server.json 없음' });
});

test('readServer 는 그 절이 비어 있으면 이유를 돌려준다', t => {
  for (const text of ['## 반영할 때 항목 만들기\n', '## 반영할 때 항목 만들기\n\n  \n## 환경 변수\n\n없음\n']) {
    const dir = serverDir(t);
    write(dir, 'README.md', text);
    assert.deepEqual(readServer(dir), { reason: 'README.md 의 「반영할 때 항목 만들기」 절이 비어 있음' }, text);
  }
});

test('readServer 는 절 제목 뒤 공백과 CRLF, 하위 절을 받아들인다', t => {
  const dir = serverDir(t);
  write(dir, 'README.md', '## 반영할 때 항목 만들기  \r\n\r\n### 어디서 읽는가\r\n\r\ngit remote\r\n');
  assert.deepEqual(readServer(dir), { build: true });
});

test('readServer 는 server.json 과 그 절이 함께 있으면 server.json 판정에 ambiguous 를 붙인다', t => {
  const http = { type: 'http', url: 'https://gitlab.example.com/api/v4/mcp' };
  const ok = serverDir(t, JSON.stringify(http));
  write(ok, 'README.md', BUILD);
  assert.deepEqual(readServer(ok), { server: http, ambiguous: true });
  const broken = serverDir(t, '{');
  write(broken, 'README.md', BUILD);
  assert.deepEqual(readServer(broken), { reason: 'server.json 을 읽을 수 없음', ambiguous: true });
});
