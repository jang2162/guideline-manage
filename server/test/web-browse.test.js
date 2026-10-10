import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRichDocsRepo, filesOf, tmpDir, reference } from '../../cli/test/helpers.js';
import { startApp, testConfig, postForm, login, getAs, ADMIN, META } from './helpers.js';

async function seeded(t) {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: filesOf(root) });
  return { s, cookie: await login(s) };
}

test('세션이 없으면 로그인으로 보내고, 맞는 토큰이면 쿠키를 주고 next 로 보낸다', async t => {
  const s = await startApp(t);
  const anon = await s.req('/d/rules');
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.location, '/login?next=%2Fd%2Frules');
  const wrong = await postForm(s, '/login', { token: 'nope', next: '/' });
  assert.equal(wrong.status, 401);
  assert.match(wrong.text, /토큰이 맞지 않는다/);
  const ok = await postForm(s, '/login', { token: ADMIN, next: '/d/rules' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.location, '/d/rules');
  const cookie = ok.headers['set-cookie'][0];
  assert.match(cookie, /^gs_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  assert.equal((await getAs(s, cookie.split(';')[0], '/')).status, 200);
  const evil = await postForm(s, '/login', { token: ADMIN, next: '//evil.example.com' });
  assert.equal(evil.headers.location, '/');
});

test('PUBLIC_URL 이 https 면 쿠키에 Secure 가 붙는다', async t => {
  const s = await startApp(t, { config: testConfig({ publicUrl: new URL('https://guideline.test') }) });
  const ok = await postForm(s, '/login', { token: ADMIN });
  assert.match(ok.headers['set-cookie'][0], /; Secure$/);
});

test('10분 안에 5번 틀리면 맞는 토큰도 429', async t => {
  const s = await startApp(t);
  for (let i = 0; i < 5; i++) await postForm(s, '/login', { token: 'nope' });
  const r = await postForm(s, '/login', { token: ADMIN });
  assert.equal(r.status, 429);
  assert.match(r.text, /너무 많이 틀렸다/);
});

test('PUBLIC_URL 과 다른 출처의 POST 는 403 이고 PUBLIC_URL 로 접속하라고 알려 준다', async t => {
  const s = await startApp(t);
  const other = await postForm(s, '/login', { token: ADMIN }, { origin: 'http://10.0.0.5:3000' });
  assert.equal(other.status, 403);
  assert.equal(other.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(other.text, /http:\/\/guideline\.test 로 접속해서 다시 한다/);
  assert.equal((await postForm(s, '/login', { token: ADMIN }, { origin: null })).status, 403);
  const page = await s.req('/login');
  assert.match(page.text, /PUBLIC_URL\(http:\/\/guideline\.test\)과 다르다/);
  const same = await s.req('/login', { headers: { Host: 'guideline.test' } });
  assert.doesNotMatch(same.text, /PUBLIC_URL/);
});

test('로그아웃은 쿠키를 지우고 로그인으로 보낸다', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  const r = await postForm(s, '/logout', {}, { cookie });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/login');
  assert.match(r.headers['set-cookie'][0], /^gs_session=; .*Max-Age=0/);
});

test('빈 저장소의 목록은 새 파일과 제안 API 를 안내한다', async t => {
  const s = await startApp(t);
  const r = await getAs(s, await login(s), '/');
  assert.match(r.text, /POST \/api\/v1\/proposals/);
  assert.doesNotMatch(r.text, /server-import/);
});

test('목록은 스택·세팅 문서·무시됨·경고를, 탭은 스킬·서브에이전트·MCP 를 보이고, 분류로 거르고, 내용을 이스케이프한다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'rules/demo/02-xss.md': `${reference('<script>alert(1)</script> 할 때')}# x\n` } });
  const r = await getAs(s, cookie, '/');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  for (const s2 of ['base', 'orca', '세팅 문서', '무시됨', 'rules/base/오타.md', '경고', 'rules/demo/01-bad.md']) {
    assert.ok(r.text.includes(s2), s2);
  }
  for (const [p, names] of [['/skills', ['demo-skill']], ['/agents', ['code-reviewer']], ['/mcp', ['gitlab', 'GITLAB_TOKEN']]]) {
    const page = (await getAs(s, cookie, p)).text;
    for (const n of names) assert.ok(page.includes(n), `${p} ${n}`);
  }
  const demo = (await getAs(s, cookie, '/s/demo')).text;
  assert.ok(demo.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!demo.includes('<script>alert'));
  assert.ok(!r.text.includes('<script>alert'));
  const filtered = await getAs(s, cookie, `/?cat=${encodeURIComponent('공통')}`);
  assert.ok(filtered.text.includes('<a class="card" href="/s/base">'));
  assert.ok(!filtered.text.includes('<a class="card" href="/s/demo">'));
});

test('파일 보기는 텍스트를 이스케이프해 보이고, 바이너리는 크기와 내려받기, 디렉터리는 /d/ 로 보낸다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'skills/demo-skill/logo.png': Buffer.from([0x89, 0x50, 0x00]), 'rules/base/03-html.md': '<b>굵게</b>\n' } });
  const text = await getAs(s, cookie, '/f/rules/base/03-html.md');
  assert.ok(text.text.includes('&lt;b&gt;굵게&lt;/b&gt;'));
  assert.ok(text.text.includes('/edit/rules/base/03-html.md'));
  const bin = await getAs(s, cookie, '/f/skills/demo-skill/logo.png');
  assert.match(bin.text, /바이너리 파일 · 3 바이트/);
  assert.ok(!bin.text.includes('/edit/skills/demo-skill/logo.png'));
  const dir = await getAs(s, cookie, '/f/rules/base');
  assert.equal(dir.status, 303);
  assert.equal(dir.headers.location, '/d/rules/base');
  const missing = await getAs(s, cookie, '/f/rules/nope.md');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['content-type'], 'text/html; charset=utf-8');
  const raw = await getAs(s, cookie, '/raw/skills/demo-skill/logo.png');
  assert.ok(raw.body.equals(Buffer.from([0x89, 0x50, 0x00])));
  assert.equal(raw.headers['content-disposition'], "attachment; filename*=UTF-8''logo.png");
});

test('디렉터리 보기는 항목과 올리기 폼(현재 해시 포함)을 보이고, 루트는 최상위를 보인다', async t => {
  const { s, cookie } = await seeded(t);
  const r = await getAs(s, cookie, '/d/skills/demo-skill');
  assert.ok(r.text.includes('href="/f/skills/demo-skill/SKILL.md"'));
  assert.ok(r.text.includes('data-upload="skills/demo-skill"'));
  assert.match(r.text, /data-hashes="\{&quot;SKILL\.md&quot;:&quot;[0-9a-f]{64}&quot;\}"/);
  const root = await getAs(s, cookie, '/d/');
  for (const name of ['agents/', 'mcp/', 'rules/', 'skills/']) assert.ok(root.text.includes(`>${name}</a>`), name);
  assert.equal((await getAs(s, cookie, '/d/rules/nope')).status, 404);
});

test('내보내기는 최신 상태를 옛 저장소 구조의 tar.gz 로 준다', async t => {
  const { s, cookie } = await seeded(t);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  s.store.commit({ ...META, changes: { 'skills/demo-skill/logo.png': png } });
  const r = await getAs(s, cookie, '/export.tar.gz');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-disposition'], 'attachment; filename="guideline-r2.tar.gz"');
  const dir = tmpDir('guideline-export-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'x.tar.gz'), r.body);
  fs.mkdirSync(path.join(dir, 'out'));
  execFileSync('tar', ['-xzf', path.join(dir, 'x.tar.gz'), '-C', path.join(dir, 'out')]);
  const got = filesOf(path.join(dir, 'out'));
  assert.deepEqual(Object.keys(got).sort(), s.store.pathsAt().map(f => f.path));
  assert.ok(got['skills/demo-skill/logo.png'].equals(png));
});

test('정적 파일은 로그인 없이 받고, 없는 이름은 404', async t => {
  const s = await startApp(t);
  const css = await s.req('/static/app.css');
  assert.equal(css.status, 200);
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await s.req('/static/app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await s.req('/static/nope.js')).status, 404);
});

test('분류 링크와 새 파일의 틀 링크 사이에 빈칸이 있어 좁은 화면에서 줄이 바뀐다', async t => {
  const { s, cookie } = await seeded(t);
  const home = await getAs(s, cookie, '/');
  assert.match(home.text, />gitlab<\/a>\s+<a /);
  assert.match(home.text, />전체<\/a>\s+<a /);
  const page = await getAs(s, cookie, '/new');
  assert.match(page.text, />빈 파일<\/a>\s+<a /);
});

test('올리기 JS 는 macOS 의 NFD 파일 이름을 NFC 로 맞춰 해시를 찾고 경로를 만든다', async t => {
  const s = await startApp(t);
  const js = (await s.req('/static/app.js')).text;
  assert.match(js, /const name = file\.name\.normalize\('NFC'\);/);
  assert.match(js, /hashes\[name\]/);
  assert.match(js, /`\$\{form\.dataset\.upload\}\/\$\{name\}`/);
});
