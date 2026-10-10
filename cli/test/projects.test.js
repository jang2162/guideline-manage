import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, write } from './helpers.js';
import {
  PROJECTS_ENV, expandPath, baseDir, listProjects, folderNameProblem, newProjectTarget, projectStatus, createProject, targetProblem,
} from '../src/projects.js';

function dir(t) {
  const d = tmpDir('guideline-projects-');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('expandPath 는 ~ 를 홈으로 펼치고 앞뒤 공백과 끝의 / 를 정리해 절대경로로 만든다', () => {
  assert.equal(expandPath('~', '/home/me'), '/home/me');
  assert.equal(expandPath('~/a/새 폴더/', '/home/me'), '/home/me/a/새 폴더');
  assert.equal(expandPath('  /x/y/  ', '/home/me'), '/x/y');
  assert.equal(expandPath('rel', '/home/me'), path.resolve('rel'));
});

test('baseDir 는 환경 변수가 디렉터리일 때만 경로를 돌려준다', t => {
  const d = dir(t);
  write(d, 'file', '');
  assert.equal(PROJECTS_ENV, 'GUIDELINE_PROJECTS_DIR');
  assert.equal(baseDir({}), null);
  assert.equal(baseDir({ GUIDELINE_PROJECTS_DIR: path.join(d, 'file') }), null);
  assert.equal(baseDir({ GUIDELINE_PROJECTS_DIR: `${d}/` }), d);
});

test('listProjects 는 기본 경로 바로 아래 git 프로젝트를 이름순으로 돌려주고 문서 저장소와 숨김 디렉터리는 뺀다', t => {
  const base = dir(t);
  fs.mkdirSync(path.join(base, 'b-app/.git'), { recursive: true });
  write(base, 'a-wt/.git', 'gitdir: /elsewhere\n');
  fs.mkdirSync(path.join(base, 'not-git'));
  fs.mkdirSync(path.join(base, 'guideline/.git'), { recursive: true });
  fs.mkdirSync(path.join(base, '.hidden/.git'), { recursive: true });
  fs.mkdirSync(path.join(base, '새 프로젝트 1/.git'), { recursive: true });
  assert.deepEqual(listProjects(base, path.join(base, 'guideline')), [
    { name: 'a-wt', path: path.join(base, 'a-wt') },
    { name: 'b-app', path: path.join(base, 'b-app') },
    { name: '새 프로젝트 1', path: path.join(base, '새 프로젝트 1') },
  ]);
  assert.deepEqual(listProjects(null, base), []);
});

test('folderNameProblem 은 빈 이름, 경로 구분자, 점으로 시작하는 이름을 막고 한글·공백은 받는다', () => {
  assert.equal(folderNameProblem(''), '폴더 이름이 비어 있음');
  assert.equal(folderNameProblem('  '), '폴더 이름이 비어 있음');
  assert.equal(folderNameProblem('a/b'), '폴더 이름에 / 나 \\ 를 쓸 수 없음');
  assert.equal(folderNameProblem('a\\b'), '폴더 이름에 / 나 \\ 를 쓸 수 없음');
  assert.equal(folderNameProblem('..'), '폴더 이름은 . 으로 시작할 수 없음');
  assert.equal(folderNameProblem('새 프로젝트 1'), null);
});

test('newProjectTarget 은 이름이면 기본 경로 아래, 경로면 그대로 쓰고 비어 있지 않은 대상을 거부한다', t => {
  const base = dir(t);
  assert.deepEqual(newProjectTarget({ name: '새 앱', base }), { path: path.join(base, '새 앱') });
  assert.deepEqual(newProjectTarget({ name: 'x', base: null }), { error: 'GUIDELINE_PROJECTS_DIR 이 없어 폴더 이름만으로 만들 수 없음 — 경로를 쓴다' });
  assert.deepEqual(newProjectTarget({ name: '.x', base }), { error: '폴더 이름은 . 으로 시작할 수 없음' });
  fs.mkdirSync(path.join(base, 'empty'));
  assert.deepEqual(newProjectTarget({ path: `${path.join(base, 'empty')}/`, base: null }), { path: path.join(base, 'empty') });
  write(base, 'full/a.txt', 'x');
  assert.match(newProjectTarget({ name: 'full', base }).error, /이미 있고 비어 있지 않음 — 기존 프로젝트로 고른다$/);
  write(base, 'file', 'x');
  assert.match(newProjectTarget({ name: 'file', base }).error, /디렉터리가 아님$/);
});

test('projectStatus 는 .git 이 있으면 git status --porcelain 으로 더러운지 본다', t => {
  const d = dir(t);
  const calls = [];
  const git = (args, cwd) => {
    calls.push({ args, cwd });
    return { status: 0, stdout: ' M a.txt\n' };
  };
  assert.deepEqual(projectStatus(d, git), { isDir: true, gitRepo: false, dirty: false });
  fs.mkdirSync(path.join(d, '.git'));
  assert.deepEqual(projectStatus(d, git), { isDir: true, gitRepo: true, dirty: true });
  assert.deepEqual(calls, [{ args: ['status', '--porcelain'], cwd: d }]);
  assert.deepEqual(projectStatus(path.join(d, 'none'), git), { isDir: false, gitRepo: false, dirty: false });
});

const hasGit = spawnSync('git', ['--version']).status === 0;

test('createProject 는 디렉터리를 만들고 실제 git init 을 돈다', { skip: !hasGit && 'git 이 없다' }, t => {
  const target = path.join(dir(t), '새 프로젝트', 'app');
  assert.deepEqual(createProject(target), { ok: true });
  assert.ok(fs.existsSync(path.join(target, '.git')));
});

test('createProject 는 git init 이 실패하면 이유를 돌려준다', t => {
  const target = path.join(dir(t), 'x');
  assert.match(createProject(target, () => ({ status: 1, stdout: '' })).error, /git init 이 실패함$/);
});

test('targetProblem 은 상대경로와 문서 저장소 자신·그 안의 경로를 막는다', t => {
  const docs = dir(t);
  assert.equal(targetProblem('my-app', docs), '경로는 / 나 ~ 로 시작한다');
  assert.equal(targetProblem(docs, docs), '문서 저장소 자신이나 그 안은 고를 수 없음');
  assert.equal(targetProblem(`${docs}/x/`, docs), '문서 저장소 자신이나 그 안은 고를 수 없음');
  assert.equal(targetProblem('~/x', docs), null);
  assert.equal(targetProblem(`${docs}-other/x`, docs), null);
});

test('newProjectTarget 은 상대경로와 문서 저장소 안의 대상을 거부한다', t => {
  const base = dir(t);
  const docs = path.join(base, 'guideline');
  assert.deepEqual(newProjectTarget({ path: 'my-app', base, docsRoot: docs }), { error: '경로는 / 나 ~ 로 시작한다' });
  assert.deepEqual(newProjectTarget({ path: path.join(docs, 'app'), base, docsRoot: docs }), { error: '문서 저장소 자신이나 그 안은 고를 수 없음' });
  assert.deepEqual(newProjectTarget({ name: 'app', base, docsRoot: docs }), { path: path.join(base, 'app') });
});
