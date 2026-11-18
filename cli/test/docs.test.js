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

// .guideline 배치(받은 사본은 .guideline/, ruler 가 읽는 것은 apply 가 만드는 생성물)를 문서가 실제 동작대로 적는다.
const NEW_KINDS = ['apply', 'root-apply', 'no-copy', 'override-unchosen', 'mcp-conflict', 'untracked', 'stray-ruler-output', 'migrated', 'manifest-v3', 'prepare', 'dev-dependency', 'apply-hook'];

test('새 배치: 참조 문서에 apply 명령·파일 자리·새 할 일 종류가 있고, 사라진 종류는 「없어짐」 으로만 나온다', () => {
  for (const lang of ['en', 'ko']) {
    const ref = read(`docs/manual/${lang}/reference.md`);
    for (const want of ['guideline apply', '.guideline/rules/', '.guideline/overrides/', '.ruler/ruler.project.toml', '.gitignore', ...NEW_KINDS.map(k => `\`${k}\``)]) {
      assert.ok(ref.includes(want), `${lang}/reference.md: ${want}`);
    }
    assert.equal(ref.split('\n').filter(l => l.includes('`mcp-local`')).length, 1, `${lang}/reference.md: mcp-local 은 사라진 종류 한 줄에만`);
    // 올리기 문서는 씨앗 스킬에서 지울 행으로만 mcp-local 을 말한다
    assert.match(read(`docs/manual/${lang}/how-to/upgrade.md`), /`mcp-local`/, `${lang}/upgrade.md`);
    for (const f of mdFiles(`docs/manual/${lang}`).filter(x => x !== 'reference.md' && x !== 'how-to/upgrade.md')) {
      assert.doesNotMatch(read(`docs/manual/${lang}/${f}`), /`mcp-local`/, `${lang}/${f}`);
    }
  }
});

test('새 배치: 바꿈 자리는 .guideline/overrides 이고 옛 자리(.ruler/<스택>/override.md)를 안내하지 않는다', () => {
  for (const [lang, stack] of [['en', 'stack'], ['ko', '스택']]) {
    const text = read(`docs/manual/${lang}/how-to/override-guidelines.md`);
    assert.ok(text.includes(`.guideline/overrides/<${lang === 'en' ? 'stack path' : '스택 경로'}>/override.md`), lang);
    assert.ok(text.includes('.guideline/overrides/<'), lang);
    for (const f of mdFiles(`docs/manual/${lang}`)) {
      assert.ok(!read(`docs/manual/${lang}/${f}`).includes(`.ruler/<${stack}>/override.md`), `${lang}/${f}`);
    }
  }
});

test('새 배치: 시작하기·문제 해결·설정·모노레포·최신 유지 문서가 클론 직후 apply 와 생성물 규칙을 말한다', () => {
  for (const lang of ['en', 'ko']) {
    const gs = read(`docs/manual/${lang}/getting-started.md`);
    for (const want of ['guideline apply', '"prepare": "guideline apply"', 'orca.yaml', 'apply-hook', '.guideline/rules/', '.gitignore']) assert.ok(gs.includes(want), `${lang}/getting-started.md: ${want}`);
    const tr = read(`docs/manual/${lang}/troubleshooting.md`);
    for (const want of ['stray-ruler-output', 'root-apply', 'mcp-conflict', 'untracked', 'guideline apply', 'CLAUDE.md', '.claude/skills', 'guideline update']) assert.ok(tr.includes(want), `${lang}/troubleshooting.md: ${want}`);
    const conf = read(`docs/manual/${lang}/configuration.md`);
    for (const want of ['ruler.project.toml', '.guideline/overrides/', '.guideline/management/', '# START guideline generated files']) assert.ok(conf.includes(want), `${lang}/configuration.md: ${want}`);
    const mono = read(`docs/manual/${lang}/how-to/use-in-a-monorepo.md`);
    for (const want of ['.ruler/ruler.project.toml', 'root-apply', 'nested = true']) assert.ok(mono.includes(want), `${lang}/use-in-a-monorepo.md: ${want}`);
    assert.ok(read(`docs/manual/${lang}/how-to/stay-up-to-date.md`).includes('guideline apply'), lang);
    assert.ok(read(`docs/manual/${lang}/how-to/receive-from-several-sources.md`).includes('.guideline/management/<'), lang);
  }
});

test('새 배치: 올리기 문서가 이전 순서·서버 재배포·원본의 ruler 스택 수정·씨앗 갱신을 안내한다', () => {
  for (const lang of ['en', 'ko']) {
    const up = read(`docs/manual/${lang}/how-to/upgrade.md`);
    for (const want of ['/static/selection.js', 'dev-dependency', 'apply-hook', 'manifest-v3', 'mcp-conflict', 'git rm --cached', 'ruler.project.toml', 'pnpm add -D guideline-manage', 'guideline propose',
      'guideline apply --json', 'stray-ruler-output', 'guideline-export']) assert.ok(up.includes(want), `${lang}/upgrade.md: ${want}`);
  }
});

test('CHANGELOG 와 README 가 새 배치를 깨지는 변경으로 적는다', () => {
  const log = read('CHANGELOG.md');
  const unreleased = log.slice(log.indexOf('## Unreleased'), log.indexOf('## 0.23.0'));
  for (const want of ['`guideline apply`', '.guideline/', '.ruler/ruler.project.toml', 'git-ignored', 'Breaking', 'selection.js', ...NEW_KINDS.map(k => `\`${k}\``), 'mcp-local']) assert.ok(unreleased.includes(want), want);
  for (const f of ['README.md', 'README.ko.md']) {
    const text = read(f);
    for (const want of ['guideline apply', '.guideline/', 'ruler.project.toml']) assert.ok(text.includes(want), `${f}: ${want}`);
  }
});

// 개인 범위(pick --local)·필수 블록·머신 기본값을 문서가 실제 동작대로 적는다.
const PERSONAL_KINDS = ['setup-personal', 'personal-ignored', 'personal-shadowed', 'personal-revision', 'personal-sync', 'local-bad', 'ruler-leftover', 'override-target', 'unit-write-failed'];

test('개인 범위: 참조·설정·how-to·모노레포·문제 해결·올리기 문서가 pick --local 과 그 자리·할 일을 적는다', () => {
  const how = 'how-to/use-guidelines-only-on-your-machine.md';
  assert.ok(MANUAL.includes(how), how);
  const index = read('docs/manual/README.md');
  for (const lang of ['en', 'ko']) {
    assert.ok(index.includes(`(${lang}/${how})`), `README 목차: ${lang}`);
    const ref = read(`docs/manual/${lang}/reference.md`);
    for (const want of ['guideline pick --local', 'local.json', '%root', 'info/exclude', 'defaults.json', '"required"', 'scope: "personal"', '`shadowed`', 'modes: ["project", "personal"]', how, ...PERSONAL_KINDS.map(k => `\`${k}\``)]) {
      assert.ok(ref.includes(want), `${lang}/reference.md: ${want}`);
    }
    // status JSON 의 personal 이 null 인 뜻(git 아님, local.json 깨짐)
    assert.match(ref, lang === 'en' ? /`personal` is `null` when the unit is not in a git repository, or `local\.json` cannot be read/ : /git 저장소가 아니거나 `local\.json` 을 읽을 수 없으면[^\n]*`personal` 은 `null`/, lang);
    // 중첩 단위의 개인 폼은 루트 전용 블록을 막지 않는다(한계)
    for (const f of [`docs/manual/${lang}/reference.md`, `docs/manual/${lang}/${how}`, `docs/manual/${lang}/how-to/use-in-a-monorepo.md`]) {
      assert.match(read(f), lang === 'en' ? /does not (block|stop you from adding) (skills, subagents and MCP servers|them)/ : /막지 않습니다/, f);
    }
    const conf = read(`docs/manual/${lang}/configuration.md`);
    for (const want of ['defaults.json', 'local.json', 'info/exclude', 'XDG_CONFIG_HOME']) assert.ok(conf.includes(want), `${lang}/configuration.md: ${want}`);
    const page = read(`docs/manual/${lang}/${how}`);
    for (const want of ['guideline pick --local', 'setup-personal', 'personal-revision', 'personal-ignored', 'defaults.json', 'info/exclude', '%root', '--recommend']) assert.ok(page.includes(want), `${lang}/${how}: ${want}`);
    const mono = read(`docs/manual/${lang}/how-to/use-in-a-monorepo.md`);
    for (const want of ['unit-write-failed', 'guideline pick --local']) assert.ok(mono.includes(want), `${lang}/use-in-a-monorepo.md: ${want}`);
    const tr = read(`docs/manual/${lang}/troubleshooting.md`);
    for (const want of ['local-bad', 'defaults.json', 'info/exclude']) assert.ok(tr.includes(want), `${lang}/troubleshooting.md: ${want}`);
    const up = read(`docs/manual/${lang}/how-to/upgrade.md`);
    for (const want of ['guideline pick --local', ...PERSONAL_KINDS.map(k => `\`${k}\``)]) assert.ok(up.includes(want), `${lang}/upgrade.md: ${want}`);
  }
  const glossary = read('docs/manual/glossary.md');
  for (const want of ['| personal scope | 개인 범위 |', '| Required (block) | 필수 (블록) |', '| machine defaults | 머신 기본값 |', '| git common directory | git 공용 디렉터리 |']) assert.ok(glossary.includes(want), want);
});

test('개인 범위: CHANGELOG 와 README 가 pick --local·필수·머신 기본값·모든 프로젝트의 override-target 을 적는다', () => {
  const log = read('CHANGELOG.md');
  const unreleased = log.slice(log.indexOf('## Unreleased'), log.indexOf('## 0.23.0'));
  for (const want of ['`guideline pick --local`', 'Required', 'defaults.json', 'info/exclude', '`override-target`', 'in every project', 'scope: "personal"', ...PERSONAL_KINDS.map(k => `\`${k}\``)]) {
    assert.ok(unreleased.includes(want), want);
  }
  for (const f of ['README.md', 'README.ko.md']) assert.ok(read(f).includes('guideline pick --local'), f);
});
