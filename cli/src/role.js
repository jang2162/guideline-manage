import fs from 'node:fs';
import path from 'node:path';
import { runGit } from './projects.js';
import { NAME } from './sources.js';

/**
 * 이 워크트리의 역할 파일 자리: `<이 워크트리의 git 디렉터리>/guideline/role`.
 * 메인은 `<공용>/guideline/role`, 링크 워크트리는 `<공용>/worktrees/<이름>/guideline/role` 이라 워크트리마다 따로다.
 * git 저장소가 아니면 null.
 * @param {string} dir
 * @param {import('./projects.js').GitRunner} [git]
 * @returns {string | null}
 */
export function roleFile(dir, git = runGit) {
  const r = git(['rev-parse', '--path-format=absolute', '--git-dir'], dir);
  const out = r.status === 0 ? r.stdout.trim() : '';
  if (!out) return null;
  try {
    return path.join(fs.realpathSync(out), 'guideline', 'role');
  } catch {
    return null;
  }
}

/**
 * 이 워크트리의 역할. 파일이 없으면 이름 없음, 첫 줄이 역할 이름 규칙에 맞지 않으면(빈 값 포함) bad.
 * @returns {{ name: string | null, bad: boolean }}
 */
export function readRole(dir, git = runGit) {
  const file = roleFile(dir, git);
  if (!file || !fs.existsSync(file)) return { name: null, bad: false };
  const first = fs.readFileSync(file, 'utf8').split('\n')[0].trim();
  return NAME.test(first) ? { name: first, bad: false } : { name: null, bad: true };
}

/** 역할을 정한다. null 이면 파일을 지운다. git 저장소가 아니면 아무것도 하지 않는다. */
export function writeRole(dir, name, git = runGit) {
  const file = roleFile(dir, git);
  if (!file) return;
  if (name === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${name}\n`);
}
