import { remoteClient, explain } from '../remote.js';
import { serverFor } from '../workspace.js';
import { displayWidth } from './list.js';
import { t } from '../i18n.js';

export const STATUSES = ['pending', 'accepted', 'rejected'];
const STATUS = s => ({ pending: t('proposals.pending'), accepted: t('proposals.accepted'), rejected: t('proposals.rejected') })[s] ?? s;
const KIND = k => ({ add: t('change.add'), modify: t('change.modify'), delete: t('change.delete') })[k] ?? k;
const day = iso => (iso ? iso.replace('T', ' ').slice(0, 16) : '');

/** 여러 열을 표시 폭으로 맞춘다. 마지막 열은 채우지 않는다. */
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => displayWidth(r[i]))));
  return rows.map(r => r.map((cell, i) => (i === r.length - 1 ? cell : cell + ' '.repeat(widths[i] - displayWidth(cell)))).join('  ').trimEnd());
}

function printList(list, out) {
  if (list.length === 0) {
    out(t('proposals.none'));
    return;
  }
  const head = ['proposals.colNo', 'proposals.colStatus', 'proposals.colTitle', 'proposals.colBy', 'proposals.colProject', 'proposals.colWhen', 'proposals.colFiles'].map(k => t(k));
  const rows = list.map(p => [`#${p.id}`, STATUS(p.status), p.title, p.author, p.project ?? '', day(p.createdAt), String(p.changeCount)]);
  for (const line of table([head, ...rows])) out(line);
}

function printDetail(p, out, err) {
  out(t('proposals.title', { id: p.id, title: p.title }));
  const meta = [STATUS(p.status), p.author, p.project, day(p.createdAt), p.revision ? `r${p.revision}` : null].filter(Boolean);
  out(meta.join(' · '));
  if (p.description) out(`\n${p.description}`);
  if (p.status === 'rejected' && p.note) out(t('proposals.rejectedNote', { note: p.note }));
  if (p.outdated) {
    out(t('proposals.outdated'));
    for (const c of p.conflicts) out(`  ${c.path} — ${c.reason}`);
  }
  out(p.url);
  // diff 키가 없으면 ?diff=1 을 모르는 옛 서버다. 파일 목록만 보인다.
  const withDiff = p.changes.every(c => Object.hasOwn(c, 'diff'));
  if (!withDiff) err(t('proposals.oldServer'));
  out(`\n${t('proposals.files', { n: p.changes.length })}`);
  for (const c of p.changes) {
    out(`  ${KIND(c.kind)}  ${c.path}`);
    if (!withDiff) continue;
    if (c.diff === null) out(`    ${t('proposals.binary')}`);
    // 빈 문자열: 줄바꿈 문자(CRLF)만 다르다. 웹처럼 차이 없음을 알린다.
    else if (c.diff === '') out(`    ${t('proposals.noDiff')}`);
    else out(c.diff);
  }
}

/**
 * 지침 서버의 제안 목록(id 가 없으면)이나 제안 하나의 상세와 차이. 서버·토큰은 list 처럼 찾는다.
 * @param {{ id?: string, status?: string, server?: string, sourceName?: string, json?: boolean }} opts
 * @returns {Promise<number>}
 */
export async function proposals({
  id, status, server, sourceName, json = false, env = process.env, out = console.log, err = console.error, fetchImpl = fetch, home, cwd = process.cwd(),
}) {
  if (id !== undefined && !/^[1-9]\d*$/.test(id)) {
    err(t('proposals.badId', { id }));
    return 2;
  }
  if (status !== undefined && id !== undefined) {
    err(t('proposals.statusWithId'));
    return 2;
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    err(t('proposals.badStatus', { status, list: STATUSES.join(', ') }));
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
  const client = remoteClient({ server: url, token, fetchImpl });
  let data;
  try {
    data = id === undefined ? await client.proposals(status) : await client.proposal(Number(id));
  } catch (e) {
    err(explain(e, url));
    return 1;
  }
  if (json) out(JSON.stringify(data, null, 2));
  else if (id === undefined) printList(data.proposals, out);
  else printDetail(data, out, err);
  return 0;
}
