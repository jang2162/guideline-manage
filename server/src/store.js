import crypto from 'node:crypto';
import { writeProblems } from '../../cli/src/store-paths.js';
import { t } from '../../cli/src/i18n.js';

export class ConflictError extends Error {
  /** @param {string[]} paths 지금 해시가 base 와 다른 경로 */
  constructor(paths) {
    super(t('store.conflict', { paths: paths.join(', ') }));
    this.paths = paths;
  }
}

export class WriteError extends Error {
  /** @param {{ path: string, message: string }[]} problems */
  constructor(problems) {
    super(problems.map(p => (p.path ? `${p.path}: ${p.message}` : p.message)).join('\n'));
    this.problems = problems;
  }
}

/** @param {Buffer} buf */
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// node:sqlite 는 BLOB 을 Uint8Array 로, 행을 프로토타입 없는 객체로 돌려준다. 밖으로는 Buffer 와 보통 객체로 낸다.
const toBuffer = v => (v === null || v === undefined ? null : Buffer.from(v.buffer, v.byteOffset, v.byteLength));
const plain = row => (row ? { ...row } : null);
const byFirst = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 경로별 파일과 그 이력. 한 번의 쓰기가 리비전 하나다.
 * @param {import('node:sqlite').DatabaseSync} db openDb 로 연 DB
 * @param {{ now?: () => Date }} [opts]
 */
export function createStore(db, { now = () => new Date() } = {}) {
  const q = {
    head: db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM revisions'),
    headHashes: db.prepare('SELECT path, hash FROM head'),
    contentByHash: db.prepare('SELECT content FROM file_versions WHERE hash = ? AND content IS NOT NULL LIMIT 1'),
    lastRevisionWithHash: db.prepare('SELECT MAX(revision_id) AS r FROM file_versions WHERE path = ? AND hash = ?'),
    insertRevision: db.prepare('INSERT INTO revisions (created_at, author, token_id, message, source) VALUES (?, ?, ?, ?, ?)'),
    insertVersion: db.prepare('INSERT INTO file_versions (path, revision_id, content, hash) VALUES (?, ?, ?, ?)'),
    upsertHead: db.prepare(
      'INSERT INTO head (path, revision_id, hash) VALUES (?, ?, ?) '
      + 'ON CONFLICT(path) DO UPDATE SET revision_id = excluded.revision_id, hash = excluded.hash',
    ),
    deleteHead: db.prepare('DELETE FROM head WHERE path = ?'),
    fileAt: db.prepare('SELECT content, hash FROM file_versions WHERE path = ? AND revision_id <= ? ORDER BY revision_id DESC LIMIT 1'),
    pathsAt: db.prepare(`SELECT fv.path AS path, fv.hash AS hash, length(fv.content) AS size
      FROM file_versions fv
      JOIN (SELECT path, MAX(revision_id) AS r FROM file_versions WHERE revision_id <= ? GROUP BY path) last
        ON fv.path = last.path AND fv.revision_id = last.r
      WHERE fv.content IS NOT NULL
      ORDER BY fv.path`),
    revision: db.prepare('SELECT id, created_at AS createdAt, author, token_id AS tokenId, message, source FROM revisions WHERE id = ?'),
    revisions: db.prepare(`SELECT r.id AS id, r.created_at AS createdAt, r.author AS author, r.token_id AS tokenId,
        r.message AS message, r.source AS source,
        (SELECT COUNT(*) FROM file_versions f WHERE f.revision_id = r.id) AS files
      FROM revisions r WHERE r.id < ? ORDER BY r.id DESC LIMIT ?`),
    versionsIn: db.prepare('SELECT path, hash FROM file_versions WHERE revision_id = ? ORDER BY path'),
    fileHistory: db.prepare(`SELECT r.id AS id, r.created_at AS createdAt, r.author AS author, r.token_id AS tokenId,
        r.message AS message, r.source AS source, f.hash AS hash
      FROM file_versions f JOIN revisions r ON r.id = f.revision_id
      WHERE f.path = ? AND r.id < ? ORDER BY r.id DESC LIMIT ?`),
    touchedAfter: db.prepare('SELECT 1 AS x FROM file_versions WHERE path = ? AND revision_id > ? LIMIT 1'),
  };

  /** 최신 리비전 번호. 없으면 0. */
  function headRevision() {
    return q.head.get().id;
  }

  /** 지금 있는 파일의 경로 → 해시. */
  function headHashes() {
    return new Map(q.headHashes.all().map(r => [r.path, r.hash]));
  }

  /** 리비전 rev 시점의 내용. 없거나 지워졌으면 null. */
  function fileAt(path, rev = headRevision()) {
    const row = q.fileAt.get(path, rev);
    return row ? toBuffer(row.content) : null;
  }

  /** 리비전 rev 시점의 해시. 없거나 지워졌으면 null. */
  function hashAt(path, rev = headRevision()) {
    const row = q.fileAt.get(path, rev);
    return row ? row.hash : null;
  }

  /** 리비전 rev 시점에 있는 파일. 경로순. */
  function pathsAt(rev = headRevision()) {
    return q.pathsAt.all(rev).map(plain);
  }

  /** 해시가 같은 아무 버전의 내용. 제안의 기준 내용을 찾을 때 쓴다. 없으면 null. */
  function contentByHash(hash) {
    const row = q.contentByHash.get(hash);
    return row ? Buffer.from(row.content) : null;
  }

  /** path 가 내용 hash 였던 마지막 리비전. 없으면 null. 옛 버전으로 되돌리는 제안을 알아볼 때 쓴다. */
  function lastRevisionWithHash(path, hash) {
    return q.lastRevisionWithHash.get(path, hash)?.r ?? null;
  }

  /**
   * 바뀐 것만으로 리비전 하나를 만든다. 남는 변경이 없으면 리비전을 만들지 않는다.
   * @param {{ changes: Record<string, Buffer | string | null>, base?: Record<string, string | null>,
   *   author: string, tokenId?: number | null, message: string, source: 'import' | 'web' | 'revert' | 'proposal' }} input
   *   base 는 경로 → 쓰기 전에 본 해시(null 은 없던 파일). 하나라도 지금과 다르면 ConflictError
   * @returns {number | null} 새 리비전 번호
   */
  function commit({ changes, base, author, tokenId = null, message, source }) {
    if (!message || !message.trim()) throw new WriteError([{ path: '', message: t('store.emptyMessage') }]);
    const normalized = {};
    const duplicated = [];
    for (const [p, c] of Object.entries(changes)) {
      const n = p.normalize('NFC');
      if (Object.hasOwn(normalized, n)) duplicated.push({ path: n, message: t('store.duplicatePath') });
      normalized[n] = c === null ? null : Buffer.isBuffer(c) ? c : Buffer.from(c);
    }
    if (duplicated.length) throw new WriteError(duplicated);

    const hashes = headHashes();
    const problems = writeProblems(normalized, hashes.keys());
    if (problems.length) throw new WriteError(problems);
    if (base) {
      const stale = Object.entries(base)
        .map(([p, h]) => [p.normalize('NFC'), h])
        .filter(([p, h]) => (hashes.get(p) ?? null) !== h)
        .map(([p]) => p);
      if (stale.length) throw new ConflictError(stale);
    }

    const effective = Object.entries(normalized)
      .map(([p, c]) => [p, c, c === null ? null : sha256(c)])
      .filter(([p, c, h]) => (c === null ? hashes.has(p) : hashes.get(p) !== h))
      .sort(byFirst);
    if (effective.length === 0) return null;

    db.exec('BEGIN IMMEDIATE');
    try {
      const id = Number(q.insertRevision.run(now().toISOString(), author, tokenId, message, source).lastInsertRowid);
      for (const [p, c, h] of effective) {
        q.insertVersion.run(p, id, c, h);
        if (c === null) q.deleteHead.run(p);
        else q.upsertHead.run(p, id, h);
      }
      db.exec('COMMIT');
      return id;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  /** 리비전 하나의 정보. 없으면 null. */
  function revision(id) {
    return plain(q.revision.get(id));
  }

  /**
   * 리비전 목록, 최신순.
   * @param {{ before?: number, limit?: number }} [opts] before 보다 작은 번호만
   */
  function revisions({ before = headRevision() + 1, limit = 50 } = {}) {
    return q.revisions.all(before, limit).map(plain);
  }

  /** 리비전 id 가 바꾼 파일. 경로순. */
  function changes(id) {
    return q.versionsIn.all(id).map(({ path, hash }) => {
      const before = hashAt(path, id - 1);
      const kind = hash === null ? 'delete' : before === null ? 'add' : 'modify';
      return { path, kind, before, after: hash };
    });
  }

  /**
   * 파일 하나를 바꾼 리비전, 최신순. hash 가 null 이면 그 리비전에서 지운 것이다.
   * @param {string} path
   * @param {{ before?: number, limit?: number }} [opts]
   */
  function fileHistory(path, { before = headRevision() + 1, limit = 50 } = {}) {
    return q.fileHistory.all(path, before, limit).map(plain);
  }

  /**
   * 파일 하나를 리비전 rev 시점의 내용으로 되돌린다. 그 시점에 없던 파일이면 지운다.
   * @param {string} path
   * @param {number} rev
   * @param {{ author: string, tokenId?: number | null, message?: string }} meta
   */
  function revertFile(path, rev, { author, tokenId = null, message }) {
    return commit({
      changes: { [path]: fileAt(path, rev) },
      author, tokenId, source: 'revert',
      message: message || t('store.revertFile', { path, rev }),
    });
  }

  /**
   * 리비전 rev 를 되돌릴 때 쓸 내용과, rev 뒤에 또 바뀌어 함께 덮어써질 파일.
   * @returns {{ changes: Record<string, Buffer | null>, laterTouched: string[] } | null} 없는 리비전이면 null
   */
  function revertPlan(rev) {
    if (!revision(rev)) return null;
    const planned = {};
    const laterTouched = [];
    for (const { path } of changes(rev)) {
      planned[path] = fileAt(path, rev - 1);
      if (q.touchedAfter.get(path, rev)) laterTouched.push(path);
    }
    return { changes: planned, laterTouched };
  }

  /**
   * 리비전 rev 가 바꾼 파일을 모두 바로 앞 시점으로 되돌린다.
   * @param {number} rev
   * @param {{ author: string, tokenId?: number | null, message?: string }} meta
   */
  function revertRevision(rev, { author, tokenId = null, message }) {
    const plan = revertPlan(rev);
    if (!plan) return null;
    return commit({ changes: plan.changes, author, tokenId, source: 'revert', message: message || t('store.revertRevision', { rev }) });
  }

  return {
    db, headRevision, headHashes, fileAt, contentByHash, lastRevisionWithHash, hashAt, pathsAt, commit,
    revision, revisions, changes, fileHistory, revertFile, revertPlan, revertRevision,
  };
}
