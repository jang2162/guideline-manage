import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 프로세스 하나에 언어 하나. CLI 와 서버가 함께 쓴다.
// 문구는 「사용자 L → 패키지 L → 사용자 en → 패키지 en」 순서로 찾고, 패키지 en 이 정본이다.

/** 패키지에 든 언어팩 폴더. */
export const LOCALES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales');

/**
 * 언어 코드를 맞춘다. 빈 값은 en, `ko-KR`·`ko_KR`·`KO` 는 ko.
 * @param {string | undefined} value
 */
export function normalizeLang(value) {
  const v = String(value ?? '').trim().toLowerCase().split(/[-_.]/)[0];
  return v || 'en';
}

/**
 * 사용자 언어팩 폴더. GUIDELINE_LOCALES_DIR 이 먼저이고, 서버는 dataDir/locales, CLI 는 설정 폴더 아래다.
 * @param {{ env?: object, home?: string, dataDir?: string }} [opts]
 * @returns {string[]}
 */
export function userLocaleDirs({ env = process.env, home, dataDir } = {}) {
  if (env.GUIDELINE_LOCALES_DIR) return [env.GUIDELINE_LOCALES_DIR];
  if (dataDir) return [path.join(dataDir, 'locales')];
  if (env.XDG_CONFIG_HOME) return [path.join(env.XDG_CONFIG_HOME, 'guideline', 'locales')];
  return [path.join(home ?? os.homedir(), '.config', 'guideline', 'locales')];
}

const stripBom = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

/** messages.json 을 읽는다. 없으면 {}, 깨졌으면 null(이유는 warn 으로). */
function readMessages(file, warn) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  let data;
  try {
    data = JSON.parse(stripBom(text));
  } catch (e) {
    warn(`${file}: messages.json is not valid JSON (${e.message})`);
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(v => typeof v !== 'string')) {
    warn(`${file}: messages.json must be an object of strings`);
    return null;
  }
  return data;
}

const fill = (text, params = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(params, k) ? String(params[k]) : m));
const fillTemplate = (text, params = {}) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (Object.hasOwn(params, k) ? String(params[k]) : m));

/**
 * @typedef {{ lang: string, t: (key: string, params?: object) => string, template: (name: string, params?: object) => string, warnings: string[] }} I18n
 */

/**
 * @param {{ lang?: string, env?: object, home?: string, dataDir?: string, packageDir?: string }} [opts]
 * @returns {I18n}
 */
export function createI18n({ lang, env = process.env, home, dataDir, packageDir = LOCALES_DIR } = {}) {
  const warnings = [];
  const warn = m => warnings.push(m);
  const roots = [...userLocaleDirs({ env, home, dataDir }), packageDir];
  const has = code => roots.some(r => fs.existsSync(path.join(r, code)));
  let code = normalizeLang(lang ?? env.GUIDELINE_LANG);
  if (code !== 'en' && !has(code)) {
    warn(`unknown language "${code}" — using English`);
    code = 'en';
  }
  const order = [...new Set([...roots.map(r => path.join(r, code)), ...roots.map(r => path.join(r, 'en'))])];
  const layers = order.map(dir => readMessages(path.join(dir, 'messages.json'), warn)).filter(Boolean);
  const canonical = readMessages(path.join(packageDir, 'en', 'messages.json'), warn) ?? {};

  const t = (key, params) => {
    if (!Object.hasOwn(canonical, key)) throw new Error(`missing message key: ${key}`);
    const want = placeholders(canonical[key]);
    for (const layer of layers) {
      const v = layer[key];
      if (typeof v === 'string' && placeholders(v) === want) return fill(v, params);
    }
    return fill(canonical[key], params);
  };

  const template = (name, params) => {
    for (const dir of order) {
      const file = path.join(dir, 'templates', name);
      if (fs.existsSync(file)) return fillTemplate(stripBom(fs.readFileSync(file, 'utf8')), params);
    }
    throw new Error(`missing template: ${name}`);
  };

  return { lang: code, t, template, warnings };
}

/**
 * 정본(패키지 en)의 키 중 prefix 로 시작하는 것.
 * @param {string} prefix
 * @param {{ packageDir?: string }} [opts]
 */
export function messageKeys(prefix = '', { packageDir = LOCALES_DIR } = {}) {
  const canonical = readMessages(path.join(packageDir, 'en', 'messages.json'), () => {}) ?? {};
  return Object.keys(canonical).filter(k => k.startsWith(prefix));
}

/** CLI 사용자 설정 파일. 로그인 정보와 같은 폴더다. */
export function configPath({ env = process.env, home = os.homedir() } = {}) {
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'guideline', 'config.json');
}

/**
 * 설정 파일의 lang. 파일이 없거나 lang 이 없으면 undefined, 깨졌으면 warn 하고 undefined.
 * @param {{ env?: object, home?: string, warn?: (m: string) => void }} [opts]
 */
export function configLang({ env = process.env, home, warn = () => {} } = {}) {
  const file = configPath({ env, home });
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const lang = JSON.parse(stripBom(text))?.lang;
    return typeof lang === 'string' && lang.trim() ? lang : undefined;
  } catch (e) {
    warn(`${file}: not valid JSON (${e.message})`);
    return undefined;
  }
}

let current = null;

/** 지금 프로세스의 언어. 처음 쓸 때 만든다: GUIDELINE_LANG → 설정 파일의 lang → en. 서버는 setLocale 로 따로 정한다. */
export function currentLocale() {
  if (!current) {
    const early = [];
    const lang = process.env.GUIDELINE_LANG ? undefined : configLang({ env: process.env, warn: m => early.push(m) });
    current = createI18n({ env: process.env, lang });
    current.warnings.unshift(...early);
  }
  return current;
}

/** @param {I18n} i18n */
export function setLocale(i18n) {
  current = i18n;
}

/** @param {string} key @param {object} [params] */
export const t = (key, params) => currentLocale().t(key, params);

/** @param {string} name @param {object} [params] */
export const template = (name, params) => currentLocale().template(name, params);

function templateNames(dir, rel = '') {
  const abs = path.join(dir, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(e => {
    if (e.name.startsWith('.')) return [];
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? templateNames(dir, r) : [r];
  });
}

/**
 * 언어팩 폴더를 정본(패키지 en)과 비교한다.
 * @param {string} dir 언어팩 폴더(<code>/)
 * @param {{ packageDir?: string }} [opts]
 * @returns {{ code: number, problems: { kind: string, key?: string, message: string }[] }}
 */
export function checkPack(dir, { packageDir = LOCALES_DIR } = {}) {
  const problems = [];
  let pack = null;
  try {
    pack = JSON.parse(stripBom(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')));
  } catch {
    pack = null;
  }
  if (!pack || typeof pack.code !== 'string' || typeof pack.name !== 'string' || typeof pack.version !== 'string') {
    problems.push({ kind: 'pack-json', message: 'pack.json needs "code", "name" and "version" strings' });
  }
  const canonical = readMessages(path.join(packageDir, 'en', 'messages.json'), () => {}) ?? {};
  let bad = null;
  const messages = readMessages(path.join(dir, 'messages.json'), m => { bad = m; });
  if (messages === null) problems.push({ kind: 'invalid-json', message: bad });
  else {
    for (const key of Object.keys(canonical)) {
      if (!Object.hasOwn(messages, key)) problems.push({ kind: 'missing-key', key, message: `missing key: ${key}` });
      else if (placeholders(messages[key]) !== placeholders(canonical[key])) {
        problems.push({ kind: 'placeholder', key, message: `placeholders differ from English: ${key}` });
      }
    }
    for (const key of Object.keys(messages)) {
      if (!Object.hasOwn(canonical, key)) problems.push({ kind: 'extra-key', key, message: `unknown key: ${key}` });
    }
  }
  const have = new Set(templateNames(path.join(dir, 'templates')));
  for (const name of templateNames(path.join(packageDir, 'en', 'templates'))) {
    if (!have.has(name)) problems.push({ kind: 'missing-template', key: name, message: `missing template: ${name}` });
  }
  return { code: problems.length ? 1 : 0, problems };
}

/**
 * 쓸 수 있는 언어. 같은 코드가 사용자 폴더와 패키지에 다 있으면 사용자 것으로 보인다.
 * @param {{ env?: object, home?: string, dataDir?: string, packageDir?: string }} [opts]
 * @returns {{ code: string, name: string, version: string, where: 'package' | 'user' }[]}
 */
export function listLocales({ env = process.env, home, dataDir, packageDir = LOCALES_DIR } = {}) {
  const seen = new Map();
  const scan = (root, where) => {
    if (!fs.existsSync(root)) return;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || seen.has(e.name)) continue;
      let pack = {};
      try {
        pack = JSON.parse(stripBom(fs.readFileSync(path.join(root, e.name, 'pack.json'), 'utf8')));
      } catch {
        pack = {};
      }
      seen.set(e.name, { code: e.name, name: String(pack.name ?? e.name), version: String(pack.version ?? ''), where });
    }
  };
  for (const r of userLocaleDirs({ env, home, dataDir })) scan(r, 'user');
  scan(packageDir, 'package');
  return [...seen.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
