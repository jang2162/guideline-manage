import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write } from './helpers.js';
import {
  GUIDE_DIR, PROJECT_TOML, RULER_TOML, BLOCK_START, BLOCK_END,
  copyPath, idOfCopy, overridePath, managementCopy, rulerTomlText, layoutOf,
} from '../src/layout.js';
import { MANIFEST, LOCK, checkLock, lockText } from '../src/manifest.js';

function dir(t) {
  const d = tmpDir('guideline-layout-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

const lockOf = version => ({ version, revisions: { default: 1 }, sources: {}, outputs: [] });
const MANIFEST_TEXT = JSON.stringify({ version: 3, form: 'ruler', agents: ['claude'], sources: {} });

test('상수는 계약의 값이다', () => {
  assert.equal(GUIDE_DIR, '.guideline');
  assert.equal(PROJECT_TOML, '.ruler/ruler.project.toml');
  assert.equal(RULER_TOML, '.ruler/ruler.toml');
  assert.equal(BLOCK_START, '# START guideline generated files');
  assert.equal(BLOCK_END, '# END guideline generated files');
});

test('copyPath·idOfCopy 는 서로 역이다', () => {
  assert.equal(copyPath('rules/browser/neo/00-x.md'), '.guideline/rules/browser/neo/00-x.md');
  assert.equal(idOfCopy('.guideline/skills/s/SKILL.md'), 'skills/s/SKILL.md');
  assert.equal(idOfCopy('.ruler/base/00-a.md'), null);
  for (const id of ['rules/base/00-a.md', 'skills/s/SKILL.md', 'agents/rev.md', 'mcp/c7']) {
    assert.equal(idOfCopy(copyPath(id)), id);
  }
});

test('idOfCopy 는 오버라이드·관리 문서 사본을 지침 id 로 보지 않는다', () => {
  assert.equal(idOfCopy(overridePath('base')), null);
  assert.equal(idOfCopy(managementCopy('company')), null);
  assert.equal(idOfCopy('.guideline'), null);
  assert.equal(idOfCopy('.guideline/'), null);
  assert.equal(idOfCopy('.guidelinex/rules/a.md'), null);
});

test('overridePath·managementCopy', () => {
  assert.equal(overridePath('base'), '.guideline/overrides/base/override.md');
  assert.equal(overridePath('web/neo', 'extra.md'), '.guideline/overrides/web/neo/extra.md');
  assert.equal(managementCopy('company'), '.guideline/management/company.md');
});

test('rulerTomlText 는 ruler.project.toml 을 먼저 읽는다', t => {
  const p = dir(t);
  assert.equal(rulerTomlText(p), null);
  write(p, RULER_TOML, 'old = true\n');
  assert.equal(rulerTomlText(p), 'old = true\n');
  write(p, PROJECT_TOML, 'new = true\n');
  assert.equal(rulerTomlText(p), 'new = true\n');
});

test('layoutOf 는 잠금 버전과 디스크로 배치를 가른다', t => {
  const p = dir(t);
  assert.equal(layoutOf(null, p), 'none');
  assert.equal(layoutOf(lockOf(3), p), 'guideline');
  assert.equal(layoutOf(lockOf(2), p), 'ruler');
  assert.equal(layoutOf(lockOf(1), p), 'ruler');
});

test('layoutOf: 잠금 없이 매니페스트와 .ruler/<스택>/ 사본이 있으면 ruler, 사본이 없으면 none', t => {
  const p = dir(t);
  write(p, '.ruler/base/00-a.md', 'a\n'); // 매니페스트 없이 사본만 — 잠금도 매니페스트도 없다
  assert.equal(layoutOf(null, p), 'none');
  write(p, MANIFEST, MANIFEST_TEXT);
  assert.equal(layoutOf(null, p), 'ruler');
  const q = dir(t);
  write(q, MANIFEST, MANIFEST_TEXT);
  write(q, RULER_TOML, 'default_agents = ["claude"]\n'); // 파일만 있고 스택 폴더는 없다 — 아직 아무것도 받지 않았다
  assert.equal(layoutOf(null, q), 'none');
});

test('layoutOf: 잠금이 있으면 디스크는 보지 않는다', t => {
  const p = dir(t);
  write(p, '.ruler/base/00-a.md', 'a\n');
  assert.equal(layoutOf(lockOf(3), p), 'guideline');
});

test('checkLock 은 v3 을 v3 로 돌려주고 lockText 는 버전을 지킨다', () => {
  const v3 = {
    version: 3, revisions: { default: 2 }, sources: { 'default:rules/base/00-a.md': 'h1' },
    outputs: [{ path: '.guideline/rules/base/00-a.md', items: ['default:rules/base/00-a.md'], hash: 'h2' }],
  };
  assert.deepEqual(checkLock(v3), v3);
  assert.equal(JSON.parse(lockText(v3)).version, 3);
  assert.deepEqual(checkLock(JSON.parse(lockText(v3))), v3);
  const v2 = { ...v3, version: 2 };
  assert.equal(checkLock(v2).version, 2);
  assert.equal(JSON.parse(lockText(v2)).version, 2);
  assert.equal(checkLock({ version: 1, revision: 1, sources: {}, outputs: [] }).version, 2);
  assert.throws(() => checkLock({ ...v3, version: 4 }), /version/);
  assert.ok(LOCK);
});
