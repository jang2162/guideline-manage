import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDefaultAgents, setDefaultAgents, agentsMismatch } from '../src/agents.js';

// ruler.project.toml 의 default_agents 한 줄을 읽고 바꾼다. 다른 줄은 바이트 그대로 둔다.

test('readDefaultAgents 는 한 줄 배열의 이름을 순서대로, 중복 없이 읽는다', () => {
  assert.deepEqual(readDefaultAgents('default_agents = ["claude", "codex"]\nnested = false\n'), { agents: ['claude', 'codex'], ok: true });
  assert.deepEqual(readDefaultAgents("default_agents = ['codex', \"claude\", 'codex'] # c\n"), { agents: ['codex', 'claude'], ok: true });
});

test('readDefaultAgents 는 줄이 없거나 글이 없으면 agents null, ok', () => {
  assert.deepEqual(readDefaultAgents('nested = false\n'), { agents: null, ok: true });
  assert.deepEqual(readDefaultAgents(null), { agents: null, ok: true });
});

test('readDefaultAgents 는 표 안의 default_agents 를 최상위 것으로 읽지 않는다', () => {
  assert.deepEqual(readDefaultAgents('nested = false\n\n[agents.claude]\ndefault_agents = ["codex"]\n'), { agents: null, ok: true });
});

test('readDefaultAgents 는 여러 줄 배열이면 ok false', () => {
  assert.deepEqual(readDefaultAgents('default_agents = [\n  "claude",\n]\n'), { agents: null, ok: false });
});

test('setDefaultAgents 는 그 한 줄만 정렬한 배열로 바꾼다', () => {
  const before = '# c\ndefault_agents = ["claude"]\nnested = false\n\n[agents.claude]\noutput_path = "AGENTS.md"\n';
  assert.equal(
    setDefaultAgents(before, ['codex', 'claude']),
    '# c\ndefault_agents = ["claude", "codex"]\nnested = false\n\n[agents.claude]\noutput_path = "AGENTS.md"\n',
  );
});

test('setDefaultAgents 는 CRLF 줄끝과 줄 끝 주석을 지킨다', () => {
  assert.equal(
    setDefaultAgents('default_agents = ["claude"] # 고른 것\r\nnested = false\r\n', ['codex']),
    'default_agents = ["codex"] # 고른 것\r\nnested = false\r\n',
  );
});

test('setDefaultAgents 는 줄이 없거나 여러 줄 배열이면 null', () => {
  assert.equal(setDefaultAgents('nested = false\n', ['claude']), null);
  assert.equal(setDefaultAgents('default_agents = [\n  "claude",\n]\n', ['claude']), null);
});

test('agentsMismatch 는 집합이 다를 때만 true, toml 쪽이 없으면 false', () => {
  assert.equal(agentsMismatch(['claude', 'codex'], ['codex', 'claude']), false);
  assert.equal(agentsMismatch(['claude'], ['claude', 'codex']), true);
  assert.equal(agentsMismatch(['claude'], null), false);
});

test('앞 키의 여러 줄 배열 안에 [ 로 시작하는 줄이 있어도 최상위 default_agents 를 찾는다(리뷰 4)', () => {
  const text = 'foo = [\n  ["a"],\n  ["b"]\n]\ndefault_agents = ["claude"]\n\n[agents.claude]\nenabled = true\n';
  assert.deepEqual(readDefaultAgents(text), { agents: ['claude'], ok: true });
  assert.equal(setDefaultAgents(text, ['claude', 'opencode']), text.replace('["claude"]', '["claude", "opencode"]'));
});

test('주석이 붙은 표 머리와 배열 표 머리 뒤의 default_agents 는 최상위가 아니다', () => {
  assert.deepEqual(readDefaultAgents('nested = false\n[gitignore] # 주석\ndefault_agents = ["codex"]\n'), { agents: null, ok: true });
  assert.deepEqual(readDefaultAgents('[[x.y]]\ndefault_agents = ["codex"]\n'), { agents: null, ok: true });
});
