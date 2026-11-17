import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { startApp, login, getAs, META } from './helpers.js';

const FILES = {
  'rules/base/README.md': '# base\n',
  'rules/base/00-a.md': '---\nload: always\n---\n# a\n',
  'rules/base/01-b.md': '---\nload: reference\nwhen: "b 할 때"\n---\n# b\n',
  'rules/한글/00-a.md': '---\nload: always\n---\n# a\n',
  'skills/x/SKILL.md': '---\nname: x\ndescription: 스킬\n---\n# x\n',
  'skills/x/scripts/sync.sh': 'echo\n',
  'agents/w.md': '---\nname: w\ndescription: 작업\n---\n# w\n',
};

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: FILES });
  return { s, cookie: await login(s) };
}

const panel = page => page.slice(page.indexOf('<aside class="files">'), page.indexOf('</aside>', page.indexOf('<aside class="files">')));

test('하위 폴더는 접히는 트리로, 평평한 경로 글자는 없다', async t => {
  const { s } = await setup(t);
  const right = panel((await s.req('/skills/x')).text);
  assert.match(right, /<details[^>]*><summary>scripts<\/summary>[\s\S]*href="\/skills\/x\/scripts\/sync\.sh"[^>]*>[\s\S]*sync\.sh/);
  assert.ok(!right.includes('scripts/sync.sh</span>'));
  const open = panel((await s.req('/skills/x/scripts/sync.sh')).text);
  assert.match(open, /<details open><summary>scripts<\/summary>/);
});

test('지침 파일 옆에는 점 하나, 배지 글자는 없고 범례가 있다. 파일 이름은 title 로 전체를 둔다', async t => {
  const { s } = await setup(t);
  const right = panel((await s.req('/s/base')).text);
  assert.match(right, /<span class="dot a"[^>]*><\/span><span class="nm">00-a\.md<\/span>/);
  assert.match(right, /<span class="dot r"[^>]*><\/span><span class="nm">01-b\.md<\/span>/);
  assert.ok(!/>always<|>reference</.test(right));
  assert.ok(right.includes('● 상시 ○ 참조'));
  assert.ok(right.includes('title="00-a.md"'));
});

test('트리 아래에는 관리자에게만 설정 버튼 하나, 관리 도구는 없다', async t => {
  const { s, cookie } = await setup(t);
  const admin = panel((await getAs(s, cookie, '/s/base')).text);
  assert.ok(admin.includes('href="/settings/stack/base"'));
  assert.ok(!admin.includes('data-upload'));
  assert.ok(!admin.includes('action="/rename"'));
  assert.ok(!admin.includes('/new?dir='));
  assert.ok(!panel((await s.req('/s/base')).text).includes('/settings/stack/base'));
});

test('서브에이전트 설정 버튼은 위쪽 버튼 줄에, 블록 내려받기는 누구나 위쪽 버튼 줄에서', async t => {
  const { s, cookie } = await setup(t);
  const agent = (await getAs(s, cookie, '/agents/w')).text;
  assert.match(agent, /<div class="actions">[\s\S]*href="\/settings\/agent\/w"/);
  const page = (await s.req('/s/base')).text;
  const actions = page.slice(page.indexOf('<div class="actions">'), page.indexOf('</div>', page.indexOf('<div class="actions">')));
  assert.ok(actions.includes('href="/archive/rules/base"'));
  assert.ok(actions.includes('블록 내려받기(.tar.gz)'));
  assert.ok(!panel(page).includes('/archive/'));
});

test('블록 내려받기: 빈 조각 경로는 404, 한글 이름은 filename*', async t => {
  const { s } = await setup(t);
  assert.equal((await s.req('/archive/rules//base')).status, 404);
  const r = await s.req(`/archive/rules/${encodeURIComponent('한글')}`);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-disposition'], /filename\*=UTF-8''%ED%95%9C%EA%B8%80-r1\.tar\.gz/);
});

test('하위 스택의 설정 버튼과 내려받기는 경로 주소, 내려받기에 자손 파일은 없다', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: {
    'rules/base/00-a.md': '---\nload: always\n---\n# a\n',
    'rules/base/neo/00-x.md': '---\nload: always\n---\n# x\n',
  } });
  const cookie = await login(s);
  const page = (await getAs(s, cookie, '/s/base/neo')).text;
  assert.ok(page.includes('href="/settings/stack/base/neo"'), page);
  assert.ok(page.includes('href="/archive/rules/base/neo"'));
  const parent = await s.req('/archive/rules/base');
  assert.equal(parent.status, 200);
  assert.match(parent.headers['content-disposition'], /filename\*=UTF-8''base-r\d+\.tar\.gz/);
  const names = zlib.gunzipSync(parent.body).toString('latin1');
  assert.ok(names.includes('rules/base/00-a.md'));
  assert.ok(!names.includes('rules/base/neo/00-x.md'));
  const child = await s.req('/archive/rules/base/neo');
  assert.equal(child.status, 200);
  assert.match(child.headers['content-disposition'], /filename\*=UTF-8''base-neo-r\d+\.tar\.gz/);
});

test('README 없는 부모 스택도 첫 화면에 하위 스택 목록과 추가 링크가 있다', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: {
    'rules/base/00-a.md': '---\nload: always\n---\n# a\n',
    'rules/base/neo/00-x.md': '---\nload: always\n---\n# x\n',
  } });
  const cookie = await login(s);
  const page = (await getAs(s, cookie, '/s/base')).text;
  assert.ok(page.includes('class="children"'), page);
  const kids = page.slice(page.indexOf('class="children"'));
  assert.ok(kids.includes('href="/s/base/neo"'));
  assert.ok(kids.includes('href="/add?kind=stack&amp;parent=base"'));
  // 파일을 고른 화면에는 붙이지 않는다.
  assert.ok(!(await getAs(s, cookie, '/s/base/00-a.md')).text.includes('class="children"'));
});
