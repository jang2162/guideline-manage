import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 저장소 문서는 영어가 기본이고 한국어판을 따로 둔다. 두 판은 서로 링크한다.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
const PAIRS = [
  ['README.md', 'README.ko.md'],
  ['docs/guide.md', 'docs/ko/guide.md'],
  ['docs/usage.md', 'docs/ko/usage.md'],
  ['docs/server.md', 'docs/ko/server.md'],
  ['docs/locales.md', 'docs/ko/locales.md'],
];
const HANGUL = /[가-힣]/;

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

test('언어 설정과 언어팩 안내가 있고, 버전은 0.16.1 이다', () => {
  for (const file of ['README.md', 'README.ko.md', 'docs/usage.md', 'docs/ko/usage.md', 'docs/server.md', 'docs/ko/server.md']) {
    assert.match(read(file), /GUIDELINE_LANG/, file);
  }
  for (const [file, marker] of [['docs/locales.md', 'Overrides of other stacks'], ['docs/ko/locales.md', '다른 스택을 바꾸는 것']]) {
    const text = read(file);
    for (const want of ['pack.json', 'messages.json', 'templates/', '{{', 'guideline locale check', 'GUIDELINE_LOCALES_DIR', marker]) {
      assert.ok(text.includes(want), `${file}: ${want}`);
    }
  }
  assert.equal(JSON.parse(read('package.json')).version, '0.16.1');
});
