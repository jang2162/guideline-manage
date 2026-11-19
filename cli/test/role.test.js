import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir } from './helpers.js';
import { roleFile, readRole, writeRole } from '../src/role.js';

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

function repoWithWorktree(t) {
  const base = fs.realpathSync(tmpDir('guideline-role-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q');
  git(main, 'config', 'user.email', 't@example.com');
  git(main, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a');
  git(main, 'add', 'a.txt');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = path.join(base, 'wt');
  git(main, 'worktree', 'add', '-q', wt);
  return { base, main, wt };
}

test('메인과 링크 워크트리의 역할 파일은 서로 다르다', t => {
  const { main, wt } = repoWithWorktree(t);
  const common = fs.realpathSync(path.join(main, '.git'));
  assert.equal(roleFile(main), path.join(common, 'guideline', 'role'));
  assert.equal(roleFile(wt), path.join(common, 'worktrees', 'wt', 'guideline', 'role'));
  writeRole(main, 'ui');
  assert.deepEqual(readRole(main), { name: 'ui', bad: false });
  assert.deepEqual(readRole(wt), { name: null, bad: false });
});

test('writeRole(null) 은 파일을 지운다', t => {
  const { main } = repoWithWorktree(t);
  writeRole(main, 'ui');
  assert.ok(fs.existsSync(roleFile(main)));
  writeRole(main, null);
  assert.ok(!fs.existsSync(roleFile(main)));
  writeRole(main, null); // 없어도 오류 없음
});

test('깨진 역할 파일은 bad', t => {
  const { main } = repoWithWorktree(t);
  for (const body of ['UI\n', '']) {
    fs.mkdirSync(path.dirname(roleFile(main)), { recursive: true });
    fs.writeFileSync(roleFile(main), body);
    assert.deepEqual(readRole(main), { name: null, bad: true });
  }
  fs.writeFileSync(roleFile(main), '  api \nignored\n');
  assert.deepEqual(readRole(main), { name: 'api', bad: false });
});

test('git 이 아니면 roleFile 은 null', t => {
  const d = fs.realpathSync(tmpDir('guideline-nogit-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  assert.equal(roleFile(d), null);
  assert.deepEqual(readRole(d), { name: null, bad: false });
});
