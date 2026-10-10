import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, collect } from './helpers.js';
import { LOCALES_DIR } from '../src/i18n.js';
import { locale } from '../src/commands/locale.js';

/** 패키지 en 을 복사한 사용자 언어팩 폴더(locales/<code>/). */
function copyOfEn(t, code = 'ja') {
  const root = tmpDir('guideline-userloc-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(LOCALES_DIR, 'en'), path.join(root, code), { recursive: true });
  fs.writeFileSync(path.join(root, code, 'pack.json'), JSON.stringify({ code, name: '日本語', version: '0.15.0' }));
  return { root, dir: path.join(root, code) };
}

test('locale check: en 을 복사한 폴더는 0, 키 하나를 지우면 1 과 그 키', t => {
  const { dir } = copyOfEn(t);
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify({ zzz: 'x' }));
  const o = collect();
  assert.equal(locale({ action: 'check', dir, out: o.out, err: o.out, env: {} }), 1);
  assert.match(o.text(), /zzz/);
  fs.writeFileSync(path.join(dir, 'messages.json'), fs.readFileSync(path.join(LOCALES_DIR, 'en', 'messages.json')));
  assert.equal(locale({ action: 'check', dir, out: () => {}, err: () => {}, env: {} }), 0);
});

test('locale check: 폴더가 없으면 2', () => {
  assert.equal(locale({ action: 'check', dir: '/no/such/dir', out: () => {}, err: () => {}, env: {} }), 2);
  assert.equal(locale({ action: 'check', out: () => {}, err: () => {}, env: {} }), 2);
});

test('locale list: en·ko 와 사용자 폴더의 언어팩, 지금 언어에 표시', t => {
  const { root } = copyOfEn(t);
  const o = collect();
  assert.equal(locale({ action: 'list', out: o.out, err: o.out, env: { GUIDELINE_LOCALES_DIR: root, GUIDELINE_LANG: 'ja' } }), 0);
  const lines = o.text().split('\n');
  assert.ok(lines.some(l => /^\* ja\b.*日本語/.test(l)), o.text());
  assert.ok(lines.some(l => /^ {2}en\b/.test(l)) && lines.some(l => /^ {2}ko\b/.test(l)), o.text());
  const j = collect();
  locale({ action: 'list', json: true, out: j.out, err: j.out, env: { GUIDELINE_LOCALES_DIR: root } });
  assert.deepEqual(JSON.parse(j.text()).locales.map(l => l.code), ['en', 'ja', 'ko']);
});

test('locale 에 모르는 하위 명령이면 2', () => {
  assert.equal(locale({ action: 'add', out: () => {}, err: () => {}, env: {} }), 2);
  assert.equal(locale({ action: undefined, out: () => {}, err: () => {}, env: {} }), 2);
});
