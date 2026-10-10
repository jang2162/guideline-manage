import { toLines, fenceMask } from '../sections.js';
import { t, template } from '../i18n.js';

/**
 * 참조 지침 색인. `.ruler/<스택>/99-reference.md` 전체다.
 * @param {string} stack
 * @param {{ when: string, path: string }[]} rows
 */
export function indexText(stack, rows) {
  return [
    `# ${t('index.title', { stack })}`, '',
    t('index.intro'), '',
    `| ${t('index.colWhen')} | ${t('index.colFile')} |`, '| --- | --- |',
    ...rows.map(r => `| ${r.when.replace(/\|/g, '\\|')} | \`${r.path}\` |`),
    '',
  ].join('\n');
}

/**
 * 출처의 추가 지침 본문을 관리 지침 절 아래에 넣을 모양으로. 맨 앞 `# ` 제목 줄(과 뒤 빈 줄)을 빼고,
 * 코드 펜스 밖의 `##`~`#####` 제목을 한 단계 내린다.
 * @param {string} text
 */
export function demoteHeadings(text) {
  const lines = toLines(text);
  if (/^# /.test(lines[0] ?? '')) {
    lines.shift();
    while (lines.length && lines[0].trim() === '') lines.shift();
  }
  const mask = fenceMask(lines);
  return lines.map((l, i) => (!mask[i] && /^#{2,5} /.test(l) ? `#${l}` : l)).join('\n');
}

/**
 * 관리 지침 `.ruler/guideline.md` 전체.
 * @param {{ setupStacks?: string[], stackSource?: Record<string, string> | null, additions?: { source: string, text: string }[] }} opts
 *   stackSource 는 출처가 둘 이상일 때만 준다(세팅 표에 출처 열). additions 는 출처의 docs/management.md.
 */
export function managementText({ setupStacks = [], stackSource = null, additions = [] } = {}) {
  let setup = '';
  if (setupStacks.length > 0) {
    const sorted = [...setupStacks].sort();
    setup = `\n${[
      t('manage.setupIntro'), '',
      ...(stackSource
        ? [`| ${t('manage.colStack')} | ${t('manage.colSource')} | ${t('manage.colSetup')} |`, '| --- | --- | --- |',
          ...sorted.map(s => `| ${s} | ${stackSource[s] ?? ''} | \`docs/guideline/${s}/SETUP.md\` |`)]
        : [`| ${t('manage.colStack')} | ${t('manage.colSetup')} |`, '| --- | --- |',
          ...sorted.map(s => `| ${s} | \`docs/guideline/${s}/SETUP.md\` |`)]),
    ].join('\n')}`;
  }
  let out = template('management.md', { propose: stackSource ? t('manage.proposeMulti') : t('manage.propose'), setup });
  for (const a of [...additions].sort((x, y) => (x.source < y.source ? -1 : 1))) {
    const body = demoteHeadings(a.text).replace(/\s+$/, '');
    if (body.trim() === '') continue;
    out += `\n## ${t('manage.additions', { source: a.source })}\n\n${body}\n`;
  }
  return out;
}

/** docs/guideline/README.md 내용. */
export const docsReadme = () => `${t('manage.docsReadme')}\n`;
