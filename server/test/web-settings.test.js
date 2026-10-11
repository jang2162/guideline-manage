import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, login, getAs, postForm, testConfig, META } from './helpers.js';

const FILES = {
  'rules/base/00-a.md': '---\nload: always\n---\n# a\n',
  'rules/demo/01-bad.md': '---\nload: sometimes\n---\n# bad\n',
  'rules/skeleton/README.md': '# 뼈대\n',
  'skills/no-skill/README.md': '없음\n',
  'agents/README.md': '# 서브에이전트\n',
  'docs/authoring.md': '# 작성 규칙\n\n[base](../rules/base/00-a.md)\n',
};

async function setup(t, config) {
  const s = await startApp(t, config ? { config } : undefined);
  s.store.commit({ ...META, changes: FILES });
  return s;
}

test('설정은 작성 규칙을 먼저 보이고, 블록 밖 파일·무시됨·경고를 오른쪽에 둔다', async t => {
  const s = await setup(t);
  const page = (await s.req('/settings')).text;
  assert.ok(page.includes('<h1>작성 규칙</h1>'));
  for (const href of ['/settings/docs/authoring.md', '/settings/rules/skeleton/README.md', '/settings/skills/no-skill/README.md', '/settings/agents/README.md']) {
    assert.ok(page.includes(`href="${href}"`), href);
  }
  assert.ok(!page.includes('href="/settings/rules/base/00-a.md"'));
  assert.ok(page.includes('skills/no-skill'));
  assert.ok(page.includes('href="/s/demo/01-bad.md"'), '경고 링크는 블록 상세로');
  assert.ok(page.includes('href="/s/base/00-a.md"'), '문서 안 상대 링크도 블록 상세로');
  assert.match(page, /<a class="on" href="\/settings\/docs\/authoring\.md" aria-current="page">/);
  assert.match(page, /<a class="on" href="\/settings" aria-current="page">설정<\/a>/);
});

test('설정에서 뼈대 스택 README 를 열고, 블록 안 경로·없는 경로는 404', async t => {
  const s = await setup(t);
  const r = await s.req('/settings/rules/skeleton/README.md');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('뼈대'));
  assert.equal((await s.req('/settings/rules/base/00-a.md')).status, 404);
  assert.equal((await s.req('/settings/nope.md')).status, 404);
});

test('관리자만 설정에서 편집을 본다', async t => {
  const s = await setup(t);
  assert.ok(!(await s.req('/settings')).text.includes('href="/edit/'));
  const admin = (await getAs(s, await login(s), '/settings')).text;
  assert.ok(admin.includes('href="/edit/docs/authoring.md"'));
});

test('비공개 서버의 설정은 로그인으로', async t => {
  const s = await setup(t, testConfig({ publicRead: false }));
  const r = await s.req('/settings');
  assert.equal(r.status, 303);
  assert.match(r.headers.location, /^\/login\?next=/);
});

test('설정에서 파일을 지우면 설정으로, 블록 하위 폴더 파일을 지우면 블록 상세로 간다', async t => {
  const s = await setup(t);
  s.store.commit({ ...META, changes: { 'docs/management.md': '# 관리\n', 'skills/x/SKILL.md': '---\nname: x\ndescription: d\n---\n', 'skills/x/scripts/a.sh': 'echo\n' } });
  const cookie = await login(s);
  const del = async p => (await postForm(s, `/delete/${p}`, { message: '지움' }, { cookie })).headers.location;
  assert.equal(await del('docs/management.md'), '/settings');
  assert.equal(await del('skills/x/scripts/a.sh'), '/skills/x');
  assert.equal(await del('rules/base/00-a.md'), '/settings', '마지막 규칙을 지워 뼈대가 된 스택');
});

test('설정 문서의 블록 밖 폴더 링크는 설정으로, 새 파일 버튼은 없다', async t => {
  const s = await setup(t);
  s.store.commit({ ...META, changes: { 'docs/authoring.md': '# 작성 규칙\n\n[규칙들](../rules/) [스킬](../skills/no-skill/)\n' } });
  const admin = (await getAs(s, await login(s), '/settings')).text;
  assert.ok(admin.includes('<a href="/settings">규칙들</a>'));
  assert.ok(admin.includes('<a href="/settings">스킬</a>'));
  assert.ok(!admin.includes('href="/new?dir=docs"'));
});

test('설정의 경고 링크는 폴더 경고면 블록 첫 화면으로 간다', async t => {
  const s = await setup(t);
  s.store.commit({ ...META, changes: { 'rules/deploy__nodomain/00-a.md': '---\nload: always\n---\n# a\n' } });
  const page = (await s.req('/settings')).text;
  assert.ok(page.includes('<a href="/s/deploy__nodomain">rules/deploy__nodomain/</a>'));
});
