import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRichDocsRepo, filesOf } from '../../cli/test/helpers.js';
import { startApp, login, getAs, META } from './helpers.js';

async function seeded(t) {
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: filesOf(root) });
  return { s, cookie: await login(s) };
}

const tab = (label, count, href, on = false) => new RegExp(
  `<a class="tab${on ? ' on' : ''}" href="${href}"${on ? ' aria-current="page"' : ''}>${label} <small>${count}</small></a>`,
);

test('틀: 탭 넷에 개수를 보이고 지금 탭을 켠다', async t => {
  const { s, cookie } = await seeded(t);
  const home = (await getAs(s, cookie, '/')).text;
  assert.match(home, tab('스택', 3, '/', true));
  assert.match(home, tab('스킬', 2, '/skills'));
  assert.match(home, tab('서브에이전트', 1, '/agents'));
  assert.match(home, tab('MCP', 5, '/mcp'));
  for (const util of ['href="/history"', 'href="/tokens"', 'href="/export.tar.gz"', 'action="/logout"']) assert.ok(home.includes(util), util);
  const skill = (await getAs(s, cookie, '/f/skills/demo-skill/SKILL.md')).text;
  assert.match(skill, tab('스킬', 2, '/skills', true));
  assert.match(skill, tab('스택', 3, '/'));
  assert.match((await getAs(s, cookie, '/d/mcp/gitlab')).text, tab('MCP', 5, '/mcp', true));
  assert.match((await getAs(s, cookie, '/f/agents/code-reviewer.md')).text, tab('서브에이전트', 1, '/agents', true));
});

test('틀: 탭 개수는 새 리비전을 따라간다', async t => {
  const { s, cookie } = await seeded(t);
  assert.match((await getAs(s, cookie, '/')).text, tab('스택', 3, '/', true));
  s.store.commit({ ...META, changes: { 'rules/new/00-x.md': '---\nload: always\n---\n\n# x\n' } });
  assert.match((await getAs(s, cookie, '/')).text, tab('스택', 4, '/', true));
});

test('틀: 사이드바는 고른 탭의 목록과 찾기 칸, 지금 스택을 펼쳐 지금 파일을 강조한다', async t => {
  const { s, cookie } = await seeded(t);
  const r = (await getAs(s, cookie, '/f/rules/base/02-git.md')).text;
  assert.match(r, /<details class="side" open><summary>목록<\/summary>/);
  assert.match(r, /<input type="search" class="side-search"[^>]*data-side-search/);
  assert.match(r, /<a class="it on" href="\/s\/base" title="base"><span class="nm">base<\/span> <span>3<\/span><\/a>/);
  assert.match(r, /<a class="it" href="\/s\/demo" title="demo"><span class="nm">demo<\/span> <span>2<\/span><\/a>/);
  assert.match(r, /<a class="f on" href="\/f\/rules\/base\/02-git\.md" aria-current="page">02-git\.md<\/a>/);
  assert.match(r, /<a class="f" href="\/f\/rules\/base\/00-alpha\.md">00-alpha\.md<\/a>/);
  // 다른 스택의 파일은 찾기 때만 보이게 숨겨 둔다
  assert.match(r, /<ul class="files" hidden>\s*<li><a class="f" href="\/f\/rules\/demo\/00-rules\.md">/);
  assert.ok(!r.includes('href="/d/skills/demo-skill"'));
  const skills = (await getAs(s, cookie, '/skills')).text;
  assert.match(skills, /<a class="it" href="\/d\/skills\/demo-skill" title="demo-skill"><span class="nm">demo-skill/);
  assert.ok(!skills.includes('href="/s/base"'));
});

test('틀: 이력·리비전·토큰 화면에는 사이드바가 없고 켜진 탭도 없다', async t => {
  const { s, cookie } = await seeded(t);
  for (const p of ['/history', '/history/rules/base/02-git.md', '/r/1', '/tokens']) {
    const r = (await getAs(s, cookie, p)).text;
    assert.ok(!r.includes('class="side"'), p);
    assert.ok(!r.includes('class="tab on"'), p);
    assert.match(r, tab('스택', 3, '/'), p);
  }
  assert.match((await getAs(s, cookie, '/history')).text, /<a class="on" href="\/history" aria-current="page">이력<\/a>/);
  assert.match((await getAs(s, cookie, '/tokens')).text, /<a class="on" href="\/tokens" aria-current="page">토큰<\/a>/);
  const edit = (await getAs(s, cookie, '/edit/rules/base/02-git.md')).text;
  assert.ok(edit.includes('class="side"'));
});

test('로그인·오류 화면은 틀 없이 그린다', async t => {
  const { s, cookie } = await seeded(t);
  const loginPage = (await s.req('/login')).text;
  assert.ok(!loginPage.includes('class="top"'));
  const missing = await getAs(s, cookie, '/f/rules/nope.md');
  assert.equal(missing.status, 404);
  assert.ok(!missing.text.includes('class="top"'));
});

test('홈은 숫자 요약, 분류 칩, 스택 카드(첫 문장·파일 수·칸 수·분류·세팅 문서·경고)를 보인다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'rules/demo/README.md': '---\ncategories: [데모]\n---\n\n# demo\n\n<script>alert(1)</script> 데모 스택이다. 둘째 문장.\n' } });
  const r = (await getAs(s, cookie, '/')).text;
  assert.match(r, /<b>3<\/b> 스택/);
  assert.match(r, /<b>6<\/b> 지침 파일/);
  assert.match(r, /<b>2<\/b> 스킬/);
  assert.match(r, /<b>5<\/b> MCP/);
  assert.match(r, /최신 <a href="\/r\/2">r2<\/a>/);
  const card = name => {
    const m = new RegExp(`<a class="card" href="/s/${name}">([\\s\\S]*?)</a>`).exec(r);
    assert.ok(m, name);
    return m[1];
  };
  assert.match(card('base'), /3개/);
  assert.match(card('base'), /always 2/);
  assert.match(card('base'), /reference 1/);
  assert.match(card('base'), /<span class="tag">공통<\/span>/);
  assert.match(card('base'), /세팅 문서/);
  assert.match(card('demo'), /<p class="card-d">&lt;script&gt;alert\(1\)&lt;\/script&gt; 데모 스택이다\.<\/p>/);
  assert.match(card('demo'), /경고 1/);
  assert.match(card('orca'), /경고 1/);
  assert.ok(!r.includes('<script>alert'));
  assert.match(r, /<a class="chip on" href="\/">전체<\/a>/);
  const filtered = (await getAs(s, cookie, `/?cat=${encodeURIComponent('공통')}`)).text;
  assert.ok(filtered.includes('<a class="card" href="/s/base">'));
  assert.ok(!filtered.includes('<a class="card" href="/s/demo">'));
  assert.match(filtered, /<a class="chip on" href="\/\?cat=%EA%B3%B5%ED%86%B5">공통<\/a>/);
});

test('스택 화면은 README 를 렌더링하고, 파일 이름만 보이는 표·세팅 문서·바꿈 표를 보인다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'rules/base/03-xss.md': '---\nload: reference\nwhen: "<script>alert(1)</script> 할 때"\n---\n\n# x\n' } });
  const base = await getAs(s, cookie, '/s/base');
  assert.equal(base.status, 200);
  assert.match(base.text, /<div class="doc">\s*<h1>base<\/h1>/);
  assert.match(base.text, /<a href="\/f\/rules\/base\/00-alpha\.md">00-alpha\.md<\/a>/);
  assert.ok(!base.text.includes('>rules/base/00-alpha.md<'));
  assert.match(base.text, /<span class="k">always<\/span>/);
  assert.match(base.text, /<span class="k ref">reference<\/span>/);
  assert.ok(base.text.includes('베타 작업을 할 때'));
  assert.ok(base.text.includes('&lt;script&gt;alert(1)&lt;/script&gt; 할 때'));
  assert.ok(!base.text.includes('<script>alert'));
  assert.ok(base.text.includes('href="/f/rules/base/SETUP.md"'));
  assert.ok(!base.text.includes('<th>분류</th>'), '파일 분류가 없는 스택은 분류 칸을 두지 않는다');
  const orca = (await getAs(s, cookie, '/s/orca')).text;
  assert.ok(orca.includes('<th>분류</th>'));
  assert.match(orca, /<td><span class="tag">orca<\/span><\/td>/);
  assert.ok(orca.includes('바꾸는 절'));
  assert.ok(orca.includes('워크트리는 저장소 안에'));
  assert.ok(orca.includes('href="/f/rules/base/02-git.md"'));
  assert.equal((await getAs(s, cookie, '/s/nope')).status, 404);
  assert.equal((await getAs(s, cookie, '/s/empty')).status, 404);
  const anon = await s.req('/s/base');
  assert.equal(anon.status, 200, '보기는 로그인 없이 된다');
  assert.ok(!anon.text.includes('href="/edit/'));
  assert.ok(!anon.text.includes('/new?dir='));
});

test('스킬·서브에이전트·MCP 탭은 카드 목록을 보이고 디렉터리·파일 화면으로 보낸다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'agents/xss.md': '---\nname: xss\ndescription: "<img src=x onerror=alert(1)>"\n---\n' } });
  const skills = (await getAs(s, cookie, '/skills')).text;
  assert.match(skills, /<a class="card" href="\/d\/skills\/demo-skill">/);
  assert.ok(skills.includes('데모'));
  assert.match(skills, /<a class="card" href="\/d\/skills\/cat-skill">/);
  const agents = (await getAs(s, cookie, '/agents')).text;
  assert.match(agents, /<a class="card" href="\/f\/agents\/code-reviewer\.md">/);
  assert.ok(agents.includes('검토'));
  assert.ok(agents.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!agents.includes('<img'));
  const mcp = (await getAs(s, cookie, '/mcp')).text;
  assert.match(mcp, /<a class="card" href="\/d\/mcp\/gitlab">/);
  assert.ok(mcp.includes('GITLAB_TOKEN'));
  assert.ok(mcp.includes('반영할 때 README 로 만듦'));
  const anon = await s.req('/skills');
  assert.equal(anon.status, 200);
  assert.ok(!anon.text.includes('/new?dir='));
});

test('파일 보기: .md 는 렌더링하고 frontmatter 는 칩으로, ?raw=1 이면 원문, 빵부스러기와 버튼', async t => {
  const { s, cookie } = await seeded(t);
  const r = (await getAs(s, cookie, '/f/rules/base/01-beta.md')).text;
  assert.match(r, /<nav class="crumbs"><a href="\/">스택<\/a> › <a href="\/s\/base">base<\/a><\/nav>/);
  assert.match(r, /<h1>01-beta\.md<\/h1>/);
  assert.match(r, /<div class="doc">\s*<h1>beta<\/h1>\s*<p>B1<\/p>/);
  assert.match(r, /<span class="pill k ref">reference<\/span>/);
  assert.match(r, /<span class="pill"><b>when<\/b> 베타 작업을 할 때<\/span>/);
  assert.ok(!r.includes('load: reference'));
  assert.ok(r.includes('href="/f/rules/base/01-beta.md?raw=1"'));
  assert.ok(r.includes('href="/edit/rules/base/01-beta.md"'));
  assert.ok(r.includes('href="/history/rules/base/01-beta.md"'));
  assert.ok(r.includes('href="/raw/rules/base/01-beta.md"'));
  const raw = (await getAs(s, cookie, '/f/rules/base/01-beta.md?raw=1')).text;
  assert.match(raw, /<pre class="file">---\nload: reference\nwhen: &quot;베타 작업을 할 때&quot;\n---/);
  assert.ok(!raw.includes('<div class="doc">'));
  assert.ok(raw.includes('href="/f/rules/base/01-beta.md"'));
  const json = (await getAs(s, cookie, '/f/mcp/gitlab/server.json')).text;
  assert.match(json, /<pre class="file">\{/);
  assert.match(json, /<nav class="crumbs"><a href="\/mcp">MCP<\/a> › <a href="\/d\/mcp\/gitlab">gitlab<\/a><\/nav>/);
});

test('파일 보기: 마크다운 안의 HTML·위험한 링크는 글자로, 상대 링크는 서버 주소로', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({
    ...META,
    changes: { 'rules/base/03-x.md': '---\nload: always\n---\n\n# x\n\n<script>alert(1)</script> [옆](02-git.md) [나쁨](javascript:alert(1)) [밖](../../../etc/passwd)\n' },
  });
  const r = (await getAs(s, cookie, '/f/rules/base/03-x.md')).text;
  assert.ok(r.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!r.includes('<script>alert'));
  assert.ok(r.includes('<a href="/f/rules/base/02-git.md">옆</a>'));
  assert.ok(r.includes('[나쁨](javascript:alert(1))'));
  assert.ok(!r.includes('href="javascript'));
  assert.ok(r.includes('[밖](../../../etc/passwd)'));
});

test('정적 파일: 사이드바 찾기와 / 키, 휴대폰 폭에서 목록 접기', async t => {
  const s = await startApp(t);
  const js = (await s.req('/static/app.js')).text;
  assert.match(js, /data-side-search/);
  assert.match(js, /event\.key === '\/'/);
  assert.match(js, /max-width: 760px/);
  const css = (await s.req('/static/app.css')).text;
  assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-color-scheme: dark/);
});
