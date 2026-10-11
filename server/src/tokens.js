import crypto from 'node:crypto';
import { sha256 } from './store.js';
import { t } from '../../cli/src/i18n.js';

export class TokenError extends Error {}

const NAME = /^[A-Za-z0-9._-]{1,64}$/;
const SCOPES = ['read', 'propose', 'admin'];
const TOUCH_EVERY_MS = 60_000;

/**
 * 에이전트용 발급 토큰. 원문은 발급할 때 한 번만 돌려주고 해시만 저장한다.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: () => Date }} [opts]
 */
export function createTokens(db, { now = () => new Date() } = {}) {
  const q = {
    insert: db.prepare('INSERT INTO tokens (name, hash, scope, created_at) VALUES (?, ?, ?, ?)'),
    byName: db.prepare('SELECT id FROM tokens WHERE name = ? AND deleted_at IS NULL'),
    list: db.prepare('SELECT id, name, scope, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM tokens WHERE deleted_at IS NULL ORDER BY id'),
    byHash: db.prepare('SELECT id, name, scope, last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM tokens WHERE hash = ?'),
    touch: db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?'),
    revoke: db.prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
    remove: db.prepare('UPDATE tokens SET deleted_at = ? WHERE id = ? AND revoked_at IS NOT NULL AND deleted_at IS NULL'),
  };
  const hashOf = token => sha256(Buffer.from(token, 'utf8'));

  /**
   * @param {{ name: string, scope: string }} input
   * @returns {{ id: number, token: string }}
   */
  function issue({ name, scope }) {
    if (!NAME.test(name ?? '')) throw new TokenError(t('tokens.badName'));
    if (!SCOPES.includes(scope)) throw new TokenError(t('tokens.badScope'));
    if (q.byName.get(name)) throw new TokenError(t('tokens.nameTaken', { name }));
    const token = `glt_${crypto.randomBytes(32).toString('base64url')}`;
    const id = Number(q.insert.run(name, hashOf(token), scope, now().toISOString()).lastInsertRowid);
    return { id, token };
  }

  function list() {
    return q.list.all().map(r => ({ ...r }));
  }

  /** @returns {boolean} 이번에 폐기했으면 true */
  function revoke(id) {
    return q.revoke.run(now().toISOString(), id).changes > 0;
  }

  /**
   * 폐기한 토큰을 목록에서 숨긴다. 행은 리비전이 가리키므로 지우지 않는다.
   * @returns {boolean} 이번에 숨겼으면 true(쓰는 중이거나 이미 숨긴 토큰이면 false)
   */
  function remove(id) {
    return q.remove.run(now().toISOString(), id).changes > 0;
  }

  /**
   * @param {string} token
   * @returns {{ id: number, name: string, scope: string } | null} 없거나 폐기됐으면 null
   */
  function verify(token) {
    if (typeof token !== 'string' || !token.startsWith('glt_')) return null;
    const row = q.byHash.get(hashOf(token));
    if (!row || row.revokedAt) return null;
    const t = now();
    if (!row.lastUsedAt || t.getTime() - Date.parse(row.lastUsedAt) >= TOUCH_EVERY_MS) q.touch.run(t.toISOString(), row.id);
    return { id: row.id, name: row.name, scope: row.scope };
  }

  return { issue, list, revoke, remove, verify };
}
