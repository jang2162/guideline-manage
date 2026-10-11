import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, META, ADMIN, login, getAs, postForm } from './helpers.js';
import { createI18n, setLocale, currentLocale, LOCALES_DIR } from '../../cli/src/i18n.js';
import { start } from '../src/main.js';
import { seedIfEmpty } from '../src/seed.js';

// 영어 서버의 화면·API 오류에 한글이 없어야 한다. 사람이 쓴 지침 내용(본문·경로·제목)은 빼고 본다.

const HANGUL = /[가-힣]/;
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static');

function locale(t, opts) {
  const prev = currentLocale();
  setLocale(createI18n({ env: {}, ...opts }));
  t.after(() => setLocale(prev));
}

/** HTML 에서 도구가 지은 글자만: 태그·스크립트 데이터·코드·pre 를 빼고 남은 글자. */
function visibleTool(html) {
  return html
    .replace(/<script type="application\/json"[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<(pre|code|textarea)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n').map(l => l.trim()).filter(Boolean);
}

const SOURCE = {
  'rules/base/README.md': '# base\n\nbase stack\n',
  'rules/base/00-a.md': '---\nload: always\n---\n# a\n\n## s\n\nbody\n',
  'rules/base/01-b.md': '---\nload: reference\nwhen: when b\n---\n# b\n',
  'rules/base/SETUP.md': '# setup\n',
  'skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\n\nbody\n',
  'mcp/c7/server.json': JSON.stringify({ type: 'stdio', command: 'npx' }),
};

test('영어 서버: 화면과 API 오류 본문에 한글이 없다', async t => {
  locale(t, { lang: 'en' });
  const s = await startApp(t);
  s.store.commit({ ...META, message: 'import', source: 'import', changes: SOURCE });
  s.tokens.issue({ name: 'cli-a', scope: 'read' });
  const ptoken = s.tokens.issue({ name: 'cli-p', scope: 'propose' }).token;
  await s.req('/api/v1/proposals', {
    method: 'POST', auth: ptoken, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'p', changes: [{ path: 'rules/base/00-a.md', text: '---\nload: always\n---\n# a\n\nnew\n', base: s.store.hashAt('rules/base/00-a.md') }] }),
  });
  const pages = ['/login', '/llms.txt'];
  const bad = [];
  for (const p of pages) {
    const r = await s.req(p);
    for (const l of visibleTool(r.text)) if (HANGUL.test(l)) bad.push(`${p}: ${l}`);
  }
  const cookie = await login(s);
  for (const p of ['/', '/s/base', '/skills', '/agents', '/mcp', '/s/base/00-a.md', '/s/base/00-a.md?raw=1', '/skills/s',
    '/edit/rules/base/00-a.md', '/new', '/history', '/history/rules/base/00-a.md', '/r/1', '/tokens', '/proposals', '/proposals/1', '/proposals/1/edit?path=rules/base/00-a.md',
    '/cli/login?port=1234&state=x&challenge=y&host=h', '/s/base/no-such.md']) {
    const r = await getAs(s, cookie, p);
    for (const l of visibleTool(r.text)) if (HANGUL.test(l)) bad.push(`${p}: ${l}`);
  }
  const e1 = await s.req('/api/v1/catalog');
  const e2 = await s.req('/api/v1/proposals', { method: 'POST', auth: ptoken, headers: { 'Content-Type': 'application/json' }, body: '{"title":"x","changes":[]}' });
  const e3 = await postForm(s, '/login', { token: 'wrong', next: '/' });
  for (const [name, r] of [['catalog 401', e1], ['proposal 400', e2], ['login 401', e3]]) {
    for (const l of visibleTool(r.text)) if (HANGUL.test(l)) bad.push(`${name}: ${l}`);
  }
  assert.deepEqual(bad, []);
});

test('정적 스크립트에는 한국어 문구가 없다(문구는 i18n JSON 블록으로 받는다)', () => {
  for (const f of fs.readdirSync(staticDir).filter(f => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(staticDir, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\/\/.*$/, ''));
    assert.deepEqual(code.filter(l => HANGUL.test(l)), [], f);
  }
});

test('언어팩 문구의 <script> 는 서버 HTML 과 i18n JSON 블록 모두에서 글자다', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guideline-data-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const en = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'en', 'messages.json'), 'utf8'));
  const evil = Object.fromEntries(Object.keys(en).filter(k => k.startsWith('web.')).map(k => [k, `<script>x</script>${en[k]}`]));
  fs.mkdirSync(path.join(dataDir, 'locales', 'en'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'locales', 'en', 'messages.json'), JSON.stringify(evil));
  locale(t, { lang: 'en', dataDir });
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  const cookie = await login(s);
  for (const p of ['/', '/tokens', '/proposals']) {
    const html = (await getAs(s, cookie, p)).text;
    assert.ok(!html.includes('<script>x'), p);
    assert.ok(html.includes('&lt;script&gt;x'), p);
    const block = /<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(block, `${p}: i18n 블록이 없다`);
    assert.ok(!block[1].includes('<'), `${p}: i18n 블록에 < 가 그대로 있다`);
  }
});

test('모르는 GUIDELINE_LANG 이면 시작 로그에 경고하고 영어로 뜬다', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guideline-data-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const prev = currentLocale();
  t.after(() => setLocale(prev));
  const lines = [];
  const r = await start({ env: { ADMIN_TOKEN: ADMIN, PUBLIC_URL: 'http://guideline.test', DATA_DIR: dataDir, PORT: '0', GUIDELINE_LANG: 'xx', GUIDELINE_SEED: 'off' }, log: l => lines.push(l), error: l => lines.push(l) });
  t.after(() => r.close?.());
  assert.equal(r.code, 0, lines.join('\n'));
  assert.match(lines.join('\n'), /unknown language "xx"/);
  assert.equal(currentLocale().lang, 'en');
});

test('정적 스크립트는 문구(t(), *_LABEL[...])를 esc() 없이 HTML 문자열에 넣지 않는다', () => {
  const bad = [];
  for (const f of fs.readdirSync(staticDir).filter(n => n.endsWith('.js'))) {
    fs.readFileSync(path.join(staticDir, f), 'utf8').split('\n').forEach((l, i) => {
      if (!l.includes('<')) return;
      for (const m of l.matchAll(/\$\{([^}]*)\}/g)) {
        if (m[1].includes('`')) continue; // 안쪽 템플릿은 그 줄의 다른 ${} 로 따로 본다
        if (/(\bt\(|_LABEL\[)/.test(m[1]) && !/^\s*esc\(/.test(m[1])) bad.push(`${f}:${i + 1}: ${m[0]}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('씨앗 리비전은 이력에서 그 언어의 출처 라벨로 보인다', async t => {
  const prev = currentLocale();
  t.after(() => setLocale(prev));
  setLocale(createI18n({ lang: 'en', env: {} }));
  const s = await startApp(t);
  seedIfEmpty({ store: s.store, lang: 'en' });
  const cookie = await login(s);
  const r = await getAs(s, cookie, '/history');
  assert.match(r.text, /Seed/);
  assert.doesNotMatch(r.text, />seed</);
});
