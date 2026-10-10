import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { memoryTree } from '../src/tree.js';
import { catalogSummary } from '../src/summary.js';
import { readServer, BUILD_SECTIONS } from '../src/mcp.js';
import { OVERRIDES_SECTIONS } from '../src/overrides.js';
import { readProjectOverrides, checkOverrides, OVERRIDE_LINES } from '../src/project-overrides.js';
import { createI18n, setLocale, currentLocale } from '../src/i18n.js';
import { tmpDir, write, ALWAYS } from './helpers.js';

// 사람이 쓴 지침의 표지 문구는 언어 설정과 상관없이 영어·한국어 둘 다 읽는다.

const base = {
  'rules/base/README.md': '# base\n',
  'rules/base/06-x.md': `${ALWAYS}# x\n\n## 절\n\n본문\n`,
  'rules/orca/00-a.md': `${ALWAYS}# a\n\n## 절\n\n바꾸는 본문\n`,
};
const koReadme = '# orca\n\n## 다른 스택을 바꾸는 것\n\n| 바꾸는 절 | 바뀌는 절 |\n| --- | --- |\n| `00-a.md` 「절」 | `base/06-x.md` 「절」 |\n';
const enReadme = '# orca\n\n## Overrides of other stacks\n\n| Overriding | Overridden |\n| --- | --- |\n| `00-a.md` "절" | `base/06-x.md` "절" |\n';

function english(t) {
  const prev = currentLocale();
  setLocale(createI18n({ lang: 'en', env: {} }));
  t.after(() => setLocale(prev));
}

test('표지 상수는 영어 정본이 먼저이고 한국어도 든다', () => {
  assert.deepEqual(OVERRIDES_SECTIONS, ['Overrides of other stacks', '다른 스택을 바꾸는 것']);
  assert.deepEqual(BUILD_SECTIONS, ['Build on apply', '반영할 때 항목 만들기']);
  assert.equal(OVERRIDE_LINES.length, 2);
});

test('영어·한국어 표지로 쓴 같은 원본이 같은 목록·바꿈 해석을 낸다', () => {
  const ko = catalogSummary(memoryTree({ ...base, 'rules/orca/README.md': koReadme }));
  const en = catalogSummary(memoryTree({ ...base, 'rules/orca/README.md': enReadme }));
  assert.deepEqual(en, ko);
  assert.equal(en.stacks.find(s => s.name === 'orca').overrides.length, 1);
  assert.deepEqual(en.warnings, []);
});

test('한 표 안에 두 표기가 섞여도 읽는다', () => {
  const mixed = '# orca\n\n## Overrides of other stacks\n\n| a | b |\n| --- | --- |\n| `00-a.md` 「절」 | `base/06-x.md` "절" |\n';
  const s = catalogSummary(memoryTree({ ...base, 'rules/orca/README.md': mixed }));
  assert.equal(s.stacks.find(x => x.name === 'orca').overrides.length, 1);
  assert.deepEqual(s.warnings, []);
});

test('바꿈 첫 줄: Overrides: 와 바꾸는 절: 이 같은 대상을 낸다, 한 파일에 섞여도 읽는다', t => {
  const p = tmpDir('guideline-proj-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  write(p, '.ruler/base/override.md', '# 바꿈\n\n## 하나\n\nOverrides: `base/06-x.md` "절"\n\n규칙\n\n## 둘\n\n바꾸는 절: `base/06-x.md` 「절」\n\n규칙\n\n## 셋\n\nOverrides: `base/06-x.md`\n\n전체\n');
  const got = checkOverrides(readProjectOverrides(p, 'ruler', []), memoryTree(base)).map(o => [o.heading, o.target, o.title, o.valid]);
  assert.deepEqual(got, [['하나', 'rules/base/06-x.md', '절', true], ['둘', 'rules/base/06-x.md', '절', true], ['셋', 'rules/base/06-x.md', null, true]]);
});

test('MCP: ## Build on apply 와 ## 반영할 때 항목 만들기 가 같은 build 서버를 낸다', () => {
  for (const h of ['Build on apply', '반영할 때 항목 만들기']) {
    assert.deepEqual(readServer(memoryTree({ 'README.md': `# b\n\n## ${h}\n\n내용\n` })), { build: true });
  }
});

test('영어 설정에서도 한국어 표지 원본을 읽는다', t => {
  english(t);
  const s = catalogSummary(memoryTree({ ...base, 'rules/orca/README.md': koReadme, 'mcp/b/README.md': '# b\n\n## 반영할 때 항목 만들기\n\n내용\n' }));
  assert.equal(s.stacks.find(x => x.name === 'orca').overrides.length, 1);
  assert.deepEqual(s.warnings, []);
  assert.ok(s.mcp.find(m => m.name === 'b').build);
});
