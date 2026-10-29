import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 저장소 문서는 영어가 기본이고 한국어판을 따로 둔다. 두 판은 서로 링크한다.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
/** 디렉터리 아래 .md 파일을 그 디렉터리 기준 경로로 모은다. */
const mdFiles = dir => fs.readdirSync(path.join(repo, dir), { recursive: true }).filter(f => f.endsWith('.md')).map(f => f.split(path.sep).join('/')).sort();
const MANUAL = mdFiles('docs/manual/en');
const PAIRS = [
  ['README.md', 'README.ko.md'],
  ...MANUAL.map(f => [`docs/manual/en/${f}`, `docs/manual/ko/${f}`]),
];
const HANGUL = /[가-힣]/;

test('사용자 문서는 en/ 과 ko/ 가 같은 파일 이름·구조이고, 번역본 첫 줄에 원본 경로와 원본 버전이 있다', () => {
  assert.ok(MANUAL.includes('getting-started.md'), 'getting-started.md');
  assert.deepEqual(mdFiles('docs/manual/ko'), MANUAL);
  // 버전은 번역을 맞춘 원본 버전이라 package.json 과 달라도 된다(뒤처지면 맨 위에 알림을 둔다)
  for (const [en, ko] of PAIRS) {
    assert.match(read(ko).split('\n')[0], new RegExp(`^<!-- source: ${en.replace(/\./g, '\\.')} @ v\\d+\\.\\d+\\.\\d+ -->$`), ko);
  }
});

test('영어 문서에는 한글이 없고, 한국어판과 서로 링크한다', () => {
  for (const [en, ko] of PAIRS) {
    const e = read(en);
    const k = read(ko);
    // 언어 전환 줄의 「한국어」 링크 글자만 허용한다
    assert.deepEqual(e.split('\n').filter(l => HANGUL.test(l.replace(/\[한국어\]\([^)]*\)/, ''))), [], en);
    const toKo = path.relative(path.dirname(en), ko);
    const toEn = path.relative(path.dirname(ko), en);
    assert.ok(e.split('\n').slice(0, 5).some(l => l.includes(`(${toKo})`)), `${en} → ${toKo}`);
    assert.ok(k.split('\n').slice(0, 5).some(l => l.includes(`(${toEn})`)), `${ko} → ${toEn}`);
  }
});

test('문서에 지운 명령과 옛 모드가 없다', () => {
  const gone = [/guideline init\b/, /--installed/, /문서 저장소 모드/, /docs-repo mode/i, /import-guideline/, /sync-guideline/, /server-import/, /assets\/seed-skills/];
  for (const file of PAIRS.flat()) {
    const text = read(file);
    for (const re of gone) assert.doesNotMatch(text, re, `${file}: ${re}`);
  }
});

test('언어 설정과 언어팩 안내가 있고, 버전은 0.23.0 이다', () => {
  for (const file of ['README.md', 'README.ko.md', 'docs/manual/en/configuration.md', 'docs/manual/ko/configuration.md']) {
    assert.match(read(file), /GUIDELINE_LANG/, file);
  }
  for (const lang of ['en', 'ko']) {
    const file = `docs/manual/${lang}/how-to/add-a-language-pack.md`;
    const text = read(file);
    for (const want of ['pack.json', 'messages.json', 'templates/', '{{', 'guideline locale check', 'GUIDELINE_LOCALES_DIR']) {
      assert.ok(text.includes(want), `${file}: ${want}`);
    }
  }
  for (const [file, marker] of [['docs/manual/en/reference.md', 'Overrides of other stacks'], ['docs/manual/ko/reference.md', '다른 스택을 바꾸는 것']]) {
    assert.ok(read(file).includes(marker), `${file}: ${marker}`);
  }
  assert.equal(JSON.parse(read('package.json')).version, '0.23.0');
});
