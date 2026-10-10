import fs from 'node:fs';
import path from 'node:path';
import { toLines, headingLines, headings, sectionsAt } from './sections.js';
import { stackFiles } from './catalog.js';
import { asTree, readText } from './tree.js';
import { t } from './i18n.js';

/** 바꿈 절의 첫 줄. 1: 스택, 2: 파일, 3: 절 제목(없으면 파일 전체). */
export const OVERRIDE_LINES = [
  /^Overrides: `([^`/]+)\/([^`]+)`(?: "(.+)")?\s*$/,
  /^바꾸는 절: `([^`/]+)\/([^`]+)`(?: 「(.+)」)?\s*$/,
];
const INSTRUCTION_SECTION = /^(.+) (?:프로젝트 바꿈|project overrides)$/;
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
  const o = { file, stack, heading: section.title, target: `rules/${targetStack}/${targetFile}`, title: title ?? null };
  if (targetStack !== stack) o.reason = t('overrides.otherStack', { stack: targetStack });
  return o;
}

const byFile = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/** .ruler/<스택>/override.md 와 .ruler/<스택>/override.d/*.md 의 ## 절. */
function rulerOverrides(project) {
  const dir = path.join(project, '.ruler');
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === 'skills' || d.name === 'agents') continue;
    const files = [];
    if (fs.existsSync(path.join(dir, d.name, 'override.md'))) files.push(`.ruler/${d.name}/override.md`);
    const extra = path.join(dir, d.name, 'override.d');
    if (fs.existsSync(extra)) {
      for (const f of fs.readdirSync(extra).filter(f => f.endsWith('.md'))) files.push(`.ruler/${d.name}/override.d/${f}`);
    }
    for (const rel of files) {
      for (const s of sectionsAt(fs.readFileSync(path.join(project, rel), 'utf8'), 2)) result.push(parse(rel, d.name, s));
    }
  }
  return result.sort(byFile);
}

/** 지침 파일의 `## <스택> 프로젝트 바꿈` 절 아래 ### 절. 두 파일이 사본이면 같은 바꿈은 하나로 친다. */
function instructionOverrides(project, instructionFiles) {
  const seen = new Set();
  const result = [];
  for (const rel of instructionFiles) {
    const lines = toLines(fs.readFileSync(path.join(project, rel), 'utf8'));
    const hs = headingLines(lines);
    hs.forEach((h, i) => {
      const m = h.level === 2 ? INSTRUCTION_SECTION.exec(h.title) : null;
      if (!m) return;
      const end = hs.slice(i + 1).find(x => x.level <= 2);
      const text = lines.slice(h.index + 1, end ? end.index : lines.length).join('\n');
      for (const s of sectionsAt(text, 3)) {
        const o = parse(rel, m[1], s);
        const key = JSON.stringify([o.stack, o.heading, o.target, o.title]);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(o);
      }
    });
  }
  return result;
}

/**
 * 프로젝트의 바꿈을 읽는다.
 * @param {string} project 프로젝트 절대경로
 * @param {'ruler' | 'instructions' | 'none'} form
 * @param {string[]} instructionFiles instructions 형태의 지침 파일(프로젝트 기준 경로)
 * @returns {ProjectOverride[]}
 */
export function readProjectOverrides(project, form, instructionFiles) {
  if (form === 'ruler') return rulerOverrides(project);
  if (form === 'instructions') return instructionOverrides(project, instructionFiles);
  return [];
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
