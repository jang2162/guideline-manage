import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { t } from './i18n.js';

/** 프로젝트를 모아 두는 기본 경로의 환경 변수. */
export const PROJECTS_ENV = 'GUIDELINE_PROJECTS_DIR';

/** @typedef {(args: string[], cwd: string) => { status: number, stdout: string }} GitRunner */

/** @type {GitRunner} extraEnv 는 process.env 위에 얹는다(fetch 가 비밀번호를 묻지 않게 할 때 쓴다). */
export function runGit(args, cwd, extraEnv) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: extraEnv ? { ...process.env, ...extraEnv } : process.env });
  if (r.error) return { status: 1, stdout: '' };
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

/** 앞뒤 공백을 떼고 `~` 를 홈으로 펼쳐 절대경로로 만든다. 끝의 / 는 떨어진다. */
export function expandPath(p, home = os.homedir()) {
  const t = p.trim();
  if (t === '~') return home;
  if (t.startsWith('~/')) return path.resolve(home, t.slice(2));
  return path.resolve(t);
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 기본 경로. 환경 변수가 없거나 디렉터리가 아니면 null. */
export function baseDir(env = process.env) {
  const v = env[PROJECTS_ENV];
  if (!v) return null;
  const p = expandPath(v);
  return isDir(p) ? p : null;
}

/**
 * 기본 경로 바로 아래 git 프로젝트(.git 이 디렉터리나 파일). 문서 저장소 자신과 점으로 시작하는 디렉터리는 뺀다.
 * @param {string | null} base
 * @param {string} docsRoot
 * @returns {{ name: string, path: string }[]}
 */
export function listProjects(base, docsRoot) {
  if (!base) return [];
  const self = fs.realpathSync(docsRoot);
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => ({ name: d.name, path: path.join(base, d.name) }))
    .filter(p => fs.existsSync(path.join(p.path, '.git')) && fs.realpathSync(p.path) !== self)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 폼에 쓴 대상 경로의 문제. 없으면 null.
 * 상대경로는 문서 저장소 기준으로 풀려 그 안에 저장소를 만들게 되므로 받지 않는다.
 * @param {string} p 폼에 쓴 그대로의 경로
 * @param {string} [docsRoot]
 */
export function targetProblem(p, docsRoot) {
  const v = p.trim();
  if (v !== '~' && !v.startsWith('~/') && !path.isAbsolute(v)) return t('projects.absolutePath');
  if (docsRoot) {
    const rel = path.relative(path.resolve(docsRoot), expandPath(v));
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return t('projects.insideDocs');
  }
  return null;
}

/** 새 폴더 이름의 문제. 없으면 null. */
export function folderNameProblem(name) {
  if (!name || name.trim() === '') return t('projects.emptyName');
  if (/[/\\]/.test(name)) return t('projects.badName');
  if (name.startsWith('.')) return t('projects.hiddenName');
  return null;
}

/**
 * 새 프로젝트를 만들 경로를 정하고 검사한다. 경로가 있으면 경로를, 없으면 기본 경로 아래 이름을 쓴다.
 * 비어 있는 디렉터리는 받는다.
 * @param {{ name?: string, path?: string, base: string | null, docsRoot?: string }} opts
 * @returns {{ path: string } | { error: string }}
 */
export function newProjectTarget({ name, path: p, base, docsRoot }) {
  let target;
  if (p && p.trim()) {
    const problem = targetProblem(p, docsRoot);
    if (problem) return { error: problem };
    target = expandPath(p);
  } else {
    if (!base) return { error: t('projects.noBase', { env: PROJECTS_ENV }) };
    const problem = folderNameProblem(name);
    if (problem) return { error: problem };
    target = path.join(base, name.trim());
  }
  if (fs.existsSync(target)) {
    if (!isDir(target)) return { error: t('projects.notDir', { path: target }) };
    if (fs.readdirSync(target).length > 0) return { error: t('projects.notEmpty', { path: target }) };
  }
  return { path: target };
}

/**
 * dir 이 든 git 저장소의 루트(실제 경로). git 저장소가 아니면 null.
 * @param {string} dir
 * @param {GitRunner} [git]
 */
export function gitRoot(dir, git = runGit) {
  const r = git(['rev-parse', '--show-toplevel'], dir);
  return r.status === 0 && r.stdout.trim() ? fs.realpathSync(r.stdout.trim()) : null;
}

/**
 * 기존 프로젝트의 상태. .git 이 있을 때만 git status --porcelain 으로 더러운지 본다.
 * @param {string} dir
 * @param {GitRunner} [git]
 * @param {string} [root] git 루트(중첩 단위면 단위 디렉터리와 다르다)
 * @returns {{ isDir: boolean, gitRepo: boolean, dirty: boolean }}
 */
export function projectStatus(dir, git = runGit, root = dir) {
  if (!isDir(dir)) return { isDir: false, gitRepo: false, dirty: false };
  const gitRepo = fs.existsSync(path.join(root, '.git'));
  const dirty = gitRepo && git(['status', '--porcelain'], root).stdout.trim() !== '';
  return { isDir: true, gitRepo, dirty };
}

/**
 * 새 프로젝트를 만든다: 디렉터리(mkdir -p)와 git init.
 * @param {string} dir
 * @param {GitRunner} [git]
 * @returns {{ ok: true } | { error: string }}
 */
export function createProject(dir, git = runGit) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { error: t('projects.mkdirFailed', { path: dir, reason: e.message }) };
  }
  if (git(['init'], dir).status !== 0) return { error: t('projects.gitInitFailed', { path: dir }) };
  return { ok: true };
}
