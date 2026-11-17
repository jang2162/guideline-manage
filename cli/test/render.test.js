import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, currentPart } from '../src/render/index.js';
import { sha256 } from '../src/hashes.js';
import { lockText } from '../src/manifest.js';
import { managementCopy } from '../src/layout.js';
import { ALWAYS } from './helpers.js';
import { t } from '../src/i18n.js';
import { ALL, SOURCE, renderTree, manifestOf, memProject, applyMem } from './render-fixture.js';

// render 는 .guideline/ 에 원본 모양 사본만 쓴다(생성물은 compose). 옛 배치(.ruler/·docs/guideline/·ruler.toml)를 쓰던 시험을 새 배치로 옮긴 것.

const text = (r, p) => r.files[p].toString();
const kinds = r => r.todos.map(t => t.kind).sort();
const A = '.guideline/rules/base/00-a.md';
const B = '.guideline/rules/base/01-b.md';

/** 새 프로젝트에 ALL 을 반영한 결과와 그 뒤의 프로젝트. */
function first() {
  const r = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ALL), lock: null, project: memProject() });
  return { r, files: applyMem({}, r.files) };
}

test('새 프로젝트: 모든 사본을 원본 모양으로 쓰고 잠금 v3 을 낸다', () => {
  const { r } = first();
  assert.equal(text(r, A), SOURCE['rules/base/00-a.md']);
  assert.equal(Object.keys(r.files).some(p => !p.startsWith('.guideline/')), false, Object.keys(r.files).join(', '));
  assert.equal(r.lock.version, 3);
  assert.equal(r.lock.revision, 5);
  assert.deepEqual(Object.keys(r.lock.sources).sort(), [...ALL].sort());
  // 지침 4, 세팅 1, 스킬 2, 서브에이전트 1, MCP 2(c7·gl 의 server.json)
  assert.equal(r.lock.outputs.length, 10);
  assert.deepEqual(kinds(r), ['env', 'mcp-build', 'setup']);
});

test('같은 원본으로 다시 하면 아무것도 쓰지 않고 잠금이 같다', () => {
  const { r, files } = first();
  const again = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(files) });
  assert.deepEqual(again.files, {});
  assert.deepEqual(again.lock, r.lock);
  assert.ok(!kinds(again).includes('setup'), '세팅 문서가 그대로면 setup 할 일이 없다');
});

test('원본이 새로 나오면 그 사본만 다시 쓰고 원본 해시를 바꾼다', () => {
  const { r, files } = first();
  const tree = renderTree({ 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n` });
  const next = render({ tree, revision: 6, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(files) });
  assert.deepEqual(Object.keys(next.files), [A]);
  assert.equal(text(next, A), `${ALWAYS}# 에이\n\n새 본문\n`);
  assert.notEqual(next.lock.sources['rules/base/00-a.md'], r.lock.sources['rules/base/00-a.md']);
});

test('프로젝트에서 고친 사본은 건너뛰고, overwrite·force 면 덮어쓴다', () => {
  const { r, files } = first();
  const edited = applyMem(files, { [A]: '# 고침\n' });
  const tree = renderTree({ 'rules/base/00-a.md': `${ALWAYS}# 에이\n\n새 본문\n` });
  const args = { tree, revision: 6, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(edited) };
  const skip = render(args);
  assert.equal(skip.files[A], undefined);
  assert.ok(kinds(skip).includes('skipped'));
  const prev = r.lock.outputs.find(o => o.path === A);
  assert.deepEqual(skip.lock.outputs.find(o => o.path === A), prev);
  assert.equal(skip.lock.sources['rules/base/00-a.md'], r.lock.sources['rules/base/00-a.md']);
  const over = render({ ...args, decisions: { 'rules/base/00-a.md': { action: 'keep', overwrite: true } } });
  assert.equal(text(over, A), `${ALWAYS}# 에이\n\n새 본문\n`);
  assert.equal(text(render({ ...args, force: true }), A), `${ALWAYS}# 에이\n\n새 본문\n`);
});

test('CRLF 로 체크아웃된 같은 사본은 고친 것으로 보지 않는다', () => {
  const crlf = { [A]: SOURCE['rules/base/00-a.md'].replace(/\n/g, '\r\n') };
  const r = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject(crlf) });
  assert.equal(r.files[A], undefined);
  const out = r.lock.outputs.find(o => o.path === A);
  assert.equal(out.hash, sha256(SOURCE['rules/base/00-a.md']));
  assert.equal(out.hash, sha256(currentPart(memProject(crlf), out)));
});

test('잠금 없이 다른 사본은 쓰지 않고 conflict 할 일이며 잠금에 올리지 않는다. 갱신을 켜면 쓴다', () => {
  const old = { [A]: '# 옛 사본\n', '.guideline/skills/s/SKILL.md': '다른 스킬\n' };
  const args = { tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['rules/base/00-a.md', 'skills/s']), lock: null, project: memProject(old) };
  const r = render(args);
  assert.equal(r.files[A], undefined);
  assert.equal(r.files['.guideline/skills/s/SKILL.md'], undefined);
  assert.deepEqual([...r.files['.guideline/skills/s/img/a.png']], [1, 2, 3]);
  assert.deepEqual(r.todos.filter(x => x.kind === 'conflict').map(x => x.item).sort(), ['rules/base/00-a.md', 'skills/s']);
  assert.equal(r.lock.outputs.some(o => o.path === A || o.path === '.guideline/skills/s/SKILL.md'), false);
  assert.equal(r.lock.sources['rules/base/00-a.md'], undefined);
  const upd = render({ ...args, decisions: { 'rules/base/00-a.md': { action: 'update' } } });
  assert.equal(text(upd, A), SOURCE['rules/base/00-a.md']);
});

test('매니페스트에서 뺀 항목은 잠금에 있는 사본만 지운다', () => {
  const { r, files } = first();
  const items = ALL.filter(i => i !== 'skills/s' && i !== 'mcp/c7');
  const withExtra = applyMem(files, { '.guideline/skills/s/notes.md': '프로젝트 메모\n' });
  const next = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', items), lock: r.lock, project: memProject(withExtra) });
  assert.equal(next.files['.guideline/skills/s/SKILL.md'], null);
  assert.equal(next.files['.guideline/skills/s/img/a.png'], null);
  assert.equal(next.files['.guideline/skills/s/notes.md'], undefined);
  assert.equal(next.files['.guideline/mcp/c7/server.json'], null);
  assert.equal(next.files['.guideline/mcp/gl/server.json'], undefined);
  assert.equal(next.lock.sources['skills/s'], undefined);
});

test('원본에서 사라진 항목은 그대로 두고 removed-upstream 할 일을 낸다', () => {
  const { r, files } = first();
  const tree = renderTree({ 'skills/s/SKILL.md': null, 'skills/s/img/a.png': null });
  const next = render({ tree, revision: 6, manifest: manifestOf('ruler', ALL), lock: r.lock, project: memProject(files) });
  assert.equal(next.files['.guideline/skills/s/SKILL.md'], undefined);
  assert.ok(kinds(next).includes('removed-upstream'));
  assert.equal(next.lock.sources['skills/s'], r.lock.sources['skills/s']);
  assert.equal(next.lock.outputs.filter(o => o.items.includes('skills/s')).length, 2);
});

test('orphans 는 지운다', () => {
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', []), lock: null,
    project: memProject({ '.guideline/rules/old/00-z.md': 'x' }), orphans: ['.guideline/rules/old/00-z.md'],
  });
  assert.equal(r.files['.guideline/rules/old/00-z.md'], null);
});

test('잠금 없이 체크를 푼 항목: 원본과 같은 사본은 지우고, 다르면 지우지 않고 할 일로 남긴다', () => {
  const files = { [A]: SOURCE['rules/base/00-a.md'], [B]: `${ALWAYS}# 비\n\n프로젝트에서 고친 본문\n` };
  const keep = ALL.filter(i => i !== 'rules/base/00-a.md' && i !== 'rules/base/01-b.md');
  const decisions = {
    'rules/base/00-a.md': { action: 'remove', state: 'same' },
    'rules/base/01-b.md': { action: 'remove', state: 'different' },
  };
  const r = render({ tree: renderTree(), revision: 5, manifest: manifestOf('ruler', keep), lock: null, project: memProject(files), decisions });
  assert.equal(r.files[A], null);
  assert.equal(B in r.files, false);
  const left = r.todos.filter(t => t.kind === 'leftover');
  assert.deepEqual(left.map(t => t.item), ['rules/base/01-b.md']);
  assert.match(left[0].message, /\.guideline\/rules\/base\/01-b\.md/);
  assert.equal(r.lock.outputs.some(o => o.items.includes('rules/base/00-a.md') || o.items.includes('rules/base/01-b.md')), false);
});

test('이름에 . 이 든 MCP 는 그 이름의 사본 폴더에 두고, 다시 하면 아무것도 바뀌지 않는다', () => {
  const tree = renderTree({ 'mcp/dep.x/server.json': JSON.stringify({ type: 'stdio', command: 'npx', args: ['dep'] }) });
  const manifest = manifestOf('ruler', ['mcp/dep.x']);
  const r = render({ tree, revision: 1, manifest, lock: null, project: memProject() });
  assert.ok(r.files['.guideline/mcp/dep.x/server.json']);
  const again = render({ tree, revision: 1, manifest, lock: r.lock, project: memProject(applyMem({}, r.files)) });
  assert.deepEqual(again.files, {});
  assert.deepEqual(kinds(again), []);
});

test('원본 스킬이 CRLF 여도, 프로젝트의 .sh 가 CRLF 여도 다시 하면 바뀐 것 없음', () => {
  const tree = renderTree({ 'skills/s/SKILL.md': '---\r\nname: s\r\ndescription: 스\r\n---\r\n\r\n본문\r\n', 'skills/s/run.sh': 'echo a\n' });
  const manifest = manifestOf('ruler', ['skills/s']);
  const r = render({ tree, revision: 1, manifest, lock: null, project: memProject() });
  const files = applyMem(applyMem({}, r.files), { '.guideline/skills/s/run.sh': 'echo a\r\n' });
  const again = render({ tree, revision: 1, manifest, lock: r.lock, project: memProject(files) });
  assert.deepEqual(again.files, {});
  assert.deepEqual(kinds(again), []);
});

test('잠금 없이 체크를 푼 스킬: 파일 하나라도 다르면 아무것도 지우지 않고 할 일 하나로 남긴다', () => {
  const files = {
    '.guideline/skills/s/SKILL.md': '---\nname: s\ndescription: 스\n---\n\n고친 본문\n',
    '.guideline/skills/s/img/a.png': Buffer.from([1, 2, 3]),
  };
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', []), lock: null, project: memProject(files),
    decisions: { 'skills/s': { action: 'remove', state: 'different' } },
  });
  assert.equal('.guideline/skills/s/img/a.png' in r.files, false);
  assert.deepEqual(r.todos.filter(t => t.kind === 'leftover').map(t => t.item), ['skills/s']);
});

test('중첩 단위: 루트 전용 항목은 blocked 이고, 사본은 단위 기준 경로다', () => {
  const items = ['rules/base/00-a.md', 'rules/base/01-b.md', 'skills/s', 'mcp/c7', 'agents/rev.md'];
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', items, { agents: ['claude'] }),
    lock: null, project: memProject(), nested: true,
  });
  assert.deepEqual(Object.keys(r.files).sort(), [A, B]);
  const blocked = r.todos.filter(t => t.kind === 'blocked');
  assert.deepEqual(blocked.map(t => t.item).sort(), ['agents/rev.md', 'mcp/c7', 'skills/s']);
  assert.match(blocked[0].message, /중첩 디렉터리에서는 받을 수 없음/);
  assert.deepEqual(Object.keys(r.lock.sources).sort(), ['rules/base/00-a.md', 'rules/base/01-b.md']);
});

test('이전에서 adopted 로 옮긴 사본은 update 의 건너뜀 문구가 다르고, force 로 덮으면 adopted 가 빠진다', () => {
  const lock = {
    version: 3, revision: 5, sources: { 'rules/base/00-a.md': sha256(SOURCE['rules/base/00-a.md']) },
    outputs: [{ path: A, items: ['rules/base/00-a.md'], hash: sha256(SOURCE['rules/base/00-a.md']), adopted: true }],
  };
  const args = { tree: renderTree(), revision: 5, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock, project: memProject({ [A]: '# 옛 사본\n' }) };
  const again = render({ ...args, lock: structuredClone(lock) });
  assert.match(again.todos.find(x => x.kind === 'skipped').message, /받기 전부터 원본과 달랐음/);
  assert.equal(again.lock.outputs.find(o => o.path === A).adopted, true);
  assert.match(lockText({ ...again.lock, revisions: {} }), /"adopted": true/);
  const forced = render({ ...args, lock: structuredClone(lock), force: true });
  assert.equal(forced.lock.outputs.find(o => o.path === A).adopted, undefined);
});

test('render 는 출처별 추가 관리 지침을 사본으로 쓴다', () => {
  const r = render({
    tree: renderTree(), revision: 1, manifest: manifestOf('ruler', ['rules/base/00-a.md']), lock: null, project: memProject(),
    management: { additions: [{ source: 'company', text: '## 보안\n\n검토 후 제안\n' }] },
  });
  assert.equal(text(r, managementCopy('company')), '## 보안\n\n검토 후 제안\n');
});

test('매니페스트의 스택 키는 그 스택의 지침 파일·세팅 문서로 펼쳐 쓰고, 잠금은 파일 id 로 남긴다', () => {
  const r = render({ tree: renderTree(), revision: 1, manifest: manifestOf('ruler', ['rules/base']), lock: null, project: memProject() });
  assert.deepEqual(Object.keys(r.files).sort(), [A, B, '.guideline/rules/base/SETUP.md']);
  assert.deepEqual(Object.keys(r.lock.sources).sort(), ['rules/base/00-a.md', 'rules/base/01-b.md', 'rules/base/SETUP.md']);
  assert.deepEqual(kinds(r), ['setup']);
});

test('하위 스택은 .guideline/rules/<부모>/<자식>/ 에 쓰고 세팅 할 일은 그 경로다', () => {
  const tree = renderTree({
    'rules/browser/00-tool.md': `${ALWAYS}# 도구\n`,
    'rules/browser/neo/00-x.md': `${ALWAYS}# 엑스\n`,
    'rules/browser/neo/SETUP.md': '# neo 세팅\n',
  });
  const r = render({ tree, revision: 1, manifest: manifestOf('ruler', ['rules/browser', 'rules/browser/neo']), lock: null, project: memProject() });
  assert.ok(r.files['.guideline/rules/browser/00-tool.md']);
  assert.ok(r.files['.guideline/rules/browser/neo/00-x.md']);
  assert.ok(r.files['.guideline/rules/browser/neo/SETUP.md']);
  assert.deepEqual(r.todos.filter(x => x.kind === 'setup').map(x => x.message), [t('todo.setup', { stack: 'browser/neo' })]);
});

test('고른 스택에서 원본이 뺀 파일은 할 일 없이 지우고, 원본에서 사라진 스택은 그대로 두고 removed-upstream 을 낸다', () => {
  const tree = renderTree({ 'rules/gone/00-g.md': `${ALWAYS}# 지\n` });
  const firstR = render({ tree, revision: 1, manifest: manifestOf('ruler', ['rules/base', 'rules/gone']), lock: null, project: memProject() });
  const files = applyMem({}, firstR.files);
  const later = renderTree({ 'rules/base/01-b.md': null });
  const next = render({ tree: later, revision: 2, manifest: manifestOf('ruler', ['rules/base', 'rules/gone']), lock: firstR.lock, project: memProject(files) });
  assert.equal(next.files[B], null);
  assert.equal(next.files['.guideline/rules/gone/00-g.md'], undefined);
  assert.deepEqual(next.todos.map(x => [x.kind, x.item]), [['removed-upstream', 'rules/gone']]);
  assert.equal(next.lock.sources['rules/gone/00-g.md'], firstR.lock.sources['rules/gone/00-g.md']);
  assert.ok(next.lock.outputs.some(o => o.path === '.guideline/rules/gone/00-g.md'));
  assert.equal(next.lock.sources['rules/base/01-b.md'], undefined);
});

test('고른 스택에서 원본이 뺀 파일이라도 프로젝트에서 고친 사본은 지우지 않고 leftover 할 일을 낸다', () => {
  const firstR = render({ tree: renderTree(), revision: 1, manifest: manifestOf('ruler', ['rules/base']), lock: null, project: memProject() });
  const files = applyMem(applyMem({}, firstR.files), { [B]: '# 고침\n' });
  const next = render({ tree: renderTree({ 'rules/base/01-b.md': null }), revision: 2, manifest: manifestOf('ruler', ['rules/base']), lock: firstR.lock, project: memProject(files) });
  assert.equal(next.files[B], undefined);
  assert.deepEqual(next.todos.map(x => [x.kind, x.message]), [['leftover', t('todo.leftoverDropped', { path: B })]]);
});
