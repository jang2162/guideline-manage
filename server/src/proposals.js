import { sha256, ConflictError } from './store.js';
import { pathProblem, contentProblem, isTextPath } from '../../cli/src/store-paths.js';
import { merge3 } from '../../cli/src/merge3.js';
import { unifiedDiff } from '../../cli/src/diff.js';
import { t } from '../../cli/src/i18n.js';

export class ProposalError extends Error {
  /**
   * @param {number} status HTTP 상태
   * @param {string} message
   * @param {object} [extra] 응답에 함께 낼 것
   */
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MAX_CHANGES = 500;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 합칠 수 있는 텍스트면 문자열, 아니면 null. */
function textOf(p, buf) {
  if (buf === null) return null;
  if (!isTextPath(p) && buf.includes(0)) return null;
  try {
    return utf8.decode(buf);
  } catch {
    return null;
  }
}

/** UTF-8 로 읽히고 NUL 이 없으면 문자열, 아니면 null. 제안 화면·API 가 보일 때 쓴다(경로는 보지 않는다). */
export function readableText(buf) {
  if (buf === null || buf.includes(0)) return null;
  try {
    return utf8.decode(buf);
  } catch {
    return null;
  }
}

/**
 * 제안 파일 하나의 기준 대비 unified 차이. 기준(base)이나 제안 내용이 텍스트로 읽히지 않으면 null.
 * 더함(과 기준 내용을 못 찾은 경우)은 빈 기준, 지움은 빈 내용과 비교한다.
 * @param {{ contentByHash: (hash: string) => Buffer | null }} store
 * @param {{ content: Buffer | null, base: string | null }} c
 * @param {{ aLabel: string, bLabel: string }} labels
 */
export function proposalDiff(store, c, labels) {
  const baseBuf = c.base ? store.contentByHash(c.base) : null;
  const bt = baseBuf === null ? '' : readableText(baseBuf);
  const pt = c.content === null ? '' : readableText(c.content);
  return bt === null || pt === null ? null : unifiedDiff(bt, pt, labels);
}

const plain = row => (row ? { ...row } : null);

/**
 * 제안 저장과 수락 규칙.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<typeof import('./store.js').createStore>} store
 */
export function createProposals(db, store, { now = () => new Date() } = {}) {
  const q = {
    insert: db.prepare(`INSERT INTO proposals (title, description, project, token_id, author, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`),
    insertChange: db.prepare('INSERT INTO proposal_changes (proposal_id, path, content, base_hash) VALUES (?, ?, ?, ?)'),
    get: db.prepare(`SELECT id, title, description, project, token_id AS tokenId, author, status, created_at AS createdAt,
      decided_at AS decidedAt, note, revision_id AS revisionId FROM proposals WHERE id = ?`),
    changes: db.prepare('SELECT path, content, base_hash AS base FROM proposal_changes WHERE proposal_id = ? ORDER BY path'),
    list: db.prepare(`SELECT p.id, p.title, p.project, p.author, p.status, p.created_at AS createdAt, p.decided_at AS decidedAt,
      p.revision_id AS revisionId, (SELECT COUNT(*) FROM proposal_changes c WHERE c.proposal_id = p.id) AS changeCount
      FROM proposals p
      WHERE (? IS NULL OR p.status = ?) AND (? IS NULL OR p.token_id = ?)
      ORDER BY p.id DESC LIMIT ? OFFSET ?`),
    pending: db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'"),
    decide: db.prepare("UPDATE proposals SET status = ?, decided_at = ?, note = ?, revision_id = ? WHERE id = ? AND status = 'pending'"),
    setChange: db.prepare('UPDATE proposal_changes SET content = ?, base_hash = ? WHERE proposal_id = ? AND path = ?'),
    dropChange: db.prepare('DELETE FROM proposal_changes WHERE proposal_id = ? AND path = ?'),
    dropAllChanges: db.prepare('DELETE FROM proposal_changes WHERE proposal_id = ?'),
    dropProposal: db.prepare('DELETE FROM proposals WHERE id = ?'),
  };

  /** 입력을 검사하고 NFC 로 맞춘 변경 목록을 돌려준다. */
  function checked({ title, changes }) {
    if (typeof title !== 'string' || title.trim() === '' || title.length > 200) throw new ProposalError(400, t('proposal.badTitle'));
    if (!Array.isArray(changes) || changes.length === 0) throw new ProposalError(400, t('proposal.noChanges'));
    if (changes.length > MAX_CHANGES) throw new ProposalError(400, t('proposal.tooMany', { max: MAX_CHANGES }));
    const seen = new Set();
    const out = [];
    const problems = [];
    for (const c of changes) {
      const p = String(c.path ?? '').normalize('NFC');
      if (seen.has(p)) problems.push({ path: p, message: t('store.duplicatePath') });
      seen.add(p);
      const pp = pathProblem(p) ?? (c.content === null ? null : contentProblem(p, c.content));
      if (pp) problems.push({ path: p, message: pp });
      out.push({ path: p, content: c.content, base: c.base ?? null });
    }
    if (problems.length) throw new ProposalError(400, problems.map(x => `${x.path}: ${x.message}`).join('; '), { problems });
    const head = store.headHashes();
    const changed = out.some(c => (head.get(c.path) ?? null) !== (c.content === null ? null : sha256(c.content)));
    if (!changed) throw new ProposalError(400, t('proposal.nothingChanged'));
    return out;
  }

  /**
   * 변경 묶음을 지금 원본에 얹어 본다. 저장하지 않는다.
   * @param {{ path: string, content: Buffer | null, base: string | null }[]} changes
   */
  function plan(changes) {
    const head = store.headHashes();
    const rev = store.headRevision();
    const files = [];
    for (const c of changes) {
      const cur = head.get(c.path) ?? null;
      const want = c.content === null ? null : sha256(c.content);
      const headChanged = cur !== c.base;
      const conflict = (reason, extra = {}) => files.push({ path: c.path, result: 'conflict', content: null, headChanged, reason, ...extra });
      if (cur === want) {
        files.push({ path: c.path, result: 'same', content: c.content, headChanged });
      } else if (!headChanged) {
        files.push({ path: c.path, result: 'take', content: c.content, headChanged });
      } else if (c.content === null) {
        conflict(t('proposal.deleteButChanged'));
      } else if (cur === null) {
        conflict(t('proposal.deletedUpstream'));
      } else if (c.base === null) {
        conflict(t('proposal.newButExists'));
      } else {
        const bt = textOf(c.path, store.contentByHash(c.base));
        const ct = textOf(c.path, store.fileAt(c.path, rev));
        const wt = textOf(c.path, c.content);
        if (bt === null) conflict(store.contentByHash(c.base) === null ? t('proposal.noBase') : t('proposal.notText'));
        else if (ct === null || wt === null) conflict(t('proposal.notText'));
        else {
          const m = merge3(bt, ct, wt);
          if (m.ok) files.push({ path: c.path, result: 'merged', content: Buffer.from(m.text), headChanged });
          else conflict(t('proposal.overlap'), { conflictText: m.text });
        }
      }
    }
    return { files, conflicts: files.filter(f => f.result === 'conflict').map(f => ({ path: f.path, reason: f.reason })) };
  }

  /** 검사한 뒤 저장한다. @returns {number} 제안 번호 */
  function create(input) {
    const changes = checked(input);
    db.exec('BEGIN IMMEDIATE');
    try {
      const id = Number(q.insert.run(
        input.title.trim(), input.description ?? '', input.project ?? null, input.tokenId ?? null, input.author, now().toISOString(),
      ).lastInsertRowid);
      for (const c of changes) q.insertChange.run(id, c.path, c.content, c.base);
      db.exec('COMMIT');
      return id;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function get(id) {
    const p = plain(q.get.get(id));
    if (!p) return null;
    p.changes = q.changes.all(id).map(r => ({ path: r.path, content: r.content === null ? null : Buffer.from(r.content), base: r.base }));
    return p;
  }

  function pendingOf(id) {
    const p = get(id);
    if (!p) throw new ProposalError(404, t('proposal.notFound'));
    if (p.status !== 'pending') throw new ProposalError(409, t('proposal.closed'));
    return p;
  }

  /** 충돌이 없으면 리비전 하나로 넣는다. 바뀐 것이 없으면 null. */
  function accept(id) {
    const p = pendingOf(id);
    const { files, conflicts } = plan(p.changes);
    if (conflicts.length) throw new ProposalError(409, t('proposal.cannotAccept'), { conflicts });
    const head = store.headHashes();
    const changes = {};
    const base = {};
    for (const f of files) {
      if (f.result === 'same') continue;
      changes[f.path] = f.content;
      base[f.path] = head.get(f.path) ?? null;
    }
    let revision = null;
    if (Object.keys(changes).length) {
      try {
        revision = store.commit({ changes, base, author: p.author, tokenId: p.tokenId, message: t('proposal.revisionMessage', { id, title: p.title }), source: 'proposal' });
      } catch (e) {
        if (e instanceof ConflictError) throw new ProposalError(409, t('proposal.retry'));
        throw e;
      }
    }
    q.decide.run('accepted', now().toISOString(), null, revision, id);
    return revision;
  }

  /** 저장하고, apply 면 바로 수락한다. apply 인데 충돌이면 저장하지 않는다. */
  function submit(input, { apply = false } = {}) {
    if (apply) {
      const { conflicts } = plan(checked(input));
      if (conflicts.length) throw new ProposalError(409, t('proposal.cannotApply'), { conflicts });
    }
    const id = create(input);
    if (!apply) return { id, status: 'pending', revision: null };
    try {
      return { id, status: 'accepted', revision: accept(id) };
    } catch (e) {
      // apply 가 실패하면 아무것도 남기지 않는다(쓰기 검사·경합)
      q.dropAllChanges.run(id);
      q.dropProposal.run(id);
      throw e;
    }
  }

  function reject(id, note = '') {
    pendingOf(id);
    q.decide.run('rejected', now().toISOString(), note, null, id);
  }

  /** 파일 하나의 제안 내용을 고친다. 기준은 지금 원본으로 바뀐다. */
  function setChange(id, path, content) {
    const p = pendingOf(id);
    if (!p.changes.some(c => c.path === path)) throw new ProposalError(404, t('proposal.notInProposal'));
    const cp = contentProblem(path, content);
    if (cp) throw new ProposalError(400, `${path}: ${cp}`);
    q.setChange.run(content, store.headHashes().get(path) ?? null, id, path);
  }

  function dropChange(id, path) {
    const p = pendingOf(id);
    if (!p.changes.some(c => c.path === path)) throw new ProposalError(404, t('proposal.notInProposal'));
    if (p.changes.length === 1) throw new ProposalError(400, t('proposal.lastChange'));
    q.dropChange.run(id, path);
  }

  /** 제안 목록, 최신순. limit 이 -1 이면 전부(API 가 그렇게 쓴다). */
  function list({ status = null, tokenId = null, limit = -1, offset = 0 } = {}) {
    return q.list.all(status, status, tokenId, tokenId, limit, offset).map(plain);
  }

  return { create, submit, get, list, pendingCount: () => q.pending.get().n, plan, accept, reject, setChange, dropChange };
}
