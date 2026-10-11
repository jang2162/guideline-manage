import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, login, getAs, postForm, testConfig, META } from './helpers.js';

const FILES = {
  'rules/base/00-a.md': '---\nload: always\n---\n# a\n',
  'docs/authoring.md': '# 작성 규칙\n\n[base](../rules/base/00-a.md) · [밖](../agents/README.md)\n',
  'docs/management.md': '# 관리 지침 추가분\n',
  'docs/deploy-notes.md': '# 배포 절차 정리\n\n본문\n',
  'docs/untitled.md': '제목 없음\n',
};

async function setup(t, config) {
  const s = await startApp(t, config ? { config } : undefined);
  s.store.commit({ ...META, changes: FILES });
  return { s, cookie: await login(s) };
}

test('문서 화면은 일반 문서를 먼저, 에이전트도 읽는 문서를 아래에 묶고, 첫 문서를 가운데에 보인다', async t => {
  const { s } = await setup(t);
  const r = await s.req('/docs');
  assert.equal(r.status, 200);
  const page = r.text;
  const at = x => page.indexOf(x);
  assert.ok(at('배포 절차 정리') !== -1 && at('docs/deploy-notes.md') !== -1);
  assert.ok(page.includes('untitled.md'), '제목 없으면 파일 이름');
  assert.ok(at('href="/docs/deploy-notes.md"') < at('에이전트도 읽는 문서'));
  assert.ok(at('에이전트도 읽는 문서') < at('href="/docs/authoring.md"'));
  assert.ok(page.includes('본문'), '첫 문서를 가운데에');
  assert.ok(at('href="/docs"') < at('href="/"'), '문서 탭이 스택 탭보다 앞');
  assert.match(page, /<a class="tab on" href="\/docs" aria-current="page">/);
});

test('문서 안 링크: 블록 안은 블록 상세, 블록 밖 파일은 링크 없이 글자만', async t => {
  const { s } = await setup(t);
  const page = (await s.req('/docs/authoring.md')).text;
  assert.ok(page.includes('href="/s/base/00-a.md"'));
  assert.ok(!page.includes('agents/README.md"'));
  assert.ok(page.includes('밖'));
});

test('관리자: 문서 추가 링크와 편집·이력·이름 바꾸기·삭제, 보호 문서는 이름 바꾸기·삭제 없음', async t => {
  const { s, cookie } = await setup(t);
  const docs = (await getAs(s, cookie, '/docs/deploy-notes.md')).text;
  assert.ok(docs.includes('href="/new?dir=docs"'));
  for (const bit of ['href="/edit/docs/deploy-notes.md"', 'href="/history/docs/deploy-notes.md"', 'action="/rename"', 'action="/delete/docs/deploy-notes.md"']) assert.ok(docs.includes(bit), bit);
  const auth = (await getAs(s, cookie, '/docs/authoring.md')).text;
  assert.ok(auth.includes('href="/edit/docs/authoring.md"'));
  assert.ok(!auth.includes('action="/rename"'));
  assert.ok(!auth.includes('action="/delete/docs/authoring.md"'));
  assert.equal((await postForm(s, '/delete/docs/authoring.md', { message: 'x' }, { cookie })).status, 400);
  assert.equal((await postForm(s, '/rename', { from: 'docs/management.md', to: 'docs/m.md', message: 'x' }, { cookie })).status, 400);
  assert.ok(s.store.fileAt('docs/authoring.md'));
});

test('웹으로 새 문서를 만들면 문서 화면으로, 지우면 문서 목록으로', async t => {
  const { s, cookie } = await setup(t);
  const r = await postForm(s, '/new', { path: 'docs/onboarding.md', content: '# 신규 입사자 안내\n', message: '새 문서' }, { cookie });
  assert.equal(r.headers.location, '/docs/onboarding.md');
  const d = await postForm(s, '/delete/docs/onboarding.md', { message: '지움' }, { cookie });
  assert.equal(d.headers.location, '/docs');
});

test('설정 화면은 없어지고, 홈에 경고 줄과 상단 설정 링크가 없다', async t => {
  const { s, cookie } = await setup(t);
  assert.equal((await s.req('/settings')).status, 404);
  assert.equal((await getAs(s, cookie, '/settings/docs/authoring.md')).status, 404);
  const home = (await s.req('/')).text;
  assert.ok(!home.includes('href="/settings"'));
});

test('비공개면 문서 화면도 로그인으로, 없는 문서는 404', async t => {
  const { s } = await setup(t, testConfig({ publicRead: false }));
  assert.equal((await s.req('/docs')).status, 303);
  const open = await setup(t);
  assert.equal((await open.s.req('/docs/nope.md')).status, 404);
});
