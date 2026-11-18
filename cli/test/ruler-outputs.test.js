import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, write } from './helpers.js';
import { otherMcpAgents, emptyMcpConfig, mcpFileOf } from '../src/ruler-outputs.js';

test('otherMcpAgents: ruler 가 고르는 에이전트 중 MCP 자리를 모르는 것', () => {
  assert.deepEqual(otherMcpAgents('default_agents = ["claude", "codex", "opencode"]\n'), { all: false, names: [] });
  assert.deepEqual(otherMcpAgents('default_agents = ["claude", "Cursor"]  # 주석\n'), { all: false, names: ['cursor'] });
  // 여러 줄 배열, [agents.<id>] enabled 가 default_agents 를 덮는다, [agents.<id>.mcp] enabled = false 는 MCP 를 쓰지 않는다
  const toml = [
    'default_agents = [',
    '  "claude",',
    '  "cursor", # 주석',
    '  "windsurf",',
    ']',
    '',
    '[agents.cursor]',
    'enabled = false',
    '[agents.copilot]',
    'enabled = true',
    '[agents.windsurf.mcp]',
    'enabled = false',
    '[agents.cline]',
    'output_path = "x"',
  ].join('\n');
  assert.deepEqual(otherMcpAgents(toml), { all: false, names: ['copilot'] });
  // default_agents 가 없거나 비면 ruler 는 enabled = false 가 아닌 모든 에이전트를 돈다
  assert.deepEqual(otherMcpAgents('nested = false\n'), { all: true, names: [] });
  assert.deepEqual(otherMcpAgents('default_agents = []\n'), { all: true, names: [] });
  // 표 안의 default_agents 는 최상위 설정이 아니다
  assert.deepEqual(otherMcpAgents('[x]\ndefault_agents = ["cursor"]\n'), { all: true, names: [] });
});

test('emptyMcpConfig: 서버도 다른 설정도 없을 때만 빈 것', t => {
  const d = tmpDir('guideline-ruler-outputs-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const empty = (rel, text) => {
    write(d, rel, text);
    return emptyMcpConfig(path.join(d, rel), mcpFileOf(rel));
  };
  assert.equal(empty('.mcp.json', '{"mcpServers": {}}'), true);
  assert.equal(empty('.mcp.json', '{"$schema": "x"}'), true);
  assert.equal(empty('.mcp.json', '{"mcpServers": {"mine": {}}}'), false);
  assert.equal(empty('.mcp.json', '{"mcpServers": {}, "other": 1}'), false);
  assert.equal(empty('.mcp.json', '{깨짐'), false);
  assert.equal(empty('.codex/config.toml', '# c\n[mcp_servers]\n\n'), true);
  assert.equal(empty('.codex/config.toml', 'model = "x"\n'), false);
  assert.equal(empty('.codex/config.toml', '[mcp_servers.a]\ncommand = "a"\n'), false);
  assert.equal(emptyMcpConfig(path.join(d, 'none.json'), mcpFileOf('.mcp.json')), false);
});
