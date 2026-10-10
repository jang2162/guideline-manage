import crypto from 'node:crypto';
import { sha256 } from './store.js';
import { safeEqual } from './session.js';

/** 폼 수명. 열지 않으면 10분, 연 뒤 ping 이 90초 없으면 만료. 하루 지난 폼은 지운다. */
export const FORM_TIMERS = { notOpenedMs: 10 * 60 * 1000, gapMs: 90 * 1000, keepMs: 24 * 60 * 60 * 1000 };

/**
 * 내보내기 폼. 링크 토큰은 해시만 저장한다. 만료는 읽을 때 계산해 기록한다.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: () => Date, timers?: typeof FORM_TIMERS }} [opts]
 */
export function createForms(db, { now = () => new Date(), timers = FORM_TIMERS } = {}) {
  const q = {
    insert: db.prepare("INSERT INTO forms (id, link_hash, token_id, revision, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"),
    get: db.prepare('SELECT * FROM forms WHERE id = ?'),
    open: db.prepare("UPDATE forms SET opened_at = COALESCE(opened_at, ?), ping_at = ? WHERE id = ? AND status = 'pending'"),
    ping: db.prepare("UPDATE forms SET ping_at = ? WHERE id = ? AND status = 'pending'"),
    finish: db.prepare("UPDATE forms SET status = ?, selection = ?, finished_at = ? WHERE id = ? AND status = 'pending'"),
    purge: db.prepare('DELETE FROM forms WHERE created_at < ?'),
  };
  const iso = () => now().toISOString();
  const hashOf = link => sha256(Buffer.from(String(link), 'utf8'));

  function expired(row) {
    if (row.status !== 'pending') return false;
    const t = now().getTime();
    if (!row.opened_at) return t - Date.parse(row.created_at) >= timers.notOpenedMs;
    return t - Date.parse(row.ping_at ?? row.opened_at) >= timers.gapMs;
  }

  /** @returns {object | null} */
  function load(id) {
    let row = q.get.get(id);
    if (!row) return null;
    if (expired(row)) {
      q.finish.run('expired', null, iso(), id);
      row = q.get.get(id);
    }
    return {
      id: row.id,
      linkHash: row.link_hash,
      tokenId: row.token_id,
      revision: row.revision,
      payload: JSON.parse(row.payload),
      status: row.status,
      selection: row.selection ? JSON.parse(row.selection) : null,
      createdAt: row.created_at,
      openedAt: row.opened_at,
    };
  }

  function purge() {
    q.purge.run(new Date(now().getTime() - timers.keepMs).toISOString());
  }

  return {
    timers,
    create({ tokenId, revision, payload }) {
      purge();
      const id = crypto.randomBytes(9).toString('base64url');
      const link = crypto.randomBytes(24).toString('base64url');
      const createdAt = iso();
      q.insert.run(id, hashOf(link), tokenId ?? null, revision, JSON.stringify(payload), createdAt);
      return { id, link, createdAt };
    },
    load,
    checkLink(id, link) {
      const f = load(id);
      return f && typeof link === 'string' && safeEqual(hashOf(link), f.linkHash) ? f : null;
    },
    open(id) {
      const t = iso();
      q.open.run(t, t, id);
    },
    ping(id) {
      q.ping.run(iso(), id);
    },
    /** @returns {boolean} 이번에 끝냈으면 true */
    finish(id, status, selection = null) {
      return q.finish.run(status, selection === null ? null : JSON.stringify(selection), iso(), id).changes > 0;
    },
    purge,
  };
}
