import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCALES_DIR } from '../src/i18n.js';

// 한국어 템플릿(지금 문장 그대로)을 본다. 영어판은 templates.test.js 가 본다.
const assetsDir = path.join(LOCALES_DIR, 'ko', 'templates');
const SEED_SKILLS = ['guideline-sync', 'guideline-export'];
import { BUILD_SECTION } from '../src/mcp.js';
import { OVERRIDES_SECTION } from '../src/overrides.js';

/** --- 로 둘러싼 frontmatter 를 { 키: 값 } 으로. 없으면 null. */
function frontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trimEnd() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end === -1) return null;
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i === -1) return null;
    fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}


test('씨앗 스킬 자산의 frontmatter 는 name·description 두 개이고 name 이 디렉터리 이름과 같다', () => {
  for (const name of SEED_SKILLS) {
    const file = path.join(assetsDir, 'skills', name, 'SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    assert.ok(fm, `${name}: frontmatter 가 없다`);
    assert.deepEqual(Object.keys(fm).sort(), ['description', 'name'], `${name}: 키가 다르다`);
    assert.equal(fm.name, name);
    assert.ok(fm.description.length > 0, `${name}: description 이 비었다`);
    assert.match(text, /지침 서버가 처음 시작할 때 씨앗으로 넣는다/, `${name}: 씨앗 안내가 없다`);
    assert.doesNotMatch(text, /guideline update 가 덮어쓴다/, `${name}: 관리 스킬 문구가 씨앗에 남아 있으면 안 된다`);
  }
});

test('작성 규칙 템플릿이 있다', () => {
  assert.ok(fs.existsSync(path.join(assetsDir, 'authoring.md')));
});




test('작성 규칙 템플릿에 서브에이전트·MCP 서버 절이 있다', () => {
  const text = fs.readFileSync(path.join(assetsDir, 'authoring.md'), 'utf8');
  assert.match(text, /^## 서브에이전트$/m);
  assert.match(text, /^## MCP 서버$/m);
  assert.match(text, /agents\/<이름>\.md/);
  assert.match(text, /mcp\/<이름>\/server\.json/);
});


test('반영할 때 항목 만들기 절 제목이 CLI·작성 규칙·스킬 네 개에서 같다', () => {
  const heading = `## ${BUILD_SECTION}`;
  const authoring = fs.readFileSync(path.join(assetsDir, 'authoring.md'), 'utf8');
  assert.match(authoring, /^### 반영할 때 항목을 만드는 서버$/m);
  assert.ok(authoring.includes(heading), 'authoring.md');
  const files = [
    ...SEED_SKILLS.map(name => path.join(assetsDir, 'skills', name, 'SKILL.md')),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes(heading), `${file}: 절 제목이 없다`);
    assert.ok(text.includes('반영할 때 README 로 만듦'), `${file}: list 표시 문구가 없다`);
  }
});

test('작성 규칙과 스킬 네 개가 지침 파일의 칸(load·when)을 다룬다', () => {
  const authoring = fs.readFileSync(path.join(assetsDir, 'authoring.md'), 'utf8');
  assert.match(authoring, /^## 칸 — 상시와 참조$/m);
  assert.match(authoring, /^load: reference$/m);
  const read = (dir, name) => fs.readFileSync(path.join(assetsDir, dir, name, 'SKILL.md'), 'utf8');
  for (const text of [read('skills', 'guideline-export')]) {
    assert.match(text, /## 칸 — 상시와 참조/);
    assert.match(text, /사용처 수로 거르지 않는다/);
    assert.doesNotMatch(text, /두 프로젝트 이상에서 참이라고 확신할 수 없으면/);
  }
});


test('작성 규칙과 스킬 네 개가 스택 사이의 바꿈을 같은 표 제목으로 다룬다', () => {
  const heading = `## ${OVERRIDES_SECTION}`;
  const authoring = fs.readFileSync(path.join(assetsDir, 'authoring.md'), 'utf8');
  assert.match(authoring, /^## 다른 스택을 바꿀 때$/m);
  assert.ok(authoring.includes(heading), 'authoring.md 에 표 제목이 없다');
  const read = (dir, name) => fs.readFileSync(path.join(assetsDir, dir, name, 'SKILL.md'), 'utf8');
  for (const text of [read('skills', 'guideline-export')]) {
    assert.match(text, /\| 다른 스택을 바꿈 \|/);
    assert.ok(text.includes(heading), '가져오기 스킬에 표 제목이 없다');
  }
});

test('작성 규칙 템플릿에 분류·세팅 문서 절과 표의 두 줄이 있다', () => {
  const text = fs.readFileSync(path.join(assetsDir, 'authoring.md'), 'utf8');
  assert.match(text, /^## 분류$/m);
  assert.match(text, /^## 세팅 문서$/m);
  assert.match(text, /categories: \[backend, spring\]/);
  assert.match(text, /\| 요소를 묶어 고르는 분류 \|/);
  assert.match(text, /\| 스택을 들일 때나 클론마다 하는 세팅 \| `rules\/<스택>\/SETUP\.md`/);
});

const skillText = (dir, name) => fs.readFileSync(path.join(assetsDir, dir, name, 'SKILL.md'), 'utf8');



test('가져오기 스킬 두 벌은 프로젝트 바꿈과 관리 지침을 후보로 올리지 않고 바꿈을 표로 보인다', () => {
  for (const text of [skillText('skills', 'guideline-export')]) {
    assert.match(text, /^### 프로젝트 바꿈$/m);
    assert.match(text, /\.ruler\/<스택>\/override\.d\/\*\.md/);
    assert.match(text, /관리 지침\(`\.ruler\/guideline\.md`, 지침 파일의 `## 공용 지침 관리` 절\)/);
    assert.match(text, /\*\*스택 사이 바꿈으로 올림\*\*/);
  }
});


test('프로젝트 쪽 guideline-sync 는 CLI 를 부르고 할 일 종류를 모두 다룬다', () => {
  const text = skillText('skills', 'guideline-sync');
  for (const kind of ['mcp-build', 'env', 'setup', 'conflict', 'skipped', 'override', 'subagents-off', 'ruler-apply', 'new-file', 'removed-upstream', 'blocked', 'leftover', 'nested-off', 'mcp-local', 'adopted']) {
    assert.ok(text.includes(`\`${kind}\``), `할 일 ${kind} 이 없다`);
  }
  assert.match(text, /guideline status --json/);
  assert.match(text, /guideline update --json/);
  assert.match(text, /guideline pick --new/);
  assert.match(text, /guideline login --server/);
  assert.match(text, /폼 제출이 사용자의 확인이다/);
  assert.match(text, /\*\*비밀값을 프로젝트 파일에 쓰지 않는다\.\*\*/);
  assert.doesNotMatch(text, /문서 저장소의 로컬 경로를 사용자에게 묻는다/);
  assert.doesNotMatch(text, /`old-section`|guideline:begin/);
  assert.match(text, /guideline propose --dry-run/);
  assert.match(text, /ruler 프로젝트가 아님/);
});

test('guideline-export 는 표지 블록과 매니페스트·잠금을 sync 사본으로 친다', () => {
  assert.match(skillText('skills', 'guideline-export'), /`guideline:begin`~`guideline:end` 블록과 `guideline\.json`·`guideline-lock\.json`/);
});

test('프로젝트 쪽 guideline-export 는 원본 폴더에 쓰고 제안으로 올린다', () => {
  const text = skillText('skills', 'guideline-export');
  assert.match(text, /guideline source <폴더>/);
  assert.match(text, /guideline propose --from <원본 폴더> --dry-run/);
  assert.match(text, /guideline propose --from <원본 폴더> --title/);
  assert.match(text, /guideline propose --from <원본 폴더> --title <제목> --review/);
  assert.match(text, /`guideline propose --from <원본 폴더> --dry-run --json` 의 `mode` 로 판단한다/);
  assert.match(text, /`mode` 가 `apply` 면 `guideline propose` 는 \*\*제안 대신 바로 반영한다\*\*/);
  assert.match(text, /보내기 전에 사용자에게 「검토 없이 바로 반영된다」 고 알린다/);
  assert.doesNotMatch(text, /저장된 토큰의 범위를 `guideline status` 의 「토큰:」 줄\(`--json` 이면 `token`\)로 본다/);
  assert.doesNotMatch(text, /사용자가 검토 없이 바로 반영하라고 했을 때만/);
  assert.match(text, /받은 사본을 고친 것은 이 스킬이 아니다/);
  assert.doesNotMatch(text, /문서 저장소의 로컬 경로를 사용자에게 묻는다/);
  assert.doesNotMatch(text, /기본 브랜치에 바로 커밋하지 않는다/);
});

test('작성 규칙 템플릿에 관리 지침 추가 문단 절이 있다', () => {
  const text = fs.readFileSync(path.join(assetsDir, 'authoring.md'), 'utf8');
  assert.match(text, /^## 관리 지침 추가 문단$/m);
  assert.match(text, /docs\/management\.md/);
});

test('프로젝트 쪽 스킬이 여러 출처를 다룬다', () => {
  const sync = skillText('skills', 'guideline-sync');
  assert.match(sync, /--source/);
  assert.match(sync, /이름 충돌/);
  assert.match(sync, /`alias`/);
  assert.match(skillText('skills', 'guideline-export'), /--source <이름>/);
});

test('guideline-sync 는 고친 사본을 올리기 전에 dry-run 의 mode 를 보고 바로 반영이면 먼저 알린다', () => {
  const text = skillText('skills', 'guideline-sync');
  assert.match(text, /dry-run 이 알린다\(`--json` 이면 `mode`\)/);
  assert.match(text, /`apply`\(「보내면 바로 반영됨」\)면 보내기 전에 사용자에게 검토 없이 바로 반영된다고 알리고/);
});
