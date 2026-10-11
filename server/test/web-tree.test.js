import { test } from 'node:test';
import assert from 'node:assert/strict';
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
