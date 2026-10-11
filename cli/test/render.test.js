import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, currentPart } from '../src/render/index.js';
import { RULER_TOML_BASE } from '../src/render/outputs.js';
import { tableText } from '../src/toml-table.js';
import { codexEntry } from '../src/render/mcp.js';
import { sha256 } from '../src/hashes.js';
import { lockText } from '../src/manifest.js';
import { ALWAYS } from './helpers.js';
import { DEPLOY, ALL, renderTree, manifestOf, memProject, applyMem } from './render-fixture.js';

const C7 = { type: 'stdio', command: 'npx', args: ['-y', 'c7'] };
const GL = { type: 'http', url: 'https://g/mcp', headers: { Authorization: 'Bearer ${GITLAB_TOKEN}' } };
const text = (r, p) => r.files[p].toString();
const kinds = r => r.todos.map(t => t.kind).sort();

/** 새 ruler 프로젝트에 ALL 을 반영한 결과와 그 뒤의 프로젝트. */
function firstRuler() {
  const r = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ALL), lock: null, project: memProject() });
  return { r, files: applyMem({}, r.files) };
}

test('새 ruler 프로젝트: 모든 출력을 쓰고 ruler.toml 을 만든다', () => {
  const { r } = firstRuler();
  assert.equal(text(r, '.ruler/ruler.toml'), [
    RULER_TOML_BASE(['claude', 'codex']).trimEnd(),
    tableText(['mcp_servers', 'c7'], C7).trimEnd(),
    tableText(['agents', 'claude', 'mcp_servers', 'gl'], GL).trimEnd(),
    tableText(['agents', 'codex', 'mcp_servers', 'gl'], codexEntry(GL)).trimEnd(),
  ].join('\n\n') + '\n');
  assert.equal(text(r, '.ruler/base/00-a.md'), '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n');
  assert.equal(r.lock.revision, 5);
  assert.deepEqual(Object.keys(r.lock.sources).sort(), [...ALL].sort());
  assert.equal(r.lock.outputs.length, 14);
  assert.deepEqual(kinds(r), ['env', 'mcp-build', 'setup', 'subagents-off']);
});

test('같은 원본으로 다시 하면 아무것도 쓰지 않고 잠금이 같다', () => {
  const { r, files } = firstRuler();
  const again = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(files) });
  assert.deepEqual(again.files, {});
  assert.deepEqual(again.lock, r.lock);
  assert.ok(!kinds(again).includes('setup'), '세팅 문서가 그대로면 setup 할 일이 없다');
});

test('원본이 새로 나오면 그 파일만 다시 쓰고 원본 해시를 바꾼다', () => {
  const { r, files } = firstRuler();
  const tree = renderTree({ 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n` });
  const next = render({ tree, revision: 6, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(files) });
  assert.deepEqual(Object.keys(next.files), ['.ruler/base/00-a.md']);
  assert.equal(text(next, '.ruler/base/00-a.md'), '# 에이\n\n새 본문\n');
  assert.notEqual(next.lock.sources['rules/base/00-a.md'], r.lock.sources['rules/base/00-a.md']);
});

test('프로젝트에서 고친 파일은 건너뛰고, overwrite·force 면 덮어쓴다', () => {
  const { r, files } = firstRuler();
  const edited = applyMem(files, { '.ruler/base/00-a.md': '# 고침\n' });
  const tree = renderTree({ 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n` });
  const args = { tree, revision: 6, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(edited) };
  const skip = render(args);
  assert.equal(skip.files['.ruler/base/00-a.md'], undefined);
  assert.ok(kinds(skip).includes('skipped'));
  const prev = r.lock.outputs.find(o => o.path === '.ruler/base/00-a.md');
  assert.deepEqual(skip.lock.outputs.find(o => o.path === '.ruler/base/00-a.md'), prev);
  assert.equal(skip.lock.sources['rules/base/00-a.md'], r.lock.sources['rules/base/00-a.md']);
  const over = render({ ...args, decisions: { 'rules/base/00-a.md': { action: 'keep', overwrite: true } } });
  assert.equal(text(over, '.ruler/base/00-a.md'), '# 에이\n\n새 본문\n');
  assert.equal(text(render({ ...args, force: true }), '.ruler/base/00-a.md'), '# 에이\n\n새 본문\n');
});

test('CRLF 로 체크아웃된 같은 사본은 고친 것으로 보지 않는다', () => {
  const crlf = { '.ruler/base/00-a.md': '# 에이\r\n\r\n## 절 하나\r\n\r\n본문 A\r\n\r\n### 아래\r\n\r\n깊이\r\n' };
  const r = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject(crlf) });
  assert.equal(r.files['.ruler/base/00-a.md'], undefined);
  const out = r.lock.outputs.find(o => o.path === '.ruler/base/00-a.md');
  assert.equal(out.hash, sha256('# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n'));
  assert.equal(out.hash, sha256(currentPart(memProject(crlf), out)));
});

test('잠금 없이 다른 지침 사본은 쓰지 않고 「프로젝트에서 고침」 으로 올리고, 갱신을 켜면 쓴다', () => {
  const old = { '.ruler/base/00-a.md': '# 옛 사본\n' };
  const args = { tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject(old) };
  const r = render(args);
  assert.equal(r.files['.ruler/base/00-a.md'], undefined);
  const out = r.lock.outputs.find(o => o.path === '.ruler/base/00-a.md');
  assert.notEqual(out.hash, sha256('# 옛 사본\n'));
  const upd = render({ ...args, decisions: { 'rules/base/00-a.md': { action: 'update' } } });
  assert.match(text(upd, '.ruler/base/00-a.md'), /본문 A/);
});

test('잠금 없이 다른 스킬 파일은 conflict 할 일이고 잠금에 올리지 않는다', () => {
  const r = render({
    tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['skills/s']), lock: null,
    project: memProject({ '.ruler/skills/s/SKILL.md': '다른 스킬\n' }),
  });
  assert.equal(r.files['.ruler/skills/s/SKILL.md'], undefined);
  assert.deepEqual([...r.files['.ruler/skills/s/img/a.png']], [1, 2, 3]);
  assert.ok(kinds(r).includes('conflict'));
  assert.equal(r.lock.outputs.some(o => o.path === '.ruler/skills/s/SKILL.md'), false);
});

test('매니페스트에서 뺀 항목은 잠금에 있는 출력만 지운다', () => {
  const { r, files } = firstRuler();
  const items = ALL.filter(i => i !== 'skills/s' && i !== 'mcp/c7');
  const withExtra = applyMem(files, { '.ruler/skills/s/notes.md': '프로젝트 메모\n' });
  const next = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', items), lock: r.lock, project: memProject(withExtra) });
  assert.equal(next.files['.ruler/skills/s/SKILL.md'], null);
  assert.equal(next.files['.ruler/skills/s/img/a.png'], null);
  assert.equal(next.files['.ruler/skills/s/notes.md'], undefined);
  assert.doesNotMatch(text(next, '.ruler/ruler.toml'), /mcp_servers\.c7/);
  assert.match(text(next, '.ruler/ruler.toml'), /agents\.codex\.mcp_servers\.gl/);
  assert.equal(next.lock.sources['skills/s'], undefined);
});

test('원본에서 사라진 항목은 그대로 두고 removed-upstream 할 일을 낸다', () => {
  const { r, files } = firstRuler();
  const tree = renderTree({ 'skills/s/SKILL.md': null, 'skills/s/img/a.png': null });
  const next = render({ tree, revision: 6, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(files) });
  assert.equal(next.files['.ruler/skills/s/SKILL.md'], undefined);
  assert.ok(kinds(next).includes('removed-upstream'));
  assert.equal(next.lock.sources['skills/s'], r.lock.sources['skills/s']);
  assert.equal(next.lock.outputs.filter(o => o.items.includes('skills/s')).length, 2);
});

test('ruler.toml 의 다른 표와 주석을 보존한다', () => {
  const toml = '# 사용자 설정\ndefault_agents = ["claude"]\n\n[mcp_servers.other]\ncommand = "o"\n';
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', ['mcp/c7'], { agents: ['claude'] }),
    lock: null, project: memProject({ '.ruler/ruler.toml': toml }),
  });
  assert.equal(text(r, '.ruler/ruler.toml'), `${toml}\n${tableText(['mcp_servers', 'c7'], C7)}`);
});

test('orphans 는 지운다', () => {
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', []), lock: null,
    project: memProject({ 'docs/guideline/old/00-z.md': 'x' }), orphans: ['docs/guideline/old/00-z.md'],
  });
  assert.equal(r.files['docs/guideline/old/00-z.md'], null);
});

test('잠금 없이 체크를 푼 항목: 원본으로 만든 것과 같은 사본은 지우고, 다르면 지우지 않고 할 일로 남긴다', () => {
  // 0.10 방식으로 받은 프로젝트: 잠금이 없고 사본만 있다.
  const files = {
    '.ruler/base/00-a.md': '# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n',
    'docs/guideline/base/01-b.md': '# 비\n\n프로젝트에서 고친 본문\n',
  };
  const keep = ALL.filter(i => i !== 'rules/base/00-a.md' && i !== 'rules/base/01-b.md');
  const decisions = {
    'rules/base/00-a.md': { action: 'remove', state: 'same' },
    'rules/base/01-b.md': { action: 'remove', state: 'different' },
  };
  const r = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', keep), lock: null, project: memProject(files), decisions });
  assert.equal(r.files['.ruler/base/00-a.md'], null);
  assert.equal('docs/guideline/base/01-b.md' in r.files, false);
  const left = r.todos.filter(t => t.kind === 'leftover');
  assert.deepEqual(left.map(t => t.item), ['rules/base/01-b.md']);
  assert.match(left[0].message, /docs\/guideline\/base\/01-b\.md/);
  assert.equal(r.lock.outputs.some(o => o.items.includes('rules/base/00-a.md') || o.items.includes('rules/base/01-b.md')), false);
});

test('이름에 . 이 든 MCP 는 TOML 에 따옴표 친 키로 쓰고, 다시 하면 아무것도 바뀌지 않는다', () => {
  const tree = renderTree({ 'mcp/dep.x/server.json': JSON.stringify({ type: 'stdio', command: 'npx', args: ['dep'] }) });
  const manifest = manifestOf('ruler', ['mcp/dep.x']);
  const r = render({ tree, revision: 1, manifest, lock: null, project: memProject() });
  assert.match(text(r, '.ruler/ruler.toml'), /^\[mcp_servers\."dep\.x"\]$/m);
  const again = render({ tree, revision: 1, manifest, lock: r.lock, project: memProject(applyMem({}, r.files)) });
  assert.deepEqual(again.files, {});
  assert.deepEqual(kinds(again), []);
});

test('원본 스킬이 CRLF 여도, 프로젝트의 .sh 가 CRLF 여도 다시 하면 바뀐 것 없음', () => {
  const tree = renderTree({ 'skills/s/SKILL.md': '---\r\nname: s\r\ndescription: 스\r\n---\r\n\r\n본문\r\n', 'skills/s/run.sh': 'echo a\n' });
  const manifest = manifestOf('ruler', ['skills/s']);
  const r = render({ tree, revision: 1, manifest, lock: null, project: memProject() });
  const files = applyMem(applyMem({}, r.files), { '.ruler/skills/s/run.sh': 'echo a\r\n' });
  const again = render({ tree, revision: 1, manifest, lock: r.lock, project: memProject(files) });
  assert.deepEqual(again.files, {});
  assert.deepEqual(kinds(again), []);
});

test('잠금 없이 체크를 푼 스킬: 파일 하나라도 다르면 아무것도 지우지 않고 할 일 하나로 남긴다', () => {
  const files = {
    '.ruler/skills/s/SKILL.md': '---\nname: s\ndescription: 스\n---\n\n고친 본문\n',
    '.ruler/skills/s/img/a.png': Buffer.from([1, 2, 3]),
  };
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', []), lock: null, project: memProject(files),
    decisions: { 'skills/s': { action: 'remove', state: 'different' } },
  });
  assert.equal('.ruler/skills/s/img/a.png' in r.files, false);
  assert.deepEqual(r.todos.filter(t => t.kind === 'leftover').map(t => t.item), ['skills/s']);
});

test('잠금 없이 참조 지침을 모두 풀면 남는 색인은 할 일로 알린다', () => {
  const files = {
    'docs/guideline/base/01-b.md': '# 비\n\n본문 B\n',
    '.ruler/base/99-reference.md': '# base 참조 지침\n\n| 언제 | 읽을 파일 |\n| --- | --- |\n| 비 작업을 할 때 | `docs/guideline/base/01-b.md` |\n',
  };
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject(files),
    decisions: { 'rules/base/01-b.md': { action: 'remove', state: 'same' } },
  });
  assert.equal(r.files['docs/guideline/base/01-b.md'], null);
  assert.ok(r.todos.some(t => t.kind === 'leftover' && /\.ruler\/base\/99-reference\.md/.test(t.message)));
});

test('중첩 단위: 루트 전용 항목은 blocked, ruler.toml 은 에이전트만 담아 만들고, 사본은 단위 기준 경로다', () => {
  const items = ['rules/base/00-a.md', 'rules/base/01-b.md', 'skills/s', 'mcp/c7', 'agents/rev.md'];
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', items, { agents: ['claude'] }),
    lock: null, project: memProject(), nested: true,
  });
  assert.equal(text(r, '.ruler/ruler.toml'), 'default_agents = ["claude"]\n');
  assert.deepEqual(Object.keys(r.files).sort(), [
    '.ruler/base/00-a.md', '.ruler/base/99-reference.md', '.ruler/guideline.md', '.ruler/ruler.toml',
    'docs/guideline/README.md', 'docs/guideline/base/01-b.md',
  ]);
  assert.match(text(r, '.ruler/base/99-reference.md'), /`docs\/guideline\/base\/01-b\.md`/);
  const blocked = r.todos.filter(t => t.kind === 'blocked');
  assert.deepEqual(blocked.map(t => t.item).sort(), ['agents/rev.md', 'mcp/c7', 'skills/s']);
  assert.match(blocked[0].message, /중첩 디렉터리에서는 받을 수 없음/);
  assert.deepEqual(Object.keys(r.lock.sources).sort(), ['rules/base/00-a.md', 'rules/base/01-b.md']);
});

test('받기 전부터 원본과 달랐던 사본은 잠금에 adopted 로 남고, update 의 건너뜀 문구가 다르다', () => {
  const old = { '.ruler/base/00-a.md': '# 옛 사본\n' };
  const args = { tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject(old) };
  const r = render(args);
  assert.equal(r.lock.outputs.find(o => o.path === '.ruler/base/00-a.md').adopted, true);
  assert.match(lockText(r.lock), /"adopted": true/);
  const again = render({ ...args, lock: structuredClone(r.lock) });
  assert.match(again.todos.find(x => x.kind === 'skipped').message, /받기 전부터 원본과 달랐음/);
  assert.equal(again.lock.outputs.find(o => o.path === '.ruler/base/00-a.md').adopted, true);
  const forced = render({ ...args, lock: structuredClone(r.lock), force: true });
  assert.equal(forced.lock.outputs.find(o => o.path === '.ruler/base/00-a.md').adopted, undefined);
});

test('render 는 management 를 관리 지침에 넘긴다', () => {
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject(),
    management: { additions: [{ source: 'company', text: '## 보안\n\n검토 후 제안\n' }] },
  });
  assert.match(text(r, '.ruler/guideline.md'), /## company 추가 지침\n\n### 보안\n\n검토 후 제안\n/);
});
