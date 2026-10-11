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

test('관리자 화면은 세션이 없으면 로그인으로 보내고, 맞는 토큰이면 쿠키를 주고 next 로 보낸다', async t => {
  const s = await startApp(t);
  const anon = await s.req('/new?dir=rules');
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.location, '/login?next=%2Fnew%3Fdir%3Drules');
  const wrong = await postForm(s, '/login', { token: 'nope', next: '/' });
  assert.equal(wrong.status, 401);
  assert.match(wrong.text, /토큰이 맞지 않음/);
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
  assert.match(r.text, /시도 횟수 초과/);
});

test('PUBLIC_URL 과 다른 출처의 POST 는 403 이고 PUBLIC_URL 로 접속하라고 알려 준다', async t => {
  const s = await startApp(t);
  const other = await postForm(s, '/login', { token: ADMIN }, { origin: 'http://10.0.0.5:3000' });
  assert.equal(other.status, 403);
  assert.equal(other.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(other.text, /http:\/\/guideline\.test 로 접속해서 다시 시도/);
  assert.equal((await postForm(s, '/login', { token: ADMIN }, { origin: null })).status, 403);
  const page = await s.req('/login');
  assert.match(page.text, /PUBLIC_URL\(http:\/\/guideline\.test\)과 다름/);
  const same = await s.req('/login', { headers: { Host: 'guideline.test' } });
  assert.doesNotMatch(same.text, /PUBLIC_URL/);
});

test('로그아웃은 쿠키를 지우고 목록으로 보낸다', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  const r = await postForm(s, '/logout', {}, { cookie });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/');
  assert.match(r.headers['set-cookie'][0], /^gs_session=; .*Max-Age=0/);
});

test('보기는 로그인 없이 되고, 바꾸는 버튼·관리자 링크는 숨기고 로그인 링크를 둔다', async t => {
  const { s } = await seeded(t);
  for (const p of ['/', '/s/base', '/s/base/02-git.md', '/skills', '/skills/demo-skill', '/agents', '/agents/code-reviewer', '/mcp', '/mcp/gitlab', '/history', '/history/rules/base/02-git.md', '/r/1', '/raw/rules/base/02-git.md', '/archive/rules/base']) {
    const r = await s.req(p);
    assert.equal(r.status, 200, p);
  }
  const file = (await s.req('/s/base/02-git.md')).text;
  assert.match(file, /<a href="\/login\?next=%2Fs%2Fbase%2F02-git\.md">로그인<\/a>/);
  for (const [p, text] of [
    ['/s/base/02-git.md', file],
    ['/s/base', (await s.req('/s/base')).text],
    ['/history/rules/base/02-git.md', (await s.req('/history/rules/base/02-git.md')).text],
    ['/r/1', (await s.req('/r/1')).text],
  ]) {
    for (const bit of ['href="/edit/', 'href="/new', 'action="/rename"', 'action="/delete/', 'action="/revert"', 'data-upload=', 'href="/tokens"', 'href="/proposals"', 'action="/logout"']) {
      assert.ok(!text.includes(bit), `${p}: ${bit}`);
    }
  }
  const admin = (await getAs(s, await login(s), '/s/base/02-git.md')).text;
  for (const bit of ['href="/edit/', 'href="/new', 'data-upload=', 'action="/rename"', 'href="/tokens"', 'href="/proposals"', 'action="/logout"']) assert.ok(admin.includes(bit), bit);
  assert.ok(!admin.includes('href="/login'));
});

test('비공개(PUBLIC_READ=0)면 보기 화면도 로그인으로 보낸다', async t => {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = await startApp(t, { config: testConfig({ publicRead: false }) });
  s.store.commit({ ...META, source: 'import', changes: filesOf(root) });
  for (const p of ['/', '/s/base', '/skills', '/s/base/02-git.md', '/raw/rules/base/02-git.md', '/archive/rules/base', '/history', '/r/1']) {
    const r = await s.req(p);
    assert.equal(r.status, 303, p);
    assert.equal(r.headers.location, `/login?next=${encodeURIComponent(p)}`, p);
  }
  assert.equal((await s.req('/llms.txt')).status, 200);
  assert.equal((await getAs(s, await login(s), '/s/base')).status, 200);
});

test('세션 없이 바꾸는 요청은 로그인으로 보내고 아무것도 바꾸지 않는다', async t => {
  const { s } = await seeded(t);
  const head = s.store.headRevision();
  for (const p of ['/tokens', '/proposals', '/edit/rules/base/02-git.md', '/new', '/cli/login']) {
    const r = await s.req(p);
    assert.equal(r.status, 303, p);
    assert.match(r.headers.location, /^\/login\?next=/, p);
  }
  const posts = [
    ['/edit/rules/base/02-git.md', { content: 'x', base: s.store.hashAt('rules/base/02-git.md'), message: 'm' }],
    ['/new', { path: 'rules/base/zz.md', content: 'x', message: 'm' }],
    ['/delete/rules/base/02-git.md', { message: 'm' }],
    ['/rename', { from: 'rules/base/02-git.md', to: 'rules/base/zz.md', message: 'm' }],
    ['/revert', { kind: 'revision', rev: '1', confirmed: '1' }],
    ['/tokens', { name: 'x', scope: 'read' }],
  ];
  for (const [p, fields] of posts) {
    const r = await postForm(s, p, fields);
    assert.equal(r.status, 303, p);
    assert.match(r.headers.location, /^\/login\?next=/, p);
  }
  const up = await s.req('/upload/rules/base/zz.md', { method: 'PUT', body: 'x', headers: { Origin: s.config.publicUrl.origin, 'X-Message': 'm' } });
  assert.equal(up.status, 401);
  assert.equal(s.store.headRevision(), head);
  assert.equal(s.tokens.list().length, 0);
});

test('빈 저장소의 목록은 새 파일과 제안 API 를 안내한다', async t => {
  const s = await startApp(t);
  const r = await getAs(s, await login(s), '/');
  assert.match(r.text, /POST \/api\/v1\/proposals/);
  assert.doesNotMatch(r.text, /server-import/);
});

test('목록은 스택·세팅 문서와 설정 안내를, 설정은 무시됨·경고를, 탭은 스킬·서브에이전트·MCP 를 보이고, 분류로 거르고, 내용을 이스케이프한다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'rules/demo/02-xss.md': `${reference('<script>alert(1)</script> 할 때')}# x\n` } });
  const r = await getAs(s, cookie, '/');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  for (const s2 of ['base', 'orca', '세팅 문서', '설정에서 확인']) {
    assert.ok(r.text.includes(s2), s2);
  }
  const settings = (await getAs(s, cookie, '/settings')).text;
  for (const s2 of ['무시됨', 'rules/base/오타.md', '경고', 'rules/demo/01-bad.md']) {
    assert.ok(settings.includes(s2), s2);
  }
  for (const [p, names] of [['/skills', ['demo-skill']], ['/agents', ['code-reviewer']], ['/mcp', ['gitlab', 'GITLAB_TOKEN']]]) {
    const page = (await getAs(s, cookie, p)).text;
    for (const n of names) assert.ok(page.includes(n), `${p} ${n}`);
  }
  const demo = (await getAs(s, cookie, '/s/demo/02-xss.md')).text;
  assert.ok(demo.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!demo.includes('<script>alert'));
  assert.ok(!r.text.includes('<script>alert'));
  const filtered = await getAs(s, cookie, `/?cat=${encodeURIComponent('공통')}`);
  assert.ok(filtered.text.includes('<a class="card" href="/s/base">'));
  assert.ok(!filtered.text.includes('<a class="card" href="/s/demo">'));
});

test('파일 보기는 텍스트를 이스케이프해 보이고, 바이너리는 크기와 내려받기를 보인다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'skills/demo-skill/logo.png': Buffer.from([0x89, 0x50, 0x00]), 'rules/base/03-html.md': '<b>굵게</b>\n' } });
  const text = await getAs(s, cookie, '/s/base/03-html.md');
  assert.ok(text.text.includes('&lt;b&gt;굵게&lt;/b&gt;'));
  assert.ok(text.text.includes('/edit/rules/base/03-html.md'));
  const bin = await getAs(s, cookie, '/skills/demo-skill/logo.png');
  assert.match(bin.text, /바이너리 파일 · 3 바이트/);
  assert.ok(!bin.text.includes('/edit/skills/demo-skill/logo.png'));
  const missing = await getAs(s, cookie, '/s/base/nope.md');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['content-type'], 'text/html; charset=utf-8');
  const raw = await getAs(s, cookie, '/raw/skills/demo-skill/logo.png');
  assert.ok(raw.body.equals(Buffer.from([0x89, 0x50, 0x00])));
  assert.equal(raw.headers['content-disposition'], "attachment; filename*=UTF-8''logo.png");
});

test('블록 상세의 오른쪽에는 파일 목록과 올리기 폼(현재 해시 포함)이 있다', async t => {
  const { s, cookie } = await seeded(t);
  const r = await getAs(s, cookie, '/skills/demo-skill');
  assert.ok(r.text.includes('href="/skills/demo-skill/SKILL.md"'));
  assert.ok(r.text.includes('data-upload="skills/demo-skill"'));
  assert.match(r.text, /data-hashes="\{&quot;SKILL\.md&quot;:&quot;[0-9a-f]{64}&quot;\}"/);
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

test('스택 상세는 왼쪽 목록·가운데 README·오른쪽 파일 트리를 보인다', async t => {
  const { s } = await seeded(t);
  const page = (await s.req('/s/base')).text;
  assert.ok(page.includes('class="detail"'));
  assert.ok(page.includes('<aside class="blocks">'));
  assert.ok(page.includes('<aside class="files">'));
  assert.match(page, /<a class="blk on" href="\/s\/base" aria-current="page">/);
  assert.ok(page.includes('href="/s/base/02-git.md"'));
  assert.ok(page.includes('href="/s/base/README.md"'));
  assert.ok(page.includes('href="/archive/rules/base"'));
  assert.match(page, /<h1>/);
});

test('상세에서 파일을 고르면 그 파일을 렌더링하고 트리에서 강조한다', async t => {
  const { s } = await seeded(t);
  const page = (await s.req('/s/base/02-git.md')).text;
  assert.ok(page.includes('<h2>워크트리는 저장소 안에</h2>'));
  assert.match(page, /<a class="on" href="\/s\/base\/02-git\.md"/);
});

test('옛 주소와 전체 내보내기는 404', async t => {
  const { s } = await seeded(t);
  for (const p of ['/f/rules/base/02-git.md', '/d/', '/d/rules', '/export.tar.gz']) assert.equal((await s.req(p)).status, 404, p);
});

test('블록 밖 파일·없는 블록·없는 파일은 404', async t => {
  const { s } = await seeded(t);
  assert.equal((await s.req('/s/nope')).status, 404);
  assert.equal((await s.req('/s/base/nope.md')).status, 404);
  assert.equal((await s.req('/s/base/..%2F..%2Fdocs%2Fauthoring.md')).status, 404);
  assert.equal((await s.req('/skills/no-skill')).status, 404);
});

test('블록 내려받기는 그 블록 파일만 담는다', async t => {
  const { s } = await seeded(t);
  const r = await s.req('/archive/rules/base');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-disposition'], /attachment; filename="base-r1\.tar\.gz"/);
  const dir = tmpDir('guideline-arc-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.tgz'), r.body);
  const list = execFileSync('tar', ['-tzf', path.join(dir, 'a.tgz')], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(list.length > 0);
  assert.ok(list.every(p => p.startsWith('rules/base/')), list.join(','));
  assert.equal((await s.req('/archive/docs')).status, 404);
  assert.equal((await s.req('/archive/rules/nope')).status, 404);
});

test('서브에이전트 상세는 오른쪽 트리가 없다', async t => {
  const { s } = await seeded(t);
  const page = (await s.req('/agents/code-reviewer')).text;
  assert.ok(page.includes('class="detail"'));
  assert.ok(!page.includes('<aside class="files">'));
  assert.ok(page.includes('<div class="doc">'));
});

test('비공개 서버는 블록 상세·내려받기를 로그인으로 보낸다', async t => {
  const s = await startApp(t, { config: testConfig({ publicRead: false }) });
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': '---\nload: always\n---\n# a\n' } });
  for (const p of ['/s/base', '/s/base/00-a.md', '/archive/rules/base', '/agents/x']) {
    const r = await s.req(p);
    assert.equal(r.status, 303, p);
    assert.match(r.headers.location, /^\/login\?next=/);
  }
});
