import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, write } from './helpers.js';
import { runGit } from '../src/projects.js';
import { manifestText } from '../src/manifest.js';
import { unitInfo, unitProblem, rootNestedOn, rootStacks, NOT_RULER, INSTRUCTIONS_GONE } from '../src/unit.js';

function repo(t) {
  const d = tmpDir('guideline-unit-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  runGit(['init', '-q'], d);
  return fs.realpathSync(d);
}

test('unitInfo 는 git 루트와 중첩 여부를 낸다', t => {
  const root = repo(t);
  fs.mkdirSync(path.join(root, 'packages', 'api'), { recursive: true });
  assert.deepEqual(unitInfo(root), { dir: root, root, nested: false });
  const sub = path.join(root, 'packages', 'api');
  assert.deepEqual(unitInfo(sub), { dir: sub, root, nested: true });
  const plain = tmpDir('guideline-nogit-');
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  assert.equal(unitInfo(plain).nested, false);
});

test('unitProblem 은 .ruler/ 없음과 instructions 매니페스트를 거부한다', t => {
  const root = repo(t);
  assert.equal(unitProblem(root, null), NOT_RULER(root));
  write(root, '.ruler/ruler.toml', '');
  assert.equal(unitProblem(root, null), null);
  assert.equal(unitProblem(root, { form: 'instructions' }), INSTRUCTIONS_GONE());
  assert.equal(unitProblem(root, { form: 'ruler' }), null);
});

test('rootNestedOn 과 rootStacks', t => {
  const root = repo(t);
  assert.equal(rootNestedOn(root), false);
  write(root, '.ruler/ruler.toml', 'default_agents = ["claude"]\nnested = true # 모노레포\n');
  assert.equal(rootNestedOn(root), true);
  assert.deepEqual(rootStacks(root), []);
  write(root, 'guideline.json', manifestText({
    version: 1, server: 'http://x', form: 'ruler', instructionFiles: [], agents: ['claude'],
    items: ['rules/base/00-a.md', 'rules/base/SETUP.md', 'rules/orca/01-b.md', 'skills/s'],
  }));
  assert.deepEqual(rootStacks(root), ['base', 'orca']);
});
