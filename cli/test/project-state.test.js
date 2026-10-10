import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write, ALWAYS } from './helpers.js';
import {
  rulerAgentsEnabled, inferAgents, diskReader, itemStates, newFiles, formItems, formPayload, statusTodos, kindOf,
} from '../src/project-state.js';
import { render } from '../src/render/index.js';
import { desiredOutputs } from '../src/render/outputs.js';
import { stripFrontmatter } from '../src/inspect.js';
import { applyFiles } from '../src/apply.js';
import { DEPLOY, ALL, renderTree, manifestOf } from './render-fixture.js';

function dir(t) {
  const d = tmpDir('guideline-state-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** 렌더링해 디스크에 쓴 프로젝트와 그 잠금. */
function installed(t, form = 'ruler', items = ALL, extra = {}) {
  const p = dir(t);
  const manifest = manifestOf(form, items, extra);
  const r = render({ tree: renderTree(), revision: 1, manifest, lock: null, project: diskReader(p) });
  applyFiles(p, r.files);
  return { p, manifest, lock: r.lock };
}

test('rulerAgentsEnabled 와 inferAgents', t => {
  const p = dir(t);
  write(p, '.ruler/ruler.toml', 'default_agents = ["codex"]\n\n[agents.claude]\nenabled = true\n');
  assert.equal(rulerAgentsEnabled(p), false);
  assert.deepEqual(inferAgents(p), ['codex']);
  write(p, '.ruler/ruler.toml', '[agents]\nenabled = true # 실험\n');
  assert.equal(rulerAgentsEnabled(p), true);
  assert.deepEqual(inferAgents(p), ['claude', 'codex']);
});

test('kindOf', () => {
  assert.deepEqual(['rules/base/SETUP.md', 'rules/base/00-a.md', 'skills/s', 'agents/rev.md', 'mcp/c7'].map(kindOf), ['setup', 'rule', 'skill', 'subagent', 'mcp']);
});

test('itemStates 는 잠금 기준 일곱 상태를 가린다', t => {
  const { p, manifest, lock } = installed(t);
  write(p, '.ruler/base/00-a.md', '# 프로젝트에서 고침\n');
  write(p, `.ruler/${DEPLOY}/01-y.md`, '# 고침\n');
  fs.rmSync(`${p}/docs/guideline/base/SETUP.md`);
  const tree = renderTree({
    'rules/base/01-b.md': `---\nload: reference\nwhen: "비 작업을 할 때"\n---\n\n# 새 비\n`,
    [`rules/${DEPLOY}/01-y.md`]: `${ALWAYS}# 와이\n\n새 본문\n`,
    'skills/s/SKILL.md': null,
    'skills/s/img/a.png': null,
  });
  const { states, outputs } = itemStates({ tree, reader: diskReader(p), manifest, lock });
  assert.equal(states.get('rules/base/00-a.md'), 'local');
  assert.equal(states.get('rules/base/01-b.md'), 'upstream');
  assert.equal(states.get('rules/base/SETUP.md'), 'gone');
  assert.equal(states.get(`rules/${DEPLOY}/01-y.md`), 'both');
  assert.equal(states.get('skills/s'), 'removed');
  assert.equal(states.get('mcp/c7'), 'current');
  assert.equal(outputs.find(o => o.path === '.ruler/guideline.md').state, 'current');
});

test('newFiles 는 고른 스택의 고르지 않은 지침 파일·세팅 문서', () => {
  const tree = renderTree({ 'rules/base/02-new.md': `${ALWAYS}# 새\n` });
  assert.deepEqual(newFiles(tree, manifestOf('ruler', ['rules/base/00-a.md'])), ['rules/base/01-b.md', 'rules/base/02-new.md', 'rules/base/SETUP.md']);
  assert.deepEqual(newFiles(tree, manifestOf('ruler', ['skills/s'])), []);
});

test('formItems 는 잠금 항목을 잠금 상태로 바꾸고 원본에서 사라진 항목을 더하며 잠금 출력의 고아는 뺀다', t => {
  const { p, manifest, lock } = installed(t);
  write(p, '.ruler/base/00-a.md', '# 고침\n');
  const tree = renderTree({ 'rules/base/01-b.md': null });
  const { items } = formItems({ tree, project: p, manifest, lock, reader: diskReader(p) });
  const by = id => items.find(i => i.id === id);
  assert.deepEqual([by('rules/base/00-a.md').state, by('rules/base/00-a.md').lockState], ['different', 'local']);
  assert.deepEqual([by('mcp/c7').state, by('mcp/c7').lockState], ['same', 'current']);
  assert.deepEqual(by('rules/base/01-b.md'), { kind: 'rule', id: 'rules/base/01-b.md', stack: 'base', state: 'present', lockState: 'removed' });
  assert.equal(items.some(i => i.kind === 'orphan' && i.id === 'docs/guideline/base/01-b.md'), false);
});

test('formPayload 는 MCP 값을 싣지 않고 큰 차이는 생략한다', t => {
  const p = dir(t);
  write(p, '.ruler/ruler.toml', '');
  write(p, '.mcp.json', JSON.stringify({ mcpServers: { c7: { command: 'npx', args: ['-y', 'c7'], env: { TOKEN: 'hunter2' } } } }));
  write(p, '.ruler/base/00-a.md', `${'긴 줄\n'.repeat(30000)}`);
  const payload = formPayload({
    tree: renderTree(), revision: 1, projectPath: p, isNew: false, agents: ['claude'],
    status: { gitRepo: true, dirty: false }, manifest: null, lock: null,
  });
  const text = JSON.stringify(payload);
  assert.equal(text.includes('hunter2'), false);
  assert.deepEqual(payload.diffs['mcp:mcp/c7'], { keys: ['env 프로젝트에만 있음'] });
  assert.equal(payload.diffs['rule:rules/base/00-a.md'].files[0].diff, '너무 커서 생략');
  assert.equal(payload.project.name, p.split('/').at(-1));
  assert.deepEqual([payload.project.form, payload.project.nested, payload.project.rootStacks], ['ruler', false, []]);
});

test('첫 반영에서 충돌한 항목은 최신이 아니라 「반영 안 됨」 이고, 폼에는 0.10 판정으로 다시 나온다', t => {
  const p = dir(t);
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  write(p, '.ruler/skills/s/SKILL.md', '---\nname: s\ndescription: 스\n---\n\n프로젝트 본문\n');
  const manifest = manifestOf('ruler', ['skills/s'], { agents: ['claude'] });
  const r = render({ tree: renderTree(), revision: 1, manifest, lock: null, project: diskReader(p), decisions: { 'skills/s': { action: 'keep', state: 'different' } } });
  assert.ok(r.todos.some(x => x.kind === 'conflict' && x.item === 'skills/s'));
  assert.equal('skills/s' in r.lock.sources, false);
  applyFiles(p, r.files);
  const { states } = itemStates({ tree: renderTree(), reader: diskReader(p), manifest, lock: r.lock });
  assert.equal(states.get('skills/s'), 'unsynced');
  assert.deepEqual(statusTodos(states, []).map(x => x.kind), ['conflict']);
  const item = formItems({ tree: renderTree(), project: p, manifest, lock: r.lock, reader: diskReader(p) }).items.find(i => i.id === 'skills/s');
  assert.equal(item.state, 'different');
  assert.equal(item.lockState, undefined);
});

test('수락돼 원본이 사본과 같아지면 「원본 새로 나옴」 이지 「둘 다 바뀜」 이 아니다', t => {
  const { p, manifest, lock } = installed(t);
  const next = `${ALWAYS}# 에이\n\n프로젝트에서 다듬은 본문\n`;
  write(p, '.ruler/base/00-a.md', stripFrontmatter(next));
  const { states } = itemStates({ tree: renderTree({ 'rules/base/00-a.md': next }), reader: diskReader(p), manifest, lock });
  assert.equal(states.get('rules/base/00-a.md'), 'upstream');
});

test('중첩이면 formItems 가 루트 전용 항목을 막는다', t => {
  const p = dir(t);
  write(p, '.ruler/ruler.toml', '');
  const { items } = formItems({ tree: renderTree(), project: p, manifest: null, lock: null, reader: diskReader(p), nested: true });
  const s = items.find(i => i.id === 'skills/s');
  assert.deepEqual([s.state, s.reason], ['blocked', '중첩 디렉터리에서는 받지 않는다 — git 루트에서 받는다']);
  assert.equal(items.find(i => i.id === 'rules/base/00-a.md').state, 'missing');
  assert.ok(desiredOutputs);
});
