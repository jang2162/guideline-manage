import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES_DIR } from '../src/i18n.js';

// 정본 검사: 코드가 쓰는 모든 키가 en 에 있고, 패키지에 든 언어(ko)는 en 의 키·템플릿을 빠짐없이 갖는다.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCAN = ['cli/src', 'server/src', 'server/static'];

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const messages = code => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, code, 'messages.json'), 'utf8'));
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const templateNames = (dir, rel = '') => {
  const abs = path.join(dir, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? templateNames(dir, r) : e.name.startsWith('.') ? [] : [r];
  });
};

test('소스의 모든 t() 키가 en 에 있다', () => {
  const en = messages('en');
  const missing = [];
  for (const f of SCAN.flatMap(d => files(path.join(repo, d)))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) {
      if (!Object.hasOwn(en, m[1])) missing.push(`${path.relative(repo, f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('ko 에 en 의 모든 키와 템플릿이 있고 자리 표시가 같다', () => {
  const en = messages('en');
  const ko = messages('ko');
  assert.deepEqual(Object.keys(en).filter(k => !Object.hasOwn(ko, k)), []);
  assert.deepEqual(Object.keys(ko).filter(k => !Object.hasOwn(en, k)), []);
  for (const k of Object.keys(en)) assert.deepEqual(placeholders(ko[k]), placeholders(en[k]), k);
  const enT = templateNames(path.join(LOCALES_DIR, 'en', 'templates')).sort();
  assert.deepEqual(templateNames(path.join(LOCALES_DIR, 'ko', 'templates')).sort(), enT);
});
