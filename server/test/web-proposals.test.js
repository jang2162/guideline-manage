import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, META, login, postForm, getAs } from './helpers.js';
import { sha256 } from '../src/store.js';

const h = s => sha256(Buffer.from(s));

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': 'a\nb\nc\n' } });
  const cookie = await login(s);
  const id = s.proposals.create({
    title: '<script>x</script>', author: 'p1', tokenId: null, project: 'my-app',
    changes: [
      { path: 'rules/base/00-a.md', content: Buffer.from('a\nB\nc\n'), base: h('a\nb\nc\n') },
      { path: 'rules/base/01-n.md', content: Buffer.from('n\n'), base: null },
    ],
  });
  return { s, cookie, id };
}

test('목록과 상단 「제안」 에 대기 개수가 보이고 제목은 이스케이프된다', async t => {
  const { s, cookie, id } = await setup(t);
  const r = await getAs(s, cookie, '/proposals');
  assert.equal(r.status, 200);
  assert.match(r.text, /<a[^>]* href="\/proposals"[^>]*>제안 <small>1<\/small><\/a>/);
  assert.match(r.text, new RegExp(`href="/proposals/${id}"`));
  assert.ok(r.text.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(!r.text.includes('<script>x</script>'));
  assert.doesNotMatch((await getAs(s, cookie, '/proposals?status=accepted')).text, new RegExp(`href="/proposals/${id}"`));
});

test('상세는 파일마다 기준 대비 차이를 보이고, 로그인 없으면 로그인으로 보낸다', async t => {
  const { s, cookie, id } = await setup(t);
  assert.equal((await s.req(`/proposals/${id}`)).status, 303);
  const r = await getAs(s, cookie, `/proposals/${id}`);
  assert.match(r.text, /<span class="del">-b<\/span>/);
  assert.match(r.text, /<span class="add">\+B<\/span>/);
  assert.match(r.text, /rules\/base\/01-n\.md/);
  assert.match(r.text, /<button>수락<\/button>/);
});

test('수락하면 리비전이 생기고, 원본이 같은 곳을 바꿨으면 수락 버튼이 막히고 충돌이 보인다', async t => {
  const { s, cookie, id } = await setup(t);
  const id2 = s.proposals.create({ title: 'b', author: 'p1', tokenId: null, changes: [{ path: 'rules/base/00-a.md', content: Buffer.from('a\nT\nc\n'), base: h('a\nb\nc\n') }] });
  const ok = await postForm(s, `/proposals/${id}/accept`, {}, { cookie });
  assert.equal(ok.status, 303);
  assert.equal(s.proposals.get(id).status, 'accepted');
  assert.equal(s.store.fileAt('rules/base/00-a.md', s.store.headRevision()).toString(), 'a\nB\nc\n');
  const r = await getAs(s, cookie, `/proposals/${id2}`);
  assert.match(r.text, /<button disabled>수락<\/button>/);
  assert.match(r.text, /원본과 제안이 같은 곳을 고침/);
  assert.equal((await postForm(s, `/proposals/${id2}/accept`, {}, { cookie })).status, 409);
});

test('고치기는 충돌 표지가 든 내용을 편집기에 넣고, 저장하면 기준이 지금 원본으로 바뀐다', async t => {
  const { s, cookie } = await setup(t);
  const id2 = s.proposals.create({ title: 'b', author: 'p1', tokenId: null, changes: [{ path: 'rules/base/00-a.md', content: Buffer.from('a\nT\nc\n'), base: h('a\nb\nc\n') }] });
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': 'a\nO\nc\n' } });
  const page = await getAs(s, cookie, `/proposals/${id2}/edit?path=${encodeURIComponent('rules/base/00-a.md')}`);
  assert.match(page.text, /&lt;&lt;&lt;&lt;&lt;&lt;&lt; 원본/);
  const saved = await postForm(s, `/proposals/${id2}/edit`, { path: 'rules/base/00-a.md', content: 'a\r\nOT\r\nc\r\n' }, { cookie });
  assert.equal(saved.status, 303);
  const c = s.proposals.get(id2).changes[0];
  assert.equal(c.content.toString(), 'a\nOT\nc\n');
  assert.equal(c.base, h('a\nO\nc\n'));
  assert.equal((await postForm(s, `/proposals/${id2}/accept`, {}, { cookie })).status, 303);
});

test('거절·파일 빼기, 그리고 다른 출처의 요청은 403', async t => {
  const { s, cookie, id } = await setup(t);
  assert.equal((await postForm(s, `/proposals/${id}/reject`, { note: 'x' }, { cookie, origin: 'http://evil.test' })).status, 403);
  assert.equal((await postForm(s, `/proposals/${id}/drop`, { path: 'rules/base/01-n.md' }, { cookie })).status, 303);
  assert.equal(s.proposals.get(id).changes.length, 1);
  assert.equal((await postForm(s, `/proposals/${id}/reject`, { note: '안 맞음' }, { cookie })).status, 303);
  assert.equal(s.proposals.get(id).status, 'rejected');
  assert.match((await getAs(s, cookie, `/proposals/${id}`)).text, /안 맞음/);
});

test('제안 내용이 그 파일의 옛 버전과 같으면 되돌림 경고를 보인다', async t => {
  const { s, cookie } = await setup(t);
  const old = s.store.headRevision();
  s.store.commit({ ...META, changes: { 'rules/base/00-a.md': 'a\nX\nc\n' } });
  const id = s.proposals.create({ title: '되돌림', author: 'p1', tokenId: null, changes: [{ path: 'rules/base/00-a.md', content: Buffer.from('a\nb\nc\n'), base: h('a\nX\nc\n') }] });
  assert.match((await getAs(s, cookie, `/proposals/${id}`)).text, new RegExp(`r${old} 의 옛 버전과 같음`));
  assert.doesNotMatch((await getAs(s, cookie, `/proposals/${id - 1}`)).text, /옛 버전과 같다/);
});
