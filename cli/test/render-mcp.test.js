import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexEntry, needsAgentTables, stableJson } from '../src/render/mcp.js';

test('codexEntry 는 0.10 의 Codex 변환 표를 따른다', () => {
  const server = {
    type: 'http',
    url: 'https://g/mcp',
    env: { TOKEN: '${TOKEN}', MODE: 'prod' },
    headers: { Authorization: 'Bearer ${GITLAB_TOKEN}', 'X-A': '${A_KEY}', 'X-F': 'fixed' },
  };
  assert.deepEqual(codexEntry(server), {
    url: 'https://g/mcp',
    env_vars: ['TOKEN'],
    env: { MODE: 'prod' },
    bearer_token_env_var: 'GITLAB_TOKEN',
    env_http_headers: { 'X-A': 'A_KEY' },
    http_headers: { 'X-F': 'fixed' },
  });
  assert.deepEqual(codexEntry({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }), { command: 'npx', args: ['-y', 'c7'] });
});

test('needsAgentTables 는 변수 참조나 headers 가 있으면 참', () => {
  assert.equal(needsAgentTables({ type: 'stdio', command: 'npx' }), false);
  assert.equal(needsAgentTables({ type: 'stdio', command: 'x', env: { A: '${A}' } }), true);
  assert.equal(needsAgentTables({ type: 'http', url: 'u', headers: { H: 'fixed' } }), true);
});

test('stableJson 은 키를 정렬한다(중첩 포함)', () => {
  assert.equal(stableJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } }), '{"a":{"c":3,"d":[2,{"y":2,"z":1}]},"b":1}');
});
