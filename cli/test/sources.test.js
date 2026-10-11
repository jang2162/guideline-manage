import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryTree, readText } from '../src/tree.js';
import { NAME, unitOf, finalUnit, toVirtual, setNameLine, sourceView, mergeViews, collisions, collisionMessage, aliasProblems, realOf } from '../src/sources.js';

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
