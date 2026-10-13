import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tomlKey, tomlValue, tableText, parseKeyPath, tableSlice, setTable } from '../src/toml-table.js';

test('키와 값', () => {
  assert.equal(tomlKey('mcp_servers'), 'mcp_servers');
  assert.equal(tomlKey('a.b'), '"a.b"');
  assert.equal(tomlValue('줄\n"따옴표"'), '"줄\\n\\"따옴표\\""');
  assert.equal(tomlValue(['-y', 'c7']), '["-y", "c7"]');
  assert.equal(tomlValue({ A: '1', 'X-H': 'v' }), '{ A = "1", X-H = "v" }');
  assert.equal(tomlValue({}), '{}');
  assert.equal(tomlValue(true), 'true');
});

test('tableText 는 머리 줄과 키 줄을 쓴다', () => {
  assert.equal(tableText(['mcp_servers', 'c7'], { command: 'npx', args: ['-y', 'c7'], env: { A: '1' }, none: undefined }),
    '[mcp_servers.c7]\ncommand = "npx"\nargs = ["-y", "c7"]\nenv = { A = "1" }\n');
});

test('parseKeyPath 는 따옴표 안의 점을 나누지 않는다', () => {
  assert.deepEqual(parseKeyPath('agents.codex.mcp_servers."a.b"'), ['agents', 'codex', 'mcp_servers', 'a.b']);
  assert.deepEqual(parseKeyPath(" mcp_servers . 'x' "), ['mcp_servers', 'x']);
});

const DOC = [
  '# 머리 주석',
  'default_agents = ["claude"]',
  '',
  '[gitignore]',
  'enabled = true',
  '',
  '# 다른 서버',
  '[mcp_servers."other"]',
  'command = "o"',
  '',
  '[mcp_servers.c7]',
  'command = "old"',
  '',
  '[agents]',
  'enabled = false',
  '',
].join('\n');

test('tableSlice 는 그 표만 돌려준다(따옴표 머리도 알아본다)', () => {
  assert.equal(tableSlice(DOC, ['mcp_servers', 'c7']), '[mcp_servers.c7]\ncommand = "old"\n');
  assert.equal(tableSlice(DOC, ['mcp_servers', 'other']), '[mcp_servers."other"]\ncommand = "o"\n');
  assert.equal(tableSlice(DOC, ['mcp_servers', 'none']), null);
});

test('setTable 은 그 표만 바꾸고 다른 표·주석은 그대로 둔다', () => {
  const r = setTable(DOC, ['mcp_servers', 'c7'], { command: 'npx' });
  assert.equal(r.text, DOC.replace('[mcp_servers.c7]\ncommand = "old"', '[mcp_servers.c7]\ncommand = "npx"'));
});

test('setTable 은 없으면 끝에 빈 줄 하나 뒤에 추가한다', () => {
  const r = setTable('a = 1\n\n\n', ['mcp_servers', 'x'], { url: 'u' });
  assert.equal(r.text, 'a = 1\n\n[mcp_servers.x]\nurl = "u"\n');
  assert.equal(setTable('', ['mcp_servers', 'x'], { url: 'u' }).text, '[mcp_servers.x]\nurl = "u"\n');
});

test('setTable(null) 은 표를 지우고 없으면 그대로 둔다', () => {
  assert.equal(setTable(DOC, ['mcp_servers', 'c7'], null).text, DOC.replace('[mcp_servers.c7]\ncommand = "old"\n\n', ''));
  assert.equal(setTable(DOC, ['mcp_servers', 'none'], null).text, DOC);
});

test('같은 표가 둘이거나 인라인 표면 conflict', () => {
  const twice = '[mcp_servers.x]\na = 1\n\n[mcp_servers.x]\na = 2\n';
  assert.match(setTable(twice, ['mcp_servers', 'x'], { a: 3 }).conflict, /둘 이상/);
  const inline = '[mcp_servers]\nx = { command = "a" }\n';
  assert.match(setTable(inline, ['mcp_servers', 'x'], { a: 3 }).conflict, /인라인/);
  const dotted = 'mcp_servers.x = { command = "a" }\n';
  assert.match(setTable(dotted, ['mcp_servers', 'x'], { a: 3 }).conflict, /인라인/);
  assert.equal(tableSlice(twice, ['mcp_servers', 'x']), null);
});

test('[[배열 표]] 아래 키는 표 안으로 치지 않는다', () => {
  const doc = '[[mcp_servers]]\nx = { a = 1 }\n';
  assert.equal(setTable(doc, ['mcp_servers', 'x'], { a: 2 }).text, `${doc}\n[mcp_servers.x]\na = 2\n`);
});

test('다음 표 바로 위의 주석은 다음 표의 몫이라 바꾸거나 지워도 남는다', () => {
  const doc = '[mcp_servers.c7]\ncommand = "npx"\n\n# GitHub server — keep this comment\n[mcp_servers.github]\ncommand = "gh"\n';
  const up = setTable(doc, ['mcp_servers', 'c7'], { command: 'bunx' }).text;
  assert.equal(up, '[mcp_servers.c7]\ncommand = "bunx"\n\n# GitHub server — keep this comment\n[mcp_servers.github]\ncommand = "gh"\n');
  const del = setTable(doc, ['mcp_servers', 'c7'], null).text;
  assert.equal(del, '# GitHub server — keep this comment\n[mcp_servers.github]\ncommand = "gh"\n');
  assert.equal(tableSlice(doc, ['mcp_servers', 'c7']), '[mcp_servers.c7]\ncommand = "npx"\n');
});

test('하위 표가 있는 표는 바꾸지 않고 충돌로 낸다', () => {
  const doc = '[mcp_servers.c7]\ncommand = "npx"\n\n[mcp_servers.c7.env]\nA = "1"\n';
  assert.ok(setTable(doc, ['mcp_servers', 'c7'], { command: 'npx', env: { A: '2' } }).conflict);
  assert.ok(setTable(doc, ['mcp_servers', 'c7'], null).conflict);
});
