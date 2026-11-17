import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desiredCopies } from '../src/render/copies.js';
import { render } from '../src/render/index.js';
import { sha256 } from '../src/hashes.js';
import { lockText, checkLock } from '../src/manifest.js';
import { copyPath, managementCopy } from '../src/layout.js';
import { ALWAYS } from './helpers.js';
import { DEPLOY, ALL, SOURCE, renderTree, manifestOf, memProject, applyMem } from './render-fixture.js';

const ids = outputs => outputs.map(o => o.path).sort();
const at = (outputs, p) => outputs.find(o => o.path === p);
const text = (r, p) => r.files[p].toString();
const kinds = r => r.todos.map(t => t.kind).sort();
const GUIDE = (items = ALL, extra = {}) => ({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', items), layout: 'guideline', ...extra });

test('desiredCopies 는 고른 스택의 원본을 그대로 .guideline 에 둔다', () => {
  const { outputs } = desiredCopies({ tree: renderTree(), manifest: manifestOf('ruler', ALL), items: ALL });
  const a = at(outputs, '.guideline/rules/base/00-a.md');
  assert.equal(a.kind, 'file');
  assert.deepEqual(a.items, ['rules/base/00-a.md']);
  // frontmatter 를 벗기지 않은 원본 그대로
  assert.equal(a.content.toString(), SOURCE['rules/base/00-a.md']);
  assert.match(a.content.toString(), /^---\n/);
  // 참조 칸(reference)도 .guideline 에 같은 모양으로 둔다
  assert.equal(at(outputs, '.guideline/rules/base/01-b.md').content.toString(), SOURCE['rules/base/01-b.md']);
  assert.equal(at(outputs, '.guideline/rules/base/SETUP.md').content.toString(), SOURCE['rules/base/SETUP.md']);
  assert.equal(at(outputs, `.guideline/rules/${DEPLOY}/00-x.md`).content.toString(), SOURCE[`rules/${DEPLOY}/00-x.md`]);
  assert.equal(at(outputs, '.guideline/agents/rev.md').content.toString(), SOURCE['agents/rev.md']);
  assert.deepEqual(at(outputs, '.guideline/agents/rev.md').items, ['agents/rev.md']);
});

test('desiredCopies 는 원본의 CRLF 만 LF 로 맞춘다', () => {
  const tree = renderTree({ 'rules/base/00-a.md': `${ALWAYS}# 에이\r\n\r\n본문\r\n` });
  const { outputs } = desiredCopies({ tree, manifest: manifestOf('ruler', ALL), items: ['rules/base/00-a.md'] });
  assert.equal(at(outputs, '.guideline/rules/base/00-a.md').content.toString(), `${ALWAYS}# 에이\n\n본문\n`);
});

test('desiredCopies 는 스킬·MCP 파일을 묶음 항목으로 낸다', () => {
  const { outputs } = desiredCopies({ tree: renderTree(), manifest: manifestOf('ruler', ALL), items: ALL });
  const skill = outputs.filter(o => o.path.startsWith('.guideline/skills/'));
  assert.deepEqual(ids(skill), ['.guideline/skills/s/SKILL.md', '.guideline/skills/s/img/a.png']);
  assert.deepEqual(skill.map(o => o.items), [['skills/s'], ['skills/s']]);
  assert.deepEqual([...at(outputs, '.guideline/skills/s/img/a.png').content], [1, 2, 3]);
  const mcp = outputs.filter(o => o.path.startsWith('.guideline/mcp/'));
  assert.deepEqual(ids(mcp), ['.guideline/mcp/c7/server.json', '.guideline/mcp/gl/server.json']);
  assert.deepEqual(mcp.map(o => o.items[0]).sort(), ['mcp/c7', 'mcp/gl']);
  assert.equal(at(outputs, '.guideline/mcp/gl/server.json').content.toString(), SOURCE['mcp/gl/server.json']);
});

test('desiredCopies 는 점 파일을 건너뛴다', () => {
  const tree = renderTree({ 'skills/s/.DS_Store': 'x', 'skills/s/.hidden/a.md': 'x' });
  const { outputs } = desiredCopies({ tree, manifest: manifestOf('ruler', ALL), items: ['skills/s'] });
  assert.deepEqual(ids(outputs), ['.guideline/skills/s/SKILL.md', '.guideline/skills/s/img/a.png']);
});

test('desiredCopies 는 색인·toml·.ruler·docs 출력을 만들지 않는다', () => {
  const { outputs } = desiredCopies({ tree: renderTree(), manifest: manifestOf('ruler', ALL), items: ALL });
  assert.ok(outputs.length > 0);
  assert.ok(outputs.every(o => o.path.startsWith('.guideline/')), ids(outputs).join(', '));
  assert.ok(outputs.every(o => o.kind === 'file' && !o.key));
  assert.equal(outputs.some(o => /99-reference|ruler\.toml|guideline\.md$/.test(o.path)), false);
});

test('desiredCopies 는 출처별 관리 지침을 소유 출력으로 낸다', () => {
  const management = { stackSource: null, additions: [
    { source: 'company', text: '## 보안\r\n\r\n검토\r\n' },
    { source: 'empty', text: '  \n' },
  ] };
  const { outputs } = desiredCopies({ tree: renderTree(), manifest: manifestOf('ruler', []), items: [], management });
  assert.deepEqual(ids(outputs), [managementCopy('company')]);
  const m = outputs[0];
  assert.deepEqual(m.items, []);
  assert.equal(m.owned, true);
  assert.equal(m.content.toString(), '## 보안\n\n검토\n');
});

test('desiredCopies 는 막힘·mcp-build·env 할 일을 desiredOutputs 와 같은 조건으로 낸다(subagents-off 는 조합이 낸다)', () => {
  const { outputs, todos } = desiredCopies({ tree: renderTree(), manifest: manifestOf('ruler', ALL), items: ALL });
  assert.deepEqual(todos.map(t => t.kind).sort(), ['env', 'mcp-build']);
  assert.deepEqual(todos.find(t => t.kind === 'env').data, { vars: ['GITLAB_TOKEN'], readme: 'mcp/gl/README.md' });
  assert.equal(todos.find(t => t.kind === 'mcp-build').data.readme, 'mcp/b/README.md');
  // 짓는 법만 있는 서버는 복사할 파일이 없다
  assert.equal(outputs.some(o => o.path.startsWith('.guideline/mcp/b/')), false);
  // [agents] 가 꺼져 있어도 서브에이전트 사본은 둔다
  assert.ok(outputs.some(o => o.path === '.guideline/agents/rev.md'));
  // server.json 이 틀린 서버는 blocked
  const bad = desiredCopies({ tree: renderTree({ 'mcp/c7/server.json': '{' }), manifest: manifestOf('ruler', ALL), items: ['mcp/c7'] });
  assert.deepEqual(bad.todos.map(t => t.kind), ['blocked']);
  assert.deepEqual(bad.outputs, []);
});

test('render(layout guideline) 는 잠금 v3 과 .guideline 출력만 낸다', () => {
  const r = render({ ...GUIDE(), lock: null, project: memProject() });
  assert.equal(r.lock.version, 3);
  assert.equal(r.lock.revision, 5);
  assert.deepEqual(Object.keys(r.lock.sources).sort(), [...ALL].sort());
  assert.ok(r.lock.outputs.length > 0);
  assert.ok(r.lock.outputs.every(o => o.path.startsWith('.guideline/') && !o.key), JSON.stringify(r.lock.outputs.map(o => o.path)));
  assert.deepEqual(Object.keys(r.files).filter(p => !p.startsWith('.guideline/')), []);
  assert.equal(r.files['.ruler/ruler.toml'], undefined);
  assert.equal(text(r, '.guideline/rules/base/00-a.md'), SOURCE['rules/base/00-a.md']);
  const out = r.lock.outputs.find(o => o.path === '.guideline/rules/base/00-a.md');
  assert.equal(out.hash, sha256(SOURCE['rules/base/00-a.md']));
  assert.deepEqual(kinds(r), ['env', 'mcp-build', 'setup']);
  // 잠금 파일로 쓰고 읽어도 v3
  assert.equal(checkLock(JSON.parse(lockText({ ...r.lock, revisions: { default: 5 } }))).version, 3);
});

test('render(layout guideline) 는 기존 toml 을 건드리지 않고 MCP 도 toml 에 쓰지 않는다', () => {
  const toml = '# 사용자 설정\ndefault_agents = ["claude"]\n';
  const r = render({ ...GUIDE(['mcp/c7', 'mcp/gl']), lock: null, project: memProject({ '.ruler/ruler.toml': toml }) });
  assert.equal(r.files['.ruler/ruler.toml'], undefined);
  assert.deepEqual(Object.keys(r.files).sort(), ['.guideline/mcp/c7/server.json', '.guideline/mcp/gl/server.json']);
});

test('render(layout guideline) 는 같은 원본으로 다시 하면 아무것도 쓰지 않는다', () => {
  const first = render({ ...GUIDE(), lock: null, project: memProject() });
  const files = applyMem({}, first.files);
  const again = render({ ...GUIDE(), lock: first.lock, project: memProject(files) });
  assert.deepEqual(again.files, {});
  assert.deepEqual(again.lock, first.lock);
});

test('render(layout guideline) 는 고친 사본을 덮지 않고, overwrite·force 면 덮는다', () => {
  const first = render({ ...GUIDE(), lock: null, project: memProject() });
  const edited = applyMem(applyMem({}, first.files), { '.guideline/rules/base/00-a.md': '# 고침\n' });
  const tree = renderTree({ 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n` });
  const args = { ...GUIDE(), tree, revision: 6, lock: first.lock, project: memProject(edited) };
  const skip = render(args);
  assert.equal(skip.files['.guideline/rules/base/00-a.md'], undefined);
  assert.ok(kinds(skip).includes('skipped'));
  assert.deepEqual(skip.lock.outputs.find(o => o.path === '.guideline/rules/base/00-a.md'), first.lock.outputs.find(o => o.path === '.guideline/rules/base/00-a.md'));
  assert.equal(skip.lock.version, 3);
  const over = render({ ...args, decisions: { 'rules/base/00-a.md': { action: 'keep', overwrite: true } } });
  assert.equal(text(over, '.guideline/rules/base/00-a.md'), `${ALWAYS}# 에이\n\n새 본문\n`);
  assert.equal(text(render({ ...args, force: true }), '.guideline/rules/base/00-a.md'), `${ALWAYS}# 에이\n\n새 본문\n`);
});

test('render(layout guideline) 는 원본이 새로 나오면 그 사본만 다시 쓴다', () => {
  const first = render({ ...GUIDE(), lock: null, project: memProject() });
  const files = applyMem({}, first.files);
  const tree = renderTree({ 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n` });
  const next = render({ ...GUIDE(), tree, revision: 6, lock: first.lock, project: memProject(files) });
  assert.deepEqual(Object.keys(next.files), ['.guideline/rules/base/00-a.md']);
});

test('render(layout guideline) 는 매니페스트에서 뺀 항목의 사본을 지우고 고친 사본은 남긴다', () => {
  const first = render({ ...GUIDE(), lock: null, project: memProject() });
  const files = applyMem(applyMem({}, first.files), {
    '.guideline/skills/s/SKILL.md': '고침\n',
    '.guideline/skills/s/notes.md': '프로젝트 메모\n',
  });
  const items = ALL.filter(i => i !== 'skills/s' && i !== 'mcp/c7');
  const next = render({ ...GUIDE(items), lock: first.lock, project: memProject(files) });
  assert.equal(next.files['.guideline/skills/s/img/a.png'], null);
  assert.equal(next.files['.guideline/mcp/c7/server.json'], null);
  // 고친 사본·잠금이 모르는 파일은 지우지 않는다
  assert.equal(next.files['.guideline/skills/s/SKILL.md'], undefined);
  assert.equal(next.files['.guideline/skills/s/notes.md'], undefined);
  assert.ok(next.todos.some(t => t.kind === 'leftover'));
  assert.equal(next.lock.sources['skills/s'], undefined);
});

test('render(layout guideline) 는 관리 지침 사본을 쓰고 출처가 빠지면 지운다', () => {
  const management = { stackSource: null, additions: [{ source: 'company', text: '## 보안\n\n검토\n' }] };
  const first = render({ ...GUIDE(['rules/base/00-a.md']), lock: null, project: memProject(), management });
  assert.equal(text(first, managementCopy('company')), '## 보안\n\n검토\n');
  const mo = first.lock.outputs.find(o => o.path === managementCopy('company'));
  assert.deepEqual(mo.items, []);
  const files = applyMem({}, first.files);
  const gone = render({ ...GUIDE(['rules/base/00-a.md']), lock: first.lock, project: memProject(files) });
  assert.equal(gone.files[managementCopy('company')], null);
});

test('render(layout guideline) 는 잠금이 모르는 사본을 항목 단위로, 같을 때만 지운다', () => {
  const same = copyPath('rules/base/00-a.md');
  const project = memProject({ [same]: SOURCE['rules/base/00-a.md'] });
  const r = render({ ...GUIDE([]), lock: null, project, decisions: { 'rules/base/00-a.md': { action: 'remove' } } });
  assert.equal(r.files[same], null);
  const other = render({ ...GUIDE([]), lock: null, project: memProject({ [same]: '# 고침\n' }), decisions: { 'rules/base/00-a.md': { action: 'remove' } } });
  assert.equal(other.files[same], undefined);
  assert.ok(other.todos.some(t => t.kind === 'leftover'));
});

test('기본 배치(ruler)는 지금처럼 잠금 v1(가상)과 .ruler 출력을 낸다', () => {
  const r = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject() });
  assert.equal(r.lock.version, 1);
  assert.ok(r.files['.ruler/base/00-a.md']);
  assert.equal(Object.keys(r.files).some(p => p.startsWith('.guideline/')), false);
});
