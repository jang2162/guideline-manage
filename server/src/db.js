import { DatabaseSync } from 'node:sqlite';

/** 버전 v 에서 v+1 로 올리는 SQL. 배열의 인덱스가 출발 버전이다. 이미 나간 항목은 고치지 않고 뒤에 더한다. */
export const MIGRATIONS = [
  `CREATE TABLE tokens (
     id           INTEGER PRIMARY KEY,
     name         TEXT NOT NULL UNIQUE,
     hash         TEXT NOT NULL UNIQUE,
     scope        TEXT NOT NULL CHECK (scope IN ('read', 'propose')),
     created_at   TEXT NOT NULL,
     last_used_at TEXT,
     revoked_at   TEXT,
     user_id      INTEGER
   );
   CREATE TABLE revisions (
     id         INTEGER PRIMARY KEY,
     created_at TEXT NOT NULL,
     author     TEXT NOT NULL,
     token_id   INTEGER REFERENCES tokens(id),
     message    TEXT NOT NULL,
     source     TEXT NOT NULL CHECK (source IN ('import', 'web', 'revert', 'proposal'))
   );
   CREATE TABLE file_versions (
     path        TEXT NOT NULL,
     revision_id INTEGER NOT NULL REFERENCES revisions(id),
     content     BLOB,
     hash        TEXT,
     PRIMARY KEY (path, revision_id)
   );
   CREATE INDEX file_versions_revision ON file_versions(revision_id);
   CREATE TABLE head (
     path        TEXT PRIMARY KEY,
     revision_id INTEGER NOT NULL,
     hash        TEXT NOT NULL
   );`,
  `CREATE TABLE forms (
     id          TEXT PRIMARY KEY,
     link_hash   TEXT NOT NULL,
     token_id    INTEGER,
     revision    INTEGER NOT NULL,
     payload     TEXT NOT NULL,
     status      TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'cancelled', 'expired')),
     selection   TEXT,
     created_at  TEXT NOT NULL,
     opened_at   TEXT,
     ping_at     TEXT,
     finished_at TEXT
   );`,
  `CREATE TABLE proposals (
     id           INTEGER PRIMARY KEY,
     title        TEXT NOT NULL,
     description  TEXT NOT NULL DEFAULT '',
     project      TEXT,
     token_id     INTEGER,
     author       TEXT NOT NULL,
     status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
     created_at   TEXT NOT NULL,
     decided_at   TEXT,
     note         TEXT,
     revision_id  INTEGER
   );
   CREATE TABLE proposal_changes (
     proposal_id  INTEGER NOT NULL REFERENCES proposals(id),
     path         TEXT NOT NULL,
     content      BLOB,
     base_hash    TEXT,
     PRIMARY KEY (proposal_id, path)
   );`,
  // 서버가 처음 시작할 때 넣는 씨앗(출처 seed). CHECK 를 바꾸려면 표를 다시 만든다(외래 키는 openDb 가 끄고 검사한다).
  `CREATE TABLE revisions_new (
     id         INTEGER PRIMARY KEY,
     created_at TEXT NOT NULL,
     author     TEXT NOT NULL,
     token_id   INTEGER REFERENCES tokens(id),
     message    TEXT NOT NULL,
     source     TEXT NOT NULL CHECK (source IN ('import', 'web', 'revert', 'proposal', 'seed'))
   );
   INSERT INTO revisions_new SELECT id, created_at, author, token_id, message, source FROM revisions;
   DROP TABLE revisions;
   ALTER TABLE revisions_new RENAME TO revisions;`,
  // admin 범위와 삭제(숨김). 지운 토큰의 id 를 다시 쓰지 않도록 AUTOINCREMENT, 이름은 숨기지 않은 토큰끼리만 겹치지 않는다.
  `CREATE TABLE tokens_new (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL,
     hash         TEXT NOT NULL UNIQUE,
     scope        TEXT NOT NULL CHECK (scope IN ('read', 'propose', 'admin')),
     created_at   TEXT NOT NULL,
     last_used_at TEXT,
     revoked_at   TEXT,
     user_id      INTEGER,
     deleted_at   TEXT
   );
   INSERT INTO tokens_new (id, name, hash, scope, created_at, last_used_at, revoked_at, user_id)
     SELECT id, name, hash, scope, created_at, last_used_at, revoked_at, user_id FROM tokens;
   DROP TABLE tokens;
   ALTER TABLE tokens_new RENAME TO tokens;
   CREATE UNIQUE INDEX tokens_live_name ON tokens(name) WHERE deleted_at IS NULL;`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export class SchemaTooNewError extends Error {}

/**
 * DB 를 열고 스키마를 올린다. 올리기는 한 트랜잭션이라 실패하면 아무것도 바뀌지 않는다.
 * @param {string} file DB 파일 경로. 테스트는 ':memory:'
 * @param {{ beforeMigrate?: (db: DatabaseSync, from: number, to: number) => void, migrations?: string[] }} [opts]
 *   beforeMigrate 는 데이터가 있는 DB(버전 1 이상)를 올리기 직전에 부른다. 백업에 쓴다.
 * @returns {DatabaseSync}
 */
export function openDb(file, { beforeMigrate, migrations = MIGRATIONS } = {}) {
  const target = migrations.length;
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const current = db.prepare('PRAGMA user_version').get().user_version;
    if (current > target) {
      throw new SchemaTooNewError(`DB schema v${current} is newer than this server (v${target}). Deploy a newer image`);
    }
    if (current < target) {
      if (current > 0) beforeMigrate?.(db, current, target);
      // 표를 다시 만드는 마이그레이션이 있어 외래 키는 그동안 끄고, 커밋 전에 어긋난 참조가 없는지 검사한다(SQLite 권장 절차).
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN');
      try {
        for (let v = current; v < target; v++) db.exec(migrations[v]);
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`foreign key check failed after migration: ${JSON.stringify(broken.slice(0, 3))}`);
        db.exec(`PRAGMA user_version = ${target}`);
        db.exec('COMMIT');
        db.exec('PRAGMA foreign_keys = ON');
      } catch (e) {
        db.exec('ROLLBACK');
        db.exec('PRAGMA foreign_keys = ON');
        throw e;
      }
    }
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
