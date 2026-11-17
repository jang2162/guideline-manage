import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, write, read, exists, filesOf, ALWAYS, reference } from './helpers.js';
import { SOURCE, DEPLOY, memProject } from './render-fixture.js';
import { memoryTree } from '../src/tree.js';
import { checkManifest } from '../src/manifest.js';
import { render } from '../src/render/index.js';
import { virtualize } from '../src/workspace.js';
import { compose } from '../src/compose.js';
import { readBlock } from '../src/gitignore-block.js';
import { RULER_TOML_BASE, NESTED_TOML_BASE } from '../src/render/outputs.js';
import { oldRenderFiles } from './old-layout.js';

const dir = t => {
  const d = tmpDir('guideline-compose-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

/** compose 의 files(null 은 지움)를 디스크에 쓴다. */
function applyDisk(project, files) {
  for (const [p, c] of Object.entries(files)) {
    const abs = path.join(project, p);
    if (c === null) fs.rmSync(abs, { force: true });
    else write(project, p, c);
  }
}

// 두 출처: company 는 별칭 없이, team 은 같은 이름의 스택·스킬에 별칭을 준다. 하위 스택, 점·__ 든 스택, CRLF, 관리 지침 추가분을 담는다.
const COMPANY = {
  ...SOURCE,
  'rules/base/web/00-w.md': `${ALWAYS}# 웹\r\n\r\n본문 W\r\n`,
  'rules/base/web/01-r.md': `${reference('웹 참고')}# 웹 참고\n`,
  'docs/management.md': '# company\r\n\r\n## 보안\r\n\r\n검토한다\r\n',
};
const TEAM = {
  'rules/base/00-t.md': `${ALWAYS}# 팀\n`,
  'rules/base/01-u.md': `${reference('팀 참고 | 할 때')}# 팀 참고\n`,
  'rules/base/SETUP.md': '# 팀 세팅\n',
  'skills/s/SKILL.md': '---\nname: s\ndescription: 팀 스킬\n---\n\n팀\n',
  'mcp/tm/server.json': JSON.stringify({ type: 'stdio', command: 'tm' }),
  'docs/management.md': '## 팀 규칙\n\n지킨다\n',
};
const MANIFEST = checkManifest({ version: 3, form: 'ruler', agents: ['claude', 'codex'], sources: {
  company: { server: 'http://c', items: ['rules/base', 'rules/base/web', `rules/${DEPLOY}`, 'skills/s', 'agents/rev.md', 'mcp/c7', 'mcp/gl', 'mcp/b'] },
  team: { server: 'http://t', items: ['rules/base', 'skills/s', 'mcp/tm'], aliases: { 'rules/base': 'team-base', 'skills/s': 'team-s' } },
} });
const TREES = () => new Map([
  ['company', { server: 'http://c', revision: 3, tree: memoryTree(COMPANY) }],
  ['team', { server: 'http://t', revision: 9, tree: memoryTree(TEAM) }],
]);

/** 같은 원본으로 예전 반영(옛 배치가 쓰던 파일)과 새 배치 동기화(.guideline/ 사본)를 한다. */
function both(manifest = MANIFEST, { rulerAgentsEnabled = true } = {}) {
  const v = virtualize({ manifest, lock: null, trees: TREES() });
  const guide = render({ tree: v.tree, revision: 0, manifest: v.view, lock: null, project: memProject({}, { rulerAgentsEnabled }), management: v.management });
  return { old: { files: oldRenderFiles({ tree: v.tree, view: v.view, management: v.management, rulerAgentsEnabled }) }, guide };
}

/** 새 배치 동기화의 사본(.guideline/)을 쓴 프로젝트. */
function guideProject(t, manifest = MANIFEST, opts) {
  const p = dir(t);
  fs.mkdirSync(path.join(p, '.ruler'));
  const { old, guide } = both(manifest, opts);
  applyDisk(p, guide.files);
  return { p, old, guide };
}

test('compose 는 같은 원본에서 예전 반영과 같은 파일을 만든다', t => {
  const { p, old } = guideProject(t);
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  const want = old.files;
  // 예전 반영이 쓴 경로를 빠짐없이, 그 밖은 .gitignore 만 더 쓴다
  assert.deepEqual(Object.keys(r.files).filter(k => k !== '.gitignore').sort(), Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) assert.ok(Buffer.from(v).equals(r.files[k]), `${k} 가 다르다`);
  // 비교가 비어 있지 않음을 확인: 하위 스택, 별칭 스택, 점·__ 스택, 스킬 바이너리, 서브에이전트, 관리 지침, toml
  for (const k of ['.ruler/base/web/00-w.md', '.ruler/team-base/00-t.md', `.ruler/${DEPLOY}/99-reference.md`, `docs/guideline/${DEPLOY}/00-x.md`,
    '.ruler/skills/s/img/a.png', '.ruler/skills/team-s/SKILL.md', '.ruler/agents/rev.md', '.ruler/guideline.md', 'docs/guideline/README.md',
    'docs/guideline/team-base/SETUP.md', '.ruler/ruler.toml']) {
    assert.ok(Object.hasOwn(r.files, k), k);
  }
  const guide = r.files['.ruler/guideline.md'].toString();
  assert.match(guide, /보안/);
  assert.match(guide, /팀 규칙/);
  assert.match(guide, /\| team-base \| team \|/);
  assert.match(r.files['.ruler/skills/team-s/SKILL.md'].toString(), /^---\nname: team-s\n/);
  assert.match(r.files['.ruler/ruler.toml'].toString(), /\[mcp_servers\.tm\]/);
  // generated 는 쓴 경로 전부(정렬), .gitignore 블록에 / 를 붙여 적힌다
  assert.deepEqual(r.generated, Object.keys(want).sort());
  assert.deepEqual(readBlock(r.files['.gitignore'].toString()), r.generated.map(x => `/${x}`));
  // 사본이 없는 항목(조합 전에 막힌 MCP 등)은 조합하지 않아 할 일이 생기지 않는다
  assert.ok(!r.todos.some(x => x.kind === 'blocked'), JSON.stringify(r.todos));
  // 조합은 .guideline/ 을 쓰지 않는다
  assert.ok(Object.keys(r.files).every(k => !k.startsWith('.guideline/')));
});

test('compose 는 잠금을 읽지도 쓰지도 않는다', t => {
  const { p } = guideProject(t);
  write(p, 'guideline-lock.json', '{ 깨진 잠금');
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  assert.ok(!Object.hasOwn(r.files, 'guideline-lock.json'));
  assert.ok(r.files['.ruler/guideline.md']);
});

test('compose 는 ruler.project.toml 에 MCP 표를 얹어 ruler.toml 을 쓴다', t => {
  const { p } = guideProject(t);
  const project = 'default_agents = ["claude"]\nnested = false\n\n# 프로젝트 MCP\n[mcp_servers.mine]\ncommand = "mine"   # 주석\n\n[gitignore]\nenabled = true\n';
  write(p, '.ruler/ruler.project.toml', project);
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  const toml = r.files['.ruler/ruler.toml'].toString();
  // 사용자 표·주석·서식이 그대로 앞에 남고 MCP 표가 뒤에 붙는다
  assert.ok(toml.startsWith(project.trimEnd()), toml);
  assert.match(toml, /\[mcp_servers\.c7\]\ntype = "stdio"\ncommand = "npx"/);
  assert.match(toml, /\[mcp_servers\.tm\]/);
  assert.match(toml, /\[agents\.codex\.mcp_servers\.gl\]/);
  assert.ok(!Object.hasOwn(r.files, '.ruler/ruler.project.toml'));
  assert.equal(read(p, '.ruler/ruler.project.toml'), project);
  assert.ok(r.generated.includes('.ruler/ruler.toml'));
  assert.ok(!r.generated.includes('.ruler/ruler.project.toml'));
});

test('compose 는 ruler.project.toml 이 없으면 기본 설정을 바탕으로 쓴다', t => {
  const { p } = guideProject(t);
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  assert.ok(r.files['.ruler/ruler.toml'].toString().startsWith(RULER_TOML_BASE(['claude', 'codex'])));
});

test('compose 는 프로젝트가 둔 같은 이름 MCP 표를 덮지 않고 mcp-conflict 를 낸다', t => {
  const { p } = guideProject(t);
  const project = 'default_agents = ["claude"]\n\n[mcp_servers.c7]\ncommand = "내 것"\n\n[mcp_servers.tm]\nx = { a = 1 }\n[mcp_servers.tm.sub]\nb = 2\n';
  write(p, '.ruler/ruler.project.toml', project);
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  const toml = r.files['.ruler/ruler.toml'].toString();
  assert.match(toml, /\[mcp_servers\.c7\]\ncommand = "내 것"\n/);
  assert.doesNotMatch(toml, /command = "npx"/);
  assert.match(toml, /\[agents\.codex\.mcp_servers\.gl\]/);
  const conflicts = r.todos.filter(x => x.kind === 'mcp-conflict');
  assert.deepEqual(conflicts.map(x => x.item).sort(), ['mcp/c7', 'mcp/tm']);
  assert.match(conflicts.find(x => x.item === 'mcp/c7').message, /ruler\.project\.toml/);
  assert.match(conflicts.find(x => x.item === 'mcp/tm').message, /하위 표/);
});

test('compose 는 블록에 없는 파일을 건드리지 않는다', t => {
  const { p } = guideProject(t);
  write(p, '.ruler/50-project.md', '# 프로젝트\n');
  write(p, '.ruler/skills/my-skill/SKILL.md', '---\nname: my-skill\n---\n');
  write(p, 'docs/guideline/notes.md', '내 메모\n');
  // 블록 밖에 잘못 든 위험한 경로는 지우지 않는다
  write(p, 'keep.txt', '안전\n');
  write(p, '.gitignore', 'node_modules\n# START guideline generated files\n/keep.txt\n/../x\n/.ruler/ruler.project.toml\n# END guideline generated files\n');
  write(p, '.ruler/ruler.project.toml', 'default_agents = ["claude"]\n');
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  for (const k of ['.ruler/50-project.md', '.ruler/skills/my-skill/SKILL.md', 'docs/guideline/notes.md', 'keep.txt', '.ruler/ruler.project.toml']) {
    assert.ok(!Object.hasOwn(r.files, k), k);
    assert.ok(!r.generated.includes(k), k);
  }
  const gi = r.files['.gitignore'].toString();
  assert.ok(gi.startsWith('node_modules\n# START guideline generated files\n'));
  assert.deepEqual(readBlock(gi), r.generated.map(x => `/${x}`));
});

test('compose 는 사라진 생성물을 지우고 멱등이다', t => {
  const { p } = guideProject(t);
  write(p, '.gitignore', 'node_modules\n');
  const first = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  applyDisk(p, first.files);
  // 같은 입력의 두 번째 조합은 바꿀 것이 없다(.gitignore 포함)
  assert.deepEqual(compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true }).files, {});

  // DEPLOY 스택을 빼면 그 생성물이 지워지고 블록에서 빠진다
  const less = checkManifest({ version: 3, form: 'ruler', agents: ['claude', 'codex'], sources: {
    company: { ...MANIFEST.sources.company, items: MANIFEST.sources.company.items.filter(i => i !== `rules/${DEPLOY}`) },
    team: MANIFEST.sources.team,
  } });
  const gone = first.generated.filter(x => x.includes(DEPLOY));
  assert.deepEqual(gone.sort(), [`.ruler/${DEPLOY}/01-y.md`, `.ruler/${DEPLOY}/99-reference.md`, `docs/guideline/${DEPLOY}/00-x.md`]);
  const second = compose({ project: p, manifest: less, nested: false, rulerAgentsEnabled: true });
  for (const g of gone) assert.equal(second.files[g], null, g);
  assert.ok(second.generated.every(x => !x.includes(DEPLOY)));
  const gi = second.files['.gitignore'].toString();
  assert.ok(gi.startsWith('node_modules\n'));
  assert.ok(readBlock(gi).every(x => !x.includes(DEPLOY)));
  applyDisk(p, second.files);
  for (const g of gone) assert.ok(!exists(p, g), g);
  assert.deepEqual(compose({ project: p, manifest: less, nested: false, rulerAgentsEnabled: true }).files, {});
});

test('compose 는 바뀐 파일만 낸다', t => {
  const { p } = guideProject(t);
  const first = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  applyDisk(p, first.files);
  write(p, '.ruler/base/00-a.md', '손으로 고침\n');
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  assert.deepEqual(Object.keys(r.files), ['.ruler/base/00-a.md']);
  assert.ok(r.files['.ruler/base/00-a.md'].equals(first.files['.ruler/base/00-a.md']));
});

test('compose 는 .guideline/overrides 를 .ruler/<스택>/ 로 복사한다', t => {
  const { p } = guideProject(t);
  write(p, '.guideline/overrides/base/override.md', '## 바꿈\n\nOverrides: `base/00-a.md`\r\n');
  write(p, '.guideline/overrides/base/web/override.d/a.md', '## 웹 바꿈\n');
  write(p, '.guideline/overrides/base/web/override.d/b.txt', '안 씀\n');
  write(p, '.guideline/overrides/team-base/override.d/z.md', '## 팀 바꿈\n');
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  assert.equal(r.files['.ruler/base/override.md'].toString(), '## 바꿈\n\nOverrides: `base/00-a.md`\r\n');
  assert.equal(r.files['.ruler/base/web/override.d/a.md'].toString(), '## 웹 바꿈\n');
  assert.equal(r.files['.ruler/team-base/override.d/z.md'].toString(), '## 팀 바꿈\n');
  assert.ok(!Object.keys(r.files).some(k => k.endsWith('b.txt')));
  for (const k of ['.ruler/base/override.md', '.ruler/base/web/override.d/a.md', '.ruler/team-base/override.d/z.md']) assert.ok(r.generated.includes(k), k);
  // 바꿈을 지우면 복사본도 지운다
  applyDisk(p, r.files);
  fs.rmSync(path.join(p, '.guideline/overrides/base/web'), { recursive: true });
  const again = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  assert.equal(again.files['.ruler/base/web/override.d/a.md'], null);
  assert.ok(!Object.hasOwn(again.files, '.ruler/base/override.md'));
});

test('compose 는 중첩 단위에서 루트 전용 항목을 빼고 중첩 기본 설정을 쓴다', t => {
  const { p } = guideProject(t);
  const r = compose({ project: p, manifest: MANIFEST, nested: true, rulerAgentsEnabled: true });
  assert.ok(r.generated.every(x => !x.startsWith('.ruler/skills/') && !x.startsWith('.ruler/agents/')), r.generated.join(', '));
  assert.equal(r.files['.ruler/ruler.toml'].toString(), NESTED_TOML_BASE(['claude', 'codex']));
  assert.ok(r.files['.ruler/base/00-a.md']);
  assert.ok(!r.todos.some(x => x.item?.startsWith('mcp/')), JSON.stringify(r.todos));
});

test('compose 는 [agents] 가 꺼져 있으면 서브에이전트를 조합하지 않는다', t => {
  const { p, old } = guideProject(t, MANIFEST, { rulerAgentsEnabled: false });
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: false });
  assert.ok(!Object.hasOwn(r.files, '.ruler/agents/rev.md'));
  assert.deepEqual(r.todos.filter(x => x.kind === 'subagents-off').map(x => x.item), ['agents/rev.md']);
  assert.deepEqual(Object.keys(r.files).filter(k => k !== '.gitignore').sort(), Object.keys(old.files).sort());
});

test('compose 는 매니페스트에 없는 출처의 관리 지침 사본을 넣지 않는다', t => {
  const { p } = guideProject(t);
  write(p, '.guideline/management/gone.md', '## 사라진 출처\n\n본문\n');
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  assert.doesNotMatch(r.files['.ruler/guideline.md'].toString(), /사라진 출처/);
});

test('compose 는 고르지 않은 스택의 바꿈을 옮기지 않고 override-unchosen 으로 알린다', t => {
  const { p } = guideProject(t);
  write(p, '.guideline/overrides/base/override.md', '## 바꿈\n');
  write(p, '.guideline/overrides/other/override.md', '## 안 고름\n');
  write(p, '.guideline/overrides/base/zzz/override.d/a.md', '## 고르지 않은 하위 스택\n');
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: true });
  assert.ok(r.files['.ruler/base/override.md']);
  assert.ok(!r.generated.some(x => x.startsWith('.ruler/other/') || x.startsWith('.ruler/base/zzz/')), r.generated.join(', '));
  assert.deepEqual(r.todos.filter(x => x.kind === 'override-unchosen').map(x => x.message), [
    '.guideline/overrides/base/zzz/: 고르지 않은 스택이라 바꿈을 조합하지 않음 — 스택을 고르거나 바꿈을 지우기',
    '.guideline/overrides/other/: 고르지 않은 스택이라 바꿈을 조합하지 않음 — 스택을 고르거나 바꿈을 지우기',
  ]);
});

test('compose 는 사본이 없는 고른 항목을 no-copy 로 알리고, 서브에이전트는 새 배치 문구로 알린다', t => {
  const { p } = guideProject(t, MANIFEST, { rulerAgentsEnabled: false });
  const r = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: false });
  // mcp/b 는 짓는 법만 있어 동기화가 사본을 쓰지 않는다
  assert.deepEqual(r.todos.filter(x => x.kind === 'no-copy').map(x => x.item), ['mcp/b']);
  assert.equal(r.todos.find(x => x.kind === 'subagents-off').message,
    'rev: .guideline/ 에 사본은 있지만 .ruler/ruler.project.toml 에 [agents] enabled = true 가 없어 조합하지 않음 — 켤지 결정(켜면 .gitignore 에 생성물이 추가됨)');
  fs.rmSync(path.join(p, `.guideline/rules/${DEPLOY}`), { recursive: true });
  const gone = compose({ project: p, manifest: MANIFEST, nested: false, rulerAgentsEnabled: false });
  assert.deepEqual(gone.todos.filter(x => x.kind === 'no-copy').map(x => x.item).sort(), ['mcp/b', `rules/${DEPLOY}`]);
});

test('사본 폴더의 frontmatter 없는 파일은 막힘 할 일로 빼고 나머지는 조합한다', t => {
  const p = dir(t);
  write(p, '.guideline/rules/base/00-a.md', `${ALWAYS}# a\n\nA\n`);
  write(p, '.guideline/rules/base/07-x.md', '# frontmatter 없음\n');
  const manifest = { version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://x', items: ['rules/base'], aliases: {} } } };
  const r = compose({ project: p, manifest });
  assert.deepEqual(r.todos.filter(x => x.kind === 'blocked').map(x => x.item), ['rules/base/07-x.md']);
  assert.equal(r.files['.ruler/base/00-a.md'].toString(), '# a\n\nA\n');
  assert.equal(Object.keys(r.files).some(f => f.includes('07-x')), false);
});
