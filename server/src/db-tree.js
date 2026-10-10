import { pathsTree } from '../../cli/src/tree.js';

/**
 * 리비전 rev 시점의 저장소를 트리로 읽는다. 파일 목록은 만들 때 한 번 읽고, 내용은 읽을 때 가져온다.
 * 목록 해석 코드(cli/src/catalog.js)에 그대로 넘긴다.
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {number} [rev]
 * @returns {import('../../cli/src/tree.js').Tree}
 */
export function dbTree(store, rev = store.headRevision()) {
  return pathsTree(store.pathsAt(rev).map(f => f.path), p => store.fileAt(p, rev));
}
