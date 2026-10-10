import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.js';
import { normalizeLang, createI18n, checkPack, listLocales, userLocaleDirs, setLocale, currentLocale, configLang, configPath, t as t2 } from '../src/i18n.js';
import { marker } from '../src/markers.js';

/** locales 폴더를 만든다. messages: { 코드: { 키: 문구 } }, templates: { 코드: { 이름: 내용 } }. */
function localesDir(t, messages, templates = {}, raw = {}) {
  const dir = tmpDir('guideline-locales-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const code of new Set([...Object.keys(messages), ...Object.keys(templates), ...Object.keys(raw)])) {
    fs.mkdirSync(path.join(dir, code, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(dir, code, 'pack.json'), JSON.stringify({ code, name: code.toUpperCase(), version: '0.15.0' }));
    if (raw[code] !== undefined) fs.writeFileSync(path.join(dir, code, 'messages.json'), raw[code]);
    else fs.writeFileSync(path.join(dir, code, 'messages.json'), JSON.stringify(messages[code] ?? {}));
    for (const [name, content] of Object.entries(templates[code] ?? {})) {
      fs.mkdirSync(path.dirname(path.join(dir, code, 'templates', name)), { recursive: true });
      fs.writeFileSync(path.join(dir, code, 'templates', name), content);
    }
  }
  return dir;
}

test('설정이 없으면 en, ko-KR·KO·ko_KR 는 ko', () => {
  assert.equal(normalizeLang(undefined), 'en');
  assert.equal(normalizeLang(''), 'en');
  assert.equal(normalizeLang('ko-KR'), 'ko');
  assert.equal(normalizeLang('KO'), 'ko');
  assert.equal(normalizeLang('ko_KR'), 'ko');
});

test('lang 을 안 주면 env.GUIDELINE_LANG, 그것도 없으면 en', t => {
  const packageDir = localesDir(t, { en: { k: 'E' }, ko: { k: 'K' } });
  assert.equal(createI18n({ env: { GUIDELINE_LANG: 'ko' }, packageDir }).t('k'), 'K');
  assert.equal(createI18n({ env: {}, packageDir }).t('k'), 'E');
});

test('모르는 언어는 경고하고 영어', t => {
  const i = createI18n({ lang: 'xx', env: {}, packageDir: localesDir(t, { en: { 'a.b': 'Hello' } }) });
  assert.equal(i.lang, 'en');
  assert.equal(i.t('a.b'), 'Hello');
  assert.match(i.warnings.join('\n'), /xx/);
});

test('찾는 순서: 사용자 L > 패키지 L > 사용자 en > 패키지 en', t => {
  const packageDir = localesDir(t, { en: { k1: 'E1', k2: 'E2', k3: 'E3' }, ko: { k1: 'P1', k2: 'P2' } });
  const user = localesDir(t, { ko: { k1: 'U1' }, en: { k3: 'UE3' } });
  const i = createI18n({ lang: 'ko', packageDir, env: { GUIDELINE_LOCALES_DIR: user } });
  assert.deepEqual([i.t('k1'), i.t('k2'), i.t('k3')], ['U1', 'P2', 'UE3']);
});

test('사용자 폴더에만 있는 언어도 쓴다', t => {
  const packageDir = localesDir(t, { en: { k1: 'E1', k2: 'E2' } });
  const user = localesDir(t, { ja: { k1: 'J1' } });
  const i = createI18n({ lang: 'ja', packageDir, env: { GUIDELINE_LOCALES_DIR: user } });
  assert.equal(i.lang, 'ja');
  assert.deepEqual([i.t('k1'), i.t('k2')], ['J1', 'E2']);
  assert.deepEqual(i.warnings, []);
});

test('자리 표시를 채우고, 정본과 자리 표시가 다른 문구는 정본으로', t => {
  const packageDir = localesDir(t, { en: { k: 'Hi {name}', n: 'Count {n}' }, ko: { k: '안녕 {nmae}', n: '{n}개' } });
  const i = createI18n({ lang: 'ko', env: {}, packageDir });
  assert.equal(i.t('k', { name: 'A' }), 'Hi A');
  assert.equal(i.t('n', { n: 3 }), '3개');
});

test('정본에 없는 키는 키 이름을 내지 않고 던진다(프로그래머 오류)', t => {
  const i = createI18n({ lang: 'en', env: {}, packageDir: localesDir(t, { en: {} }) });
  assert.throws(() => i.t('no.such'), /no\.such/);
});

test('깨진 messages.json 은 건너뛰고 경고, BOM 은 읽는다', t => {
  const packageDir = localesDir(t, { en: { k: 'E', j: 'EJ' } }, {}, { ko: '{', ja: '﻿{"j":"J"}' });
  const ko = createI18n({ lang: 'ko', env: {}, packageDir });
  assert.equal(ko.t('k'), 'E');
  assert.match(ko.warnings.join('\n'), /messages\.json/);
  const ja = createI18n({ lang: 'ja', env: {}, packageDir });
  assert.equal(ja.t('j'), 'J');
  assert.deepEqual(ja.warnings, []);
});

test('문자열이 아닌 값이 있는 messages.json 은 통째로 건너뛴다', t => {
  const packageDir = localesDir(t, { en: { k: 'E', j: 'EJ' }, ko: { k: 'K', j: 1 } });
  const i = createI18n({ lang: 'ko', env: {}, packageDir });
  assert.equal(i.t('k'), 'E');
  assert.match(i.warnings.join('\n'), /messages\.json/);
});

test('템플릿: {{name}} 만 채우고 한 겹 중괄호는 그대로, 빠지면 en 템플릿', t => {
  const packageDir = localesDir(t, { en: {}, ko: {} }, { en: { 'x.txt': 'S={{server}} {"a": 1} {x}', 'y.md': 'EN' }, ko: { 'y.md': 'KO {{server}}' } });
  const i = createI18n({ lang: 'ko', env: {}, packageDir });
  assert.equal(i.template('x.txt', { server: 'http://s' }), 'S=http://s {"a": 1} {x}');
  assert.equal(i.template('y.md', { server: 'z' }), 'KO z');
  assert.throws(() => i.template('none.md'), /none\.md/);
});

test('userLocaleDirs: GUIDELINE_LOCALES_DIR > XDG_CONFIG_HOME > ~/.config, 서버는 dataDir/locales', () => {
  assert.deepEqual(userLocaleDirs({ env: { GUIDELINE_LOCALES_DIR: '/x' } }), ['/x']);
  assert.deepEqual(userLocaleDirs({ env: { XDG_CONFIG_HOME: '/c' } }), [path.join('/c', 'guideline', 'locales')]);
  assert.deepEqual(userLocaleDirs({ env: {}, home: '/h' }), [path.join('/h', '.config', 'guideline', 'locales')]);
  assert.deepEqual(userLocaleDirs({ env: {}, dataDir: '/data' }), [path.join('/data', 'locales')]);
});

test('checkPack: 빠진 키·남는 키·자리 표시·빠진 템플릿·pack.json', t => {
  const packageDir = localesDir(t, { en: { a: 'A', b: 'B {x}' } }, { en: { 'm.md': 'M' } });
  const ok = localesDir(t, { ja: { a: 'あ', b: 'い {x}' } }, { ja: { 'm.md': 'ま' } });
  assert.deepEqual(checkPack(path.join(ok, 'ja'), { packageDir }).problems, []);
  const bad = localesDir(t, { ja: { b: 'い {y}', c: 'C' } });
  fs.writeFileSync(path.join(bad, 'ja', 'pack.json'), '{"code":"ja"}');
  const kinds = checkPack(path.join(bad, 'ja'), { packageDir }).problems.map(p => `${p.kind}:${p.key ?? ''}`).sort();
  assert.deepEqual(kinds, ['extra-key:c', 'missing-key:a', 'missing-template:m.md', 'pack-json:', 'placeholder:b']);
  const broken = localesDir(t, {}, {}, { ja: '{' });
  assert.ok(checkPack(path.join(broken, 'ja'), { packageDir }).problems.some(p => p.kind === 'invalid-json'));
});

test('listLocales 는 패키지와 사용자 언어팩을 함께 보인다', t => {
  const packageDir = localesDir(t, { en: {}, ko: {} });
  const user = localesDir(t, { ja: {} });
  const list = listLocales({ env: { GUIDELINE_LOCALES_DIR: user }, packageDir });
  assert.deepEqual(list.map(l => [l.code, l.where]), [['en', 'package'], ['ja', 'user'], ['ko', 'package']]);
  assert.equal(list.find(l => l.code === 'ja').name, 'JA');
});

test('표지 문구는 언어팩이 아니라 코드가 정한다: ko 면 한국어 표지, 그 밖은 영어 표지', t => {
  const dir = localesDir(t, { ja: { 'marker.buildSection': '反映時の項目作成', 'mcp.emptyBuild': '「{section}」節が空です' } });
  const prev = currentLocale();
  t.after(() => setLocale(prev));
  setLocale(createI18n({ lang: 'ja', env: { GUIDELINE_LOCALES_DIR: dir } }));
  assert.equal(marker('buildSection'), 'Build on apply');
  assert.match(t2('mcp.emptyBuild', { section: marker('buildSection') }), /Build on apply/);
  setLocale(createI18n({ lang: 'ko', env: {} }));
  assert.equal(marker('buildSection'), '반영할 때 항목 만들기');
  assert.equal(marker('overridesSection'), '다른 스택을 바꾸는 것');
});

test('import 할 때 문구가 굳지 않는다: 언어를 바꾸면 unitProblem·inspect 문구도 바뀐다', async t => {
  const { unitProblem } = await import('../src/unit.js');
  const prev = currentLocale();
  t.after(() => setLocale(prev));
  setLocale(createI18n({ lang: 'en', env: {} }));
  assert.doesNotMatch(unitProblem('/x', { form: 'instructions' }), /[가-힣]/);
});

test('configLang: ~/.config/guideline/config.json 의 lang, 없거나 깨졌으면 undefined', t => {
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const warnings = [];
  const warn = m => warnings.push(m);
  assert.equal(configPath({ env: {}, home }), path.join(home, '.config', 'guideline', 'config.json'));
  assert.equal(configPath({ env: { XDG_CONFIG_HOME: '/x' }, home }), path.join('/x', 'guideline', 'config.json'));
  assert.equal(configLang({ env: {}, home, warn }), undefined);
  fs.mkdirSync(path.join(home, '.config', 'guideline'), { recursive: true });
  const file = configPath({ env: {}, home });
  fs.writeFileSync(file, '﻿{ "lang": "ko" }');
  assert.equal(configLang({ env: {}, home, warn }), 'ko');
  fs.writeFileSync(file, '{ "other": 1 }');
  assert.equal(configLang({ env: {}, home, warn }), undefined);
  assert.deepEqual(warnings, []);
  fs.writeFileSync(file, '{bad');
  assert.equal(configLang({ env: {}, home, warn }), undefined);
  assert.match(warnings[0], /config\.json/);
});

test('CLI 언어: GUIDELINE_LANG 이 설정 파일보다 먼저, 둘 다 없으면 영어', t => {
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.config', 'guideline'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'guideline', 'config.json'), JSON.stringify({ lang: 'ko' }));
  const run = env => {
    const out = spawnSync(process.execPath, [path.resolve('cli/bin/guideline.js'), 'help'], { env: { PATH: process.env.PATH, HOME: home, ...env }, encoding: 'utf8' });
    return out.stdout;
  };
  assert.match(run({}), /[가-힣]/);
  assert.doesNotMatch(run({ GUIDELINE_LANG: 'en' }), /[가-힣]/);
  fs.rmSync(path.join(home, '.config', 'guideline', 'config.json'));
  assert.doesNotMatch(run({}), /[가-힣]/);
});
