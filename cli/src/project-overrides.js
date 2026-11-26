import fs from 'node:fs';
import path from 'node:path';
import { bareTitle, headings, sectionsAt } from './sections.js';
import { stackFiles } from './catalog.js';
import { asTree, readText } from './tree.js';
import { GUIDE_DIR } from './layout.js';
import { t } from './i18n.js';

/** 바꿈 절의 첫 줄. 1: 스택 경로, 2: 파일(마지막 조각), 3: 절 제목(없으면 파일 전체). */
export const OVERRIDE_LINES = [
  /^Overrides: `([^`/]+(?:\/[^`/]+)*)\/([^`/]+)`(?: "(.+)")?\s*$/,
  /^바꾸는 절: `([^`/]+(?:\/[^`/]+)*)\/([^`/]+)`(?: 「(.+)」)?\s*$/,
];
const FIRST_LINE_BAD = () => t('overrides.badFirstLine');

/**
 * @typedef {{ file: string, stack: string, heading: string, target: string | null, title: string | null, reason?: string }} ProjectOverride
 * target 은 `rules/<스택>/<파일>`. 첫 줄을 읽을 수 없으면 null 이고 reason 이 붙는다.
 */

/** 바꿈 절 하나를 읽는다. */
function parse(file, stack, section) {
  const first = section.body.split('\n').find(l => l.trim() !== '')?.trim() ?? '';
  const m = OVERRIDE_LINES.map(re => re.exec(first)).find(Boolean);
  if (!m) return { file, stack, heading: section.title, target: null, title: null, reason: FIRST_LINE_BAD() };
  const [, targetStack, targetFile, title] = m;
  const o = { file, stack, heading: section.title, target: `rules/${targetStack}/${targetFile}`, title: title ? bareTitle(title) : null };
  if (targetStack !== stack) o.reason = t('overrides.otherStack', { stack: targetStack });
  return o;
}

const byFile = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/** root(.guideline/overrides) 아래 모든 깊이의 <스택 경로>/override.md 와 override.d/*.md 의 ## 절. 스택은 root 기준 경로. */
function overridesUnder(project, root) {
  const dir = path.join(project, ...root.split('/'));
  if (!fs.existsSync(dir)) return [];
  const result = [];
  const walk = (stack) => {
    const abs = path.join(dir, stack);
    const files = [];
    if (stack && fs.existsSync(path.join(abs, 'override.md'))) files.push(`${root}/${stack}/override.md`);
    const extra = path.join(abs, 'override.d');
    if (stack && fs.existsSync(extra)) {
      for (const f of fs.readdirSync(extra).filter(f => f.endsWith('.md'))) files.push(`${root}/${stack}/override.d/${f}`);
    }
    for (const rel of files) {
      for (const s of sectionsAt(fs.readFileSync(path.join(project, rel), 'utf8'), 2)) result.push(parse(rel, stack, s));
    }
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name === 'override.d') continue;
      walk(stack ? `${stack}/${d.name}` : d.name);
    }
  };
  walk('');
  return result.sort(byFile);
}

/**
 * 프로젝트의 바꿈을 읽는다. .guideline/overrides/<스택 경로>/ 가 바꿈의 자리다(.ruler/ 쪽은 조합이 복사한 생성물).
 * @param {string} project 프로젝트 절대경로
 * @returns {ProjectOverride[]}
 */
export function readProjectOverrides(project) {
  return overridesUnder(project, `${GUIDE_DIR}/overrides`);
}

/**
 * 원본과 대조해 valid 를 붙인다. 이미 reason 이 있는 바꿈은 그대로 거짓이다.
 * @param {ProjectOverride[]} overrides
 * @param {string | import('./tree.js').Tree} src 문서 저장소 경로나 원본 트리
 * @returns {(ProjectOverride & { valid: boolean })[]}
 */
export function checkOverrides(overrides, src) {
  const tree = asTree(src);
  return overrides.map(o => {
    if (o.reason) return { ...o, valid: false };
    const ref = o.target.slice('rules/'.length);
    if (!stackFiles(o.stack, tree).includes(o.target)) return { ...o, valid: false, reason: t('overrides.noFile', { ref }) };
    if (o.title && !headings(readText(tree, o.target)).has(o.title)) {
      return { ...o, valid: false, reason: t('overrides.noSection', { ref, title: o.title }) };
    }
    return { ...o, valid: true };
  });
}
