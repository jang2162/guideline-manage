import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryTree, readText } from '../src/tree.js';
import { NAME, unitOf, aliasUnitOf, finalUnit, toVirtual, setNameLine, sourceView, mergeViews, collisions, collisionMessage, aliasProblems, realOf } from '../src/sources.js';

const T = memoryTree({
  'rules/base/01-git.md': '---\nload: always\n---\n\n# git\n',
  'rules/base/SETUP.md': '# 세팅\n',
  'rules/orca/README.md': '| `05-switch.md` 「a」 | `base/06-worktree-setup.md` 「b」 |\n',
  'rules/orca/05-switch.md': '# s\n',
  'skills/deploy/SKILL.md': '---\nname: deploy\ndescription: d\n---\n\n본문 deploy\n',
  'skills/deploy/run.sh': 'echo deploy\n',
  'agents/rev.md': '---\nname: rev\n---\n\n리뷰\n',
  'mcp/c7/server.json': '{"command":"x"}',
  'docs/authoring.md': '# 규칙\n',
});
const A = { 'rules/base': 'company-base', 'skills/deploy': 'company-deploy', 'agents/rev.md': 'company-rev', 'mcp/c7': 'company-c7' };

test('이름 규칙과 단위', () => {
  assert.ok(NAME.test('company') && NAME.test('my-2') && !NAME.test('Company') && !NAME.test('1a') && !NAME.test('a'.repeat(33)));
  assert.deepEqual(['rules/base/01-git.md', 'rules/base/SETUP.md', 'skills/deploy', 'skills/deploy/run.sh', 'agents/rev.md', 'mcp/c7', 'docs/authoring.md'].map(unitOf),
    ['rules/base', 'rules/base', 'skills/deploy', 'skills/deploy', 'agents/rev.md', 'mcp/c7', null]);
  assert.equal(finalUnit('agents/rev.md', A), 'agents/company-rev.md');
  assert.equal(toVirtual('rules/base/01-git.md', A), 'rules/company-base/01-git.md');
  assert.equal(toVirtual('rules/orca/05-switch.md', A), 'rules/orca/05-switch.md');
});

test('setNameLine 은 frontmatter 의 name 줄만 바꾼다', () => {
  assert.equal(setNameLine('---\nname: deploy\ndescription: d\n---\n\nname: deploy\n', 'x'), '---\nname: x\ndescription: d\n---\n\nname: deploy\n');
  assert.equal(setNameLine('# 없음\n', 'x'), '# 없음\n');
});

test('sourceView 는 별칭 자리로 옮기고 name 줄과 같은 출처의 바꿈 표를 고치고 docs 를 뺀다', () => {
  const v = sourceView(T, A);
  assert.equal(readText(v, 'rules/company-base/01-git.md'), readText(T, 'rules/base/01-git.md'));
  assert.equal(readText(v, 'rules/base/01-git.md'), null);
  assert.match(readText(v, 'skills/company-deploy/SKILL.md'), /^---\nname: company-deploy\n/);
  assert.equal(readText(v, 'skills/company-deploy/run.sh'), 'echo deploy\n');
  assert.match(readText(v, 'agents/company-rev.md'), /^---\nname: company-rev\n/);
  assert.equal(readText(v, 'mcp/company-c7/server.json'), '{"command":"x"}');
  assert.match(readText(v, 'rules/orca/README.md'), /`company-base\/06-worktree-setup\.md`/);
  assert.equal(readText(v, 'docs/authoring.md'), null);
});

test('collisions 는 최종 단위가 같은 항목을 찾고 별칭을 제안한다', () => {
  const s = [
    { name: 'personal', items: ['rules/base/00-a.md', 'skills/deploy'], aliases: {} },
    { name: 'company', items: ['rules/base/01-git.md', 'skills/deploy'], aliases: { 'skills/deploy': 'company-deploy' } },
  ];
  const c = collisions(s);
  assert.deepEqual(c, [{ kind: '스택', final: 'rules/base', unit: 'rules/base', a: 'company', b: 'personal' }]);
  assert.equal(collisionMessage(c[0]),
    '이름 충돌: 스택 base — company 와 personal. guideline.json 의 sources.personal.aliases 에 "rules/base": "personal-base" 추가');
  assert.deepEqual(collisions([{ ...s[0] }, { ...s[1], aliases: { 'rules/base': 'company-base', 'skills/deploy': 'company-deploy' } }]), []);
});

test('aliasProblems 는 원본에 없는 단위와 같은 별칭 두 번을 알린다', () => {
  const p = aliasProblems({ name: 'company', items: [], aliases: { 'rules/none': 'x', 'rules/base': 'y', 'skills/deploy': 'y' } }, T);
  assert.equal(p.length, 2);
  assert.ok(p.every(x => x.kind === 'alias'));
});

test('realOf 는 가상 id 를 출처와 원래 id 로 되돌린다', () => {
  const s = [
    { name: 'company', items: ['rules/base/01-git.md'], aliases: { 'rules/base': 'company-base' } },
    { name: 'personal', items: ['rules/base/00-a.md', 'rules/orca/05-switch.md'], aliases: {} },
  ];
  assert.deepEqual(realOf('rules/company-base/01-git.md', s), { source: 'company', id: 'rules/base/01-git.md' });
  assert.deepEqual(realOf('rules/base/00-a.md', s), { source: 'personal', id: 'rules/base/00-a.md' });
  assert.deepEqual(realOf('rules/orca/SETUP.md', s), { source: 'personal', id: 'rules/orca/SETUP.md' });
  assert.equal(realOf('rules/none/x.md', s), null);
});

test('mergeViews 는 합집합이다', () => {
  const m = mergeViews([memoryTree({ 'rules/a/00.md': 'a' }), memoryTree({ 'rules/b/00.md': 'b' })]);
  assert.equal(readText(m, 'rules/a/00.md'), 'a');
  assert.equal(readText(m, 'rules/b/00.md'), 'b');
});

test('별칭은 최상위 스택에만 붙고 하위 스택 경로는 접두와 함께 옮겨진다', () => {
  const aliases = { 'rules/browser': 'web' };
  assert.equal(finalUnit('rules/browser/neo', aliases), 'rules/web/neo');
  assert.equal(toVirtual('rules/browser/neo/00-x.md', aliases), 'rules/web/neo/00-x.md');
  assert.equal(toVirtual('rules/browser/SETUP.md', aliases), 'rules/web/SETUP.md');
  const v = sourceView(memoryTree({ 'rules/browser/neo/00-x.md': '# x\n', 'rules/browser/00-y.md': '# y\n' }), aliases);
  assert.equal(v.exists('rules/web/neo/00-x.md'), true);
  assert.equal(v.exists('rules/browser/neo/00-x.md'), false);
});

test('sourceView 의 skip 은 최종 최상위 스택 단위로 하위 스택 파일까지 뺀다', () => {
  const tree = memoryTree({ 'rules/browser/neo/00-x.md': '# x\n', 'rules/browser/00-y.md': '# y\n', 'rules/other/00-z.md': '# z\n' });
  const v = sourceView(tree, { 'rules/browser': 'web' }, new Set(['rules/web']));
  assert.equal(v.exists('rules/web'), false);
  assert.equal(v.exists('rules/other/00-z.md'), true);
});

test('unitOf·aliasUnitOf 는 깊이 1 id 에서 예전 값을 내고, 점 있는 도메인 스택 폴더를 파일로 오해하지 않는다', () => {
  const EXPECTED = {
    'rules/base/00-a.md': 'rules/base',
    'rules/base/logo.png': 'rules/base',
    'rules/base/': null,
    'skills/s/x.md': 'skills/s',
    'agents/r.md': 'agents/r.md',
    'mcp/m/server.json': 'mcp/m',
    'docs/a.md': null,
    'rules/deploy__gitlab.example.com': 'rules/deploy__gitlab.example.com',
    'rules/deploy__gitlab.example.com/00-a.md': 'rules/deploy__gitlab.example.com',
  };
  for (const [id, unit] of Object.entries(EXPECTED)) {
    assert.equal(unitOf(id), unit, id);
    assert.equal(aliasUnitOf(id), unit, id);
  }
  assert.equal(toVirtual('rules/base/logo.png', { 'rules/base': 'core' }), 'rules/core/logo.png');
  assert.equal(toVirtual('rules/deploy__gitlab.example.com/00-a.md', { 'rules/deploy__gitlab.example.com': 'deploy' }), 'rules/deploy/00-a.md');
});

test('collisions 는 조상·자손 관계도 충돌로 본다', () => {
  const c = collisions([
    { name: 'a', items: ['rules/browser'], aliases: {} },
    { name: 'b', items: ['rules/browser/x'], aliases: {} },
  ]);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].a, c[0].b, c[0].unit], ['a', 'b', 'rules/browser/x']);
  // 조상을 채운 매니페스트(부모가 같아 충돌)는 하위 스택 몫을 따로 세지 않는다
  assert.equal(collisions([
    { name: 'a', items: ['rules/browser'], aliases: {} },
    { name: 'b', items: ['rules/browser', 'rules/browser/x'], aliases: {} },
  ]).length, 1);
  // 자손 쪽이 먼저 나와도 충돌이다
  assert.equal(collisions([
    { name: 'a', items: ['rules/browser/x'], aliases: {} },
    { name: 'b', items: ['rules/browser'], aliases: {} },
  ]).length, 1);
  // 한 출처의 부모·자식은 충돌이 아니고, 별칭으로 비킨 부모 아래 자식도 충돌이 아니다
  assert.deepEqual(collisions([{ name: 'a', items: ['rules/browser', 'rules/browser/x'], aliases: {} }]), []);
  assert.deepEqual(collisions([
    { name: 'a', items: ['rules/browser'], aliases: {} },
    { name: 'b', items: ['rules/browser', 'rules/browser/x'], aliases: { 'rules/browser': 'web' } },
  ]), []);
});

test('realOf 는 별칭 부모 아래 하위 스택 id·키를 되돌리고, 점 없는 스택 자산의 주인도 찾는다', () => {
  const s = [{ name: 'default', items: ['rules/browser', 'rules/browser/neo'], aliases: { 'rules/browser': 'web' } }];
  assert.deepEqual(realOf('rules/web/neo/00-x.md', s), { source: 'default', id: 'rules/browser/neo/00-x.md' });
  assert.deepEqual(realOf('rules/web/neo', s), { source: 'default', id: 'rules/browser/neo' });
  assert.deepEqual(realOf('rules/web', s), { source: 'default', id: 'rules/browser' });
  const two = [
    { name: 'a', items: ['rules/base'], aliases: {} },
    { name: 'b', items: ['skills/s'], aliases: {} },
  ];
  assert.deepEqual(realOf('rules/base/LICENSE', two), { source: 'a', id: 'rules/base/LICENSE' });
  assert.deepEqual(realOf('rules/base/sub/00-s.md', [{ name: 'a', items: ['rules/base', 'rules/base/sub'], aliases: {} }, two[1]]),
    { source: 'a', id: 'rules/base/sub/00-s.md' });
  // 부모를 다른 출처가 가졌어도 하위 스택 파일은 그 하위 스택을 가진 출처의 것이다(가장 깊은 키)
  const split = [{ name: 'a', items: ['rules/base'], aliases: {} }, { name: 'b', items: ['rules/base/sub'], aliases: {} }];
  assert.deepEqual(realOf('rules/base/sub/00-s.md', split), { source: 'b', id: 'rules/base/sub/00-s.md' });
  assert.deepEqual(realOf('rules/base/00-a.md', split), { source: 'a', id: 'rules/base/00-a.md' });
  assert.deepEqual(realOf('rules/base/sub/LICENSE', split), { source: 'b', id: 'rules/base/sub/LICENSE' });
});

test('sourceView 는 하위 스택 README 의 바꿈 표도 부모 별칭을 따라 고친다', () => {
  const tree = memoryTree({
    'rules/base/00-a.md': '# a\n',
    'rules/orca/sub/README.md': '| `05-s.md` 「a」 | `base/00-a.md` 「b」 |\n',
    'rules/orca/sub/05-s.md': '# s\n',
  });
  const v = sourceView(tree, { 'rules/base': 'company-base' });
  assert.match(readText(v, 'rules/orca/sub/README.md'), /`company-base\/00-a\.md`/);
});
