import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write } from './helpers.js';
import { SOURCE, memProject } from './render-fixture.js';
import { memoryTree } from '../src/tree.js';
import { checkManifest } from '../src/manifest.js';
import { render } from '../src/render/index.js';
import { virtualize, toRealLock, tokenFor, aliasMoveTodos, showId } from '../src/workspace.js';

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
  assert.deepEqual([...v.view.items].sort(), ['rules/base/00-a.md', 'rules/company-base/00-a.md']);
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
