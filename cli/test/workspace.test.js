import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write, ALWAYS } from './helpers.js';
import { SOURCE, memProject } from './render-fixture.js';
import { memoryTree } from '../src/tree.js';
import { checkManifest } from '../src/manifest.js';
import { render } from '../src/render/index.js';
import { virtualize, toRealLock, tokenFor, aliasMoveTodos, showId, protectedPaths } from '../src/workspace.js';

const dir = t => {
  const d = tmpDir('guideline-ws-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

test('virtualize: 두 출처를 별칭과 함께 합치고 잠금을 실제 id 로 되돌린다', () => {
  const trees = new Map([
    ['company', { server: 'http://c', revision: 7, tree: memoryTree({ ...SOURCE, 'docs/management.md': '## 보안\n\n검토\n' }) }],
    ['personal', { server: 'http://p', revision: 3, tree: memoryTree(SOURCE) }],
  ]);
  const manifest = checkManifest({ version: 2, form: 'ruler', agents: ['claude'], sources: {
    company: { server: 'http://c', items: ['rules/base/00-a.md'], aliases: { 'rules/base': 'company-base' } },
    personal: { server: 'http://p', items: ['rules/base/00-a.md'] },
  } });
  const v = virtualize({ manifest, lock: null, trees });
  assert.deepEqual([...v.view.items].sort(), ['rules/base', 'rules/company-base']);
  assert.deepEqual(v.management.stackSource, { base: 'personal', 'company-base': 'company' });
  assert.deepEqual(v.management.additions, [{ source: 'company', text: '## 보안\n\n검토\n' }]);
  const r = render({ tree: v.tree, revision: 0, manifest: v.view, lock: null, project: memProject(), management: v.management });
  const real = toRealLock({ viewLock: r.lock, sources: v.sources, revisions: { company: 7, personal: 3 } });
  assert.deepEqual(real.revisions, { company: 7, personal: 3 });
  assert.ok(real.sources['company:rules/base/00-a.md'] && real.sources['personal:rules/base/00-a.md']);
  assert.ok(real.outputs.some(o => o.path === '.ruler/company-base/00-a.md' && o.items[0] === 'company:rules/base/00-a.md'));
  assert.equal(showId('rules/company-base/00-a.md', v.sources), 'company:rules/base/00-a.md');
});

test('tokenFor: GUIDELINE_TOKEN 은 출처가 하나일 때만', t => {
  const env = { GUIDELINE_TOKEN: 'glt_x', XDG_CONFIG_HOME: dir(t) };
  assert.equal(tokenFor('http://a', { env, single: true }), 'glt_x');
  assert.equal(tokenFor('http://a', { env, single: false }), null);
});

test('aliasMoveTodos: 별칭이 바뀌어 빈 자리의 바꿈 파일을 알린다', t => {
  const p = dir(t);
  write(p, '.ruler/base/override.md', '# 바꿈\n');
  const prev = { version: 2, revisions: { c: 1 }, sources: {}, outputs: [{ path: '.ruler/base/00-a.md', items: ['c:rules/base/00-a.md'], hash: 'h' }] };
  const next = { version: 2, revisions: { c: 2 }, sources: {}, outputs: [{ path: '.ruler/company-base/00-a.md', items: ['c:rules/base/00-a.md'], hash: 'h' }] };
  assert.deepEqual(aliasMoveTodos({ previous: prev, next, project: p }).map(x => x.kind), ['alias']);
});

const NEO = { ...SOURCE, 'rules/browser/00-a.md': `${ALWAYS}# 에이\n`, 'rules/browser/neo/00-x.md': `${ALWAYS}# 엑스\n` };

test('별칭 부모 아래 하위 스택', () => {
  const trees = new Map([['default', { server: 'http://d', revision: 1, tree: memoryTree(NEO) }]]);
  const manifest = checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: {
    default: { server: 'http://d', items: ['rules/browser', 'rules/browser/neo'], aliases: { 'rules/browser': 'web' } },
  } });
  const v = virtualize({ manifest, lock: null, trees });
  const r = render({ tree: v.tree, revision: 0, manifest: v.view, lock: null, project: memProject(), management: v.management });
  assert.ok(r.files['.ruler/web/neo/00-x.md']);
  assert.equal(r.files['.ruler/browser/neo/00-x.md'], undefined);
  const real = toRealLock({ viewLock: r.lock, sources: v.sources, revisions: { default: 1 } });
  assert.ok(real.sources['default:rules/browser/neo/00-x.md']);
  assert.ok(real.outputs.some(o => o.path === '.ruler/web/neo/00-x.md' && o.items[0] === 'default:rules/browser/neo/00-x.md'));
  assert.equal(showId('rules/web/neo/00-x.md', v.sources, true), 'default:rules/browser/neo/00-x.md');
});

test('protectedPaths: 닿지 못한 출처의 하위 스택 색인도 지키고, 부모를 다른 출처가 가졌어도 자식 폴더는 자식 소유자의 것이다', () => {
  const manifest = { sources: {
    a: { server: 'http://a', items: ['rules/base'], aliases: {} },
    b: { server: 'http://b', items: ['rules/base/sub', 'rules/browser', 'rules/browser/neo'], aliases: {} },
  } };
  const idx = p => ({ path: p, items: [], hash: 'h' });
  const lock = { version: 2, revisions: {}, sources: {}, outputs: [
    idx('.ruler/base/99-reference.md'), idx('.ruler/base/sub/99-reference.md'),
    idx('.ruler/browser/99-reference.md'), idx('.ruler/browser/neo/99-reference.md'),
  ] };
  assert.deepEqual([...protectedPaths({ manifest, lock, failed: ['b'] })].sort(),
    ['.ruler/base/sub/99-reference.md', '.ruler/browser/99-reference.md', '.ruler/browser/neo/99-reference.md']);
  assert.deepEqual([...protectedPaths({ manifest, lock, failed: ['a'] })], ['.ruler/base/99-reference.md']);
});

test('aliasMoveTodos: 하위 스택 자리의 바꿈 파일도 그 하위 스택 경로로 알린다', t => {
  const p = dir(t);
  write(p, '.ruler/web/neo/override.md', '# 바꿈\n');
  const out = path => ({ path, items: ['c:rules/browser/neo/00-x.md'], hash: 'h' });
  const prev = { version: 2, revisions: { c: 1 }, sources: {}, outputs: [out('.ruler/web/neo/00-x.md')] };
  const next = { version: 2, revisions: { c: 2 }, sources: {}, outputs: [out('.ruler/www/neo/00-x.md')] };
  const todos = aliasMoveTodos({ previous: prev, next, project: p });
  assert.equal(todos.length, 1);
  assert.match(todos[0].message, /web\/neo/);
});

test('showId: 다중 출처에서 원본이 뺀 파일 id 도 출처를 붙여 보인다', () => {
  const sources = [
    { name: 'a', items: ['rules/base'], aliases: {} },
    { name: 'b', items: ['rules/base'], aliases: { 'rules/base': 'b-base' } },
  ];
  assert.equal(showId('rules/base/09-gone.md', sources), 'a:rules/base/09-gone.md');
  assert.equal(showId('rules/b-base/09-gone.md', sources), 'b:rules/base/09-gone.md');
  assert.equal(showId('rules/base/LICENSE', sources), 'a:rules/base/LICENSE');
});
