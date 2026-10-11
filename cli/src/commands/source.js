import fs from 'node:fs';
import path from 'node:path';
import { expandPath } from '../projects.js';
import { remoteClient, loadSource, explain } from '../remote.js';
import { serverFor } from '../workspace.js';
import { changeOf, listFiles } from '../propose.js';
import { t } from '../i18n.js';

export const SOURCE_MARK = '.guideline-source.json';

/** 트리의 모든 파일 경로. */
function treePaths(tree) {
  const out = [];
  const walk = dir => {
    for (const e of tree.list(dir)) {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.dir) walk(p);
      else out.push(p);
    }
  };
  walk('');
  return out.sort();
}

/**
 * 원본 작업 사본의 변경: 폴더와 기준 트리를 파일마다 비교한다. 점 이름은 뺀다.
 * @param {{ base: import('../tree.js').Tree, folder: string }} opts
 */
export function folderChanges({ base, folder }) {
  const here = new Set(listFiles(folder));
  const changes = [];
  for (const rel of here) {
    const c = changeOf(base, rel, fs.readFileSync(path.join(folder, ...rel.split('/'))));
    if (c) changes.push(c);
  }
  for (const rel of treePaths(base)) {
    if (!here.has(rel)) {
      const c = changeOf(base, rel, null);
      if (c) changes.push(c);
    }
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * 서버 최신 원본을 빈 폴더에 푼다. 에이전트가 원본 경로로 고친 뒤 propose --from 으로 올린다.
 * @returns {Promise<number>}
 */
export async function source({
  dir, server, sourceName, env = process.env, out = console.log, err = console.error, fetchImpl = fetch, home, cwd = process.cwd(),
}) {
  if (!dir) {
    err(t('source.needFolder'));
    return 2;
  }
  const target = path.resolve(cwd, expandPath(dir));
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length > 0)) {
    err(t('source.notEmpty', { dir: target }));
    return 2;
  }
  const { url, token, error } = serverFor({ flag: server, sourceName, cwd, env, home });
  if (error) {
    err(error);
    return 2;
  }
  if (!url) {
    err(t('common.noServer'));
    return 2;
  }
  let src;
  try {
    src = await loadSource(remoteClient({ server: url, token, fetchImpl }));
  } catch (e) {
    err(explain(e, url));
    return 1;
  }
  for (const rel of treePaths(src.tree)) {
    const abs = path.join(target, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, src.tree.read(rel));
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, SOURCE_MARK), `${JSON.stringify({ server: url, revision: src.revision }, null, 2)}\n`);
  out(t('source.done', { rev: src.revision, dir: target }));
  return 0;
}
