import { lineEdits } from './diff.js';
import { t } from './i18n.js';

export const markOurs = () => t('merge.ours');
export const MARK_SEP = '=======';
export const markTheirs = () => t('merge.theirs');

/** 줄바꿈을 붙인 채로 나눈다. 끝 줄에 줄바꿈이 없으면 그대로 둔다. */
export function splitKeep(text) {
  return text === '' ? [] : text.match(/[^\n]*\n|[^\n]+$/g);
}

/** base 를 x 로 바꾸는 덩어리들: base[start, end) 를 lines 로 바꾼다. 순서대로. */
function hunks(base, x) {
  const out = [];
  let i = 0;
  let cur = null;
  for (const e of lineEdits(base, x)) {
    if (e.op === ' ') {
      if (cur) out.push(cur);
      cur = null;
      i++;
      continue;
    }
    if (!cur) cur = { start: i, end: i, lines: [] };
    if (e.op === '-') {
      i++;
      cur.end = i;
    } else cur.lines.push(e.line);
  }
  if (cur) out.push(cur);
  return out;
}

const withNl = lines => lines.map((l, k) => (k === lines.length - 1 && !l.endsWith('\n') ? `${l}\n` : l));

/**
 * 줄 단위 3-way merge. 같은 기준 구간을 양쪽이 다르게 고치면 충돌 표지를 넣는다.
 * @param {string} base 기준
 * @param {string} ours 지금 원본
 * @param {string} theirs 제안
 * @returns {{ ok: boolean, text: string, conflicts: number }}
 */
export function merge3(base, ours, theirs) {
  const lf = s => s.replace(/\r\n/g, '\n');
  const b = splitKeep(lf(base));
  const all = [
    ...hunks(b, splitKeep(lf(ours))).map(h => ({ ...h, side: 'o' })),
    ...hunks(b, splitKeep(lf(theirs))).map(h => ({ ...h, side: 't' })),
  ].sort((x, y) => x.start - y.start || x.end - y.end);
  const seg = (list, gs, ge) => {
    const r = [];
    let p = gs;
    for (const h of list) {
      r.push(...b.slice(p, h.start), ...h.lines);
      p = h.end;
    }
    return [...r, ...b.slice(p, ge)];
  };
  const out = [];
  let pos = 0;
  let conflicts = 0;
  let k = 0;
  while (k < all.length) {
    const gs = all[k].start;
    let ge = all[k].end;
    const group = [all[k++]];
    while (k < all.length && (all[k].start === gs || all[k].start < ge)) {
      ge = Math.max(ge, all[k].end);
      group.push(all[k++]);
    }
    out.push(...b.slice(pos, gs));
    const os = group.filter(h => h.side === 'o');
    const ts = group.filter(h => h.side === 't');
    if (ts.length === 0) out.push(...seg(os, gs, ge));
    else if (os.length === 0) out.push(...seg(ts, gs, ge));
    else {
      const x = seg(os, gs, ge);
      const y = seg(ts, gs, ge);
      if (x.join('') === y.join('')) out.push(...x);
      else {
        conflicts++;
        out.push(`${markOurs()}\n`, ...withNl(x), `${MARK_SEP}\n`, ...withNl(y), `${markTheirs()}\n`);
      }
    }
    pos = ge;
  }
  out.push(...b.slice(pos));
  return { ok: conflicts === 0, text: out.join(''), conflicts };
}
