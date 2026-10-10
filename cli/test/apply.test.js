import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, write, read, exists } from './helpers.js';
import { applyFiles, ApplyError, pathProblemIn } from '../src/apply.js';

function project(t) {
  const dir = tmpDir('guideline-apply-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('쓰고 지우고, 임시 파일을 남기지 않는다', t => {
  const p = project(t);
  write(p, 'old.md', 'x');
  const r = applyFiles(p, { 'a/b/c.md': '가', 'bin.png': Buffer.from([1, 2]), 'old.md': null, 'none.md': null });
  assert.deepEqual(r, { written: ['a/b/c.md', 'bin.png'], deleted: ['old.md'] });
  assert.equal(read(p, 'a/b/c.md'), '가');
  assert.deepEqual([...fs.readFileSync(path.join(p, 'bin.png'))], [1, 2]);
  assert.equal(exists(p, 'old.md'), false);
  assert.deepEqual(fs.readdirSync(path.join(p, 'a/b')), ['c.md']);
});

test('지운 뒤 관리하는 자리의 빈 디렉터리만 지운다', t => {
  const p = project(t);
  write(p, 'docs/guideline/x/00-a.md', 'a');
  write(p, '.claude/skills/s/img/a.png', 'a');
  write(p, 'src/keep/a.md', 'a');
  applyFiles(p, { 'docs/guideline/x/00-a.md': null, '.claude/skills/s/img/a.png': null, 'src/keep/a.md': null });
  assert.equal(exists(p, 'docs/guideline'), false);
  assert.equal(exists(p, '.claude/skills/s'), false);
  assert.equal(exists(p, '.claude/skills'), true);
  assert.equal(exists(p, 'src/keep'), true);
});

test('프로젝트 밖 경로는 하나라도 있으면 아무것도 쓰지 않는다', t => {
  const p = project(t);
  for (const bad of ['../x.md', '/etc/x', 'a/../../x', 'a//b', 'a\\b']) assert.ok(pathProblemIn(bad), bad);
  assert.throws(() => applyFiles(p, { 'ok.md': 'x', '../evil.md': 'x' }), ApplyError);
  assert.equal(exists(p, 'ok.md'), false);
});

test('심볼릭 링크로 프로젝트 밖을 가리키는 조상은 거부하고, 안을 가리키면 쓴다', t => {
  const p = project(t);
  const outside = project(t);
  fs.symlinkSync(outside, path.join(p, 'docs'));
  assert.throws(() => applyFiles(p, { 'docs/guideline/a.md': 'x' }), /프로젝트 밖/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.mkdirSync(path.join(p, 'real'));
  fs.symlinkSync(path.join(p, 'real'), path.join(p, 'alias'));
  applyFiles(p, { 'alias/a.md': 'y' });
  assert.equal(read(p, 'real/a.md'), 'y');
});
