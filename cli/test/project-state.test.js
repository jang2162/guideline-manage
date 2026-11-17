import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write, ALWAYS } from './helpers.js';
import {
  rulerAgentsEnabled, inferAgents, diskReader, itemStates, formItems, formPayload, statusTodos, kindOf,
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

test('inferAgents 는 ruler.project.toml 의 default_agents 를 읽는다', t => {
  const p = dir(t);
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  write(p, '.ruler/ruler.project.toml', 'default_agents = ["codex"]\n\n[agents]\nenabled = true\n');
  assert.deepEqual(inferAgents(p), ['codex']);
  assert.equal(rulerAgentsEnabled(p), true);
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

test('itemStates 는 스택 키를 파일로 펼쳐 상태를 내고, 잠금에 없는 새 지침 파일은 충돌이 아니라 원본 새로 나옴이다', t => {
  const { p, lock } = installed(t, 'ruler', ['rules/base/00-a.md']);
  const tree = renderTree({ 'rules/base/02-new.md': `${ALWAYS}# 새\n`, 'rules/base/sub/00-s.md': `${ALWAYS}# 에스\n` });
  const manifest = manifestOf('ruler', ['rules/base', 'rules/base/sub', 'rules/gone']);
  const { states } = itemStates({ tree, reader: diskReader(p), manifest, lock });
  assert.deepEqual([...states], [
    ['rules/base/00-a.md', 'current'],
    ['rules/base/01-b.md', 'upstream'],
    ['rules/base/02-new.md', 'upstream'],
    ['rules/base/SETUP.md', 'upstream'],
    ['rules/base/sub/00-s.md', 'upstream'],
    ['rules/gone', 'removed'],
  ]);
  assert.deepEqual(statusTodos(states).map(x => [x.kind, x.item]), [['removed-upstream', 'rules/gone']]);
});

test('고른 스택에서 원본이 뺀 파일: 손대지 않은 사본은 할 일 없는 upstream, 프로젝트에서 고친 사본은 both', t => {
  const { p, lock } = installed(t, 'ruler', ['rules/base', 'skills/s']);
  const tree = renderTree({ 'rules/base/01-b.md': null });
  const manifest = manifestOf('ruler', ['rules/base', 'skills/s']);
  const plain = itemStates({ tree, reader: diskReader(p), manifest, lock });
  assert.equal(plain.states.get('rules/base/01-b.md'), 'upstream');
  assert.equal(plain.states.get('rules/base/00-a.md'), 'current');
  assert.deepEqual(statusTodos(plain.states), []);
  write(p, 'docs/guideline/base/01-b.md', '# 고침\n');
  const edited = itemStates({ tree, reader: diskReader(p), manifest, lock });
  assert.equal(edited.states.get('rules/base/01-b.md'), 'both');
  assert.deepEqual(statusTodos(edited.states), []);
});

test('원본에서 통째로 사라진 하위 스택의 파일은 부모 스택이 있어도 upstream 이 아니라 그 스택 키의 removed 로만 보인다', t => {
  const sub = { 'rules/base/sub/00-s.md': `${ALWAYS}# 에스\n` };
  const p = dir(t);
  const manifest = manifestOf('ruler', ['rules/base', 'rules/base/sub']);
  const r = render({ tree: renderTree(sub), revision: 1, manifest, lock: null, project: diskReader(p) });
  applyFiles(p, r.files);
  const { states } = itemStates({ tree: renderTree(), reader: diskReader(p), manifest, lock: r.lock });
  assert.equal(states.get('rules/base/sub'), 'removed');
  assert.equal(states.has('rules/base/sub/00-s.md'), false);
});

test('formItems 는 잠금 항목을 잠금 상태로 바꾸고 원본에서 사라진 항목을 추가하며 잠금 출력의 고아는 뺀다', t => {
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
  assert.equal(payload.formVersion, 2, '폼 본문은 스택 단위 선택을 아는 폼(formVersion 2)이라고 알린다');
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
  assert.deepEqual(statusTodos(states).map(x => x.kind), ['conflict']);
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
  assert.deepEqual([s.state, s.reason], ['blocked', '중첩 디렉터리에서는 받을 수 없음 — git 루트에서 받아야 함']);
  assert.equal(items.find(i => i.id === 'rules/base/00-a.md').state, 'missing');
  assert.ok(desiredOutputs);
});

test('formItems 는 원본에서 통째로 사라진 스택(하위 스택 포함)을 스택 칸을 채워 올린다', t => {
  const sub = { 'rules/gone/00-g.md': `${ALWAYS}# 지\n`, 'rules/base/sub/00-s.md': `${ALWAYS}# 에스\n` };
  const p = dir(t);
  const manifest = manifestOf('ruler', ['rules/base', 'rules/base/sub', 'rules/gone']);
  const r = render({ tree: renderTree(sub), revision: 1, manifest, lock: null, project: diskReader(p) });
  applyFiles(p, r.files);
  const { items } = formItems({ tree: renderTree(), project: p, manifest, lock: r.lock, reader: diskReader(p) });
  const removed = items.filter(i => i.lockState === 'removed');
  assert.deepEqual(removed, [
    { kind: 'rule', id: 'rules/base/sub', stack: 'base/sub', state: 'present', lockState: 'removed' },
    { kind: 'rule', id: 'rules/gone', stack: 'gone', state: 'present', lockState: 'removed' },
  ]);
});

/** 새 배치(.guideline/ 사본)로 렌더링해 디스크에 쓴 프로젝트와 그 잠금(version 3). */
function installedGuide(t, items = ALL) {
  const p = dir(t);
  const manifest = manifestOf('ruler', items);
  const r = render({ tree: renderTree(), revision: 1, manifest, lock: null, project: diskReader(p), layout: 'guideline' });
  applyFiles(p, r.files);
  return { p, manifest, lock: r.lock };
}

test('새 배치: 사본을 고치면 status 가 local 이다', t => {
  const { p, manifest, lock } = installedGuide(t);
  assert.equal(lock.version, 3);
  write(p, '.guideline/rules/base/00-a.md', `${ALWAYS}# 에이\n\n프로젝트에서 고침\n`);
  const tree = renderTree({ [`rules/${DEPLOY}/01-y.md`]: `${ALWAYS}# 와이\n\n새 본문\n` });
  write(p, `.guideline/rules/${DEPLOY}/01-y.md`, '# 고침\n');
  const { states, outputs } = itemStates({ tree, reader: diskReader(p), manifest, lock });
  assert.equal(states.get('rules/base/00-a.md'), 'local');
  assert.equal(states.get('rules/base/01-b.md'), 'current');
  assert.equal(states.get(`rules/${DEPLOY}/01-y.md`), 'both');
  assert.equal(states.get('skills/s'), 'current');
  assert.equal(outputs.find(o => o.path === '.guideline/rules/base/00-a.md').state, 'local');
});

test('새 배치: 사본이 최신 원본과 같으면(제안이 수락된 뒤) 원본 새로 나옴이지 둘 다 바뀜이 아니다', t => {
  const { p, manifest, lock } = installedGuide(t);
  // 사본은 원본 모양 그대로라, 수락된 원본과 바이트가 같다(frontmatter 포함)
  const accepted = `${ALWAYS}# 에이\n\n수락된 본문\n`;
  write(p, '.guideline/rules/base/00-a.md', accepted);
  const { states } = itemStates({ tree: renderTree({ 'rules/base/00-a.md': accepted }), reader: diskReader(p), manifest, lock });
  assert.equal(states.get('rules/base/00-a.md'), 'upstream');
});

test('새 배치: 폼은 .guideline 사본으로 같음·다름·없음을 내고 차이는 사본 기준이다', t => {
  const { p, manifest, lock } = installedGuide(t, ['rules/base/00-a.md', 'rules/base/01-b.md', 'skills/s', 'agents/rev.md', 'mcp/c7']);
  write(p, '.guideline/rules/base/00-a.md', `${ALWAYS}# 에이\n\n고친 본문\n`);
  // 조합한 생성물(.ruler/)은 판정에 쓰지 않는다
  write(p, '.ruler/base/00-a.md', '# 에이\n');
  const payload = formPayload({
    tree: renderTree(), revision: 1, projectPath: p, isNew: false, agents: ['claude'],
    status: { gitRepo: true, dirty: false }, manifest, lock, layout: 'guideline',
  });
  const by = id => payload.items.find(i => i.id === id);
  assert.deepEqual([by('rules/base/00-a.md').state, by('rules/base/00-a.md').lockState, by('rules/base/00-a.md').where],
    ['different', 'local', ['.guideline/rules/base/00-a.md']]);
  assert.equal(by('rules/base/01-b.md').state, 'same');
  assert.equal(by('skills/s').state, 'same');
  assert.equal(by('agents/rev.md').state, 'same');
  assert.equal(by('mcp/c7').state, 'same');
  assert.equal(by(`rules/${DEPLOY}/00-x.md`).state, 'missing');
  assert.equal(by('mcp/gl').state, 'missing');
  const diff = payload.diffs['rule:rules/base/00-a.md'].files[0];
  assert.equal(diff.path, '.guideline/rules/base/00-a.md');
  assert.match(diff.diff, /\+고친 본문/);
  // 사본은 원본 모양이라 frontmatter 는 차이가 아니다
  assert.doesNotMatch(diff.diff, /load: always/);
  assert.equal(payload.items.some(i => i.kind === 'orphan'), false);
});

test('새 배치: 원본에서 사라진 스킬은 잠금이 아는 사본이라 고아가 아니라 원본에서 사라짐으로 올라간다', t => {
  const { p, manifest, lock } = installedGuide(t, ['rules/base/00-a.md', 'skills/s']);
  const tree = renderTree({ 'skills/s/SKILL.md': null, 'skills/s/img/a.png': null });
  const { items } = formItems({ tree, project: p, manifest, lock, reader: diskReader(p), layout: 'guideline' });
  assert.deepEqual(items.filter(i => i.kind === 'orphan'), []);
  assert.equal(items.find(i => i.id === 'skills/s').lockState, 'removed');
});
