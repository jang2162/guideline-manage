import { outsideFences } from './sections.js';

export { headings } from './sections.js';

import { OVERRIDES_SECTIONS } from './markers.js';

/** 스택 README 의 바꿈 표 절 제목. 영어가 정본이고 한국어도 읽는다. */
export { OVERRIDES_SECTIONS };
/** 한국어 제목(이전 이름). */
export const OVERRIDES_SECTION = OVERRIDES_SECTIONS[1];

const CELL = /^`([^`/]+|[^`/]+\/[^`/]+)`\s*(?:「(.+)」|"(.+)")$/;

/** `<파일>` 「<절 제목>」 이나 `<파일>` "<절 제목>" 셀을 읽는다. 읽을 수 없으면 null. */
function cell(text) {
  const m = CELL.exec(text.trim());
  return m ? { ref: m[1], title: m[2] ?? m[3] } : null;
}

/**
 * 스택 README 의 `## 다른 스택을 바꾸는 것` 표를 행마다 읽는다. 첫 행(머리)과 `---` 행은 건너뛴다.
 * from 은 이 스택의 파일 이름만, to 는 `<스택>/<파일>` 이어야 한다.
 * @param {string} text README 내용
 * @returns {({ from: { file: string, title: string }, to: { stack: string, file: string, title: string } } | { error: string })[]}
 */
export function overrideRows(text) {
  const lines = outsideFences(text.replace(/\r\n/g, '\n').split('\n'));
  const start = lines.findIndex(l => OVERRIDES_SECTIONS.some(h => l.trimEnd() === `## ${h}`));
  if (start === -1) return [];
  const body = lines.slice(start + 1);
  const end = body.findIndex(l => /^#{1,2} /.test(l));
  const rows = body.slice(0, end === -1 ? body.length : end).filter(l => l.trim().startsWith('|'));
  return rows
    .slice(1)
    .filter(l => !/^\|[\s:|-]+\|?\s*$/.test(l.trim()))
    .map(raw => {
      const cells = raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      const from = cells.length === 2 ? cell(cells[0]) : null;
      const to = cells.length === 2 ? cell(cells[1]) : null;
      if (!from || !to || from.ref.includes('/') || !to.ref.includes('/')) return { error: raw.trim() };
      const [stack, file] = to.ref.split('/');
      return { from: { file: from.ref, title: from.title }, to: { stack, file, title: to.title } };
    });
}
