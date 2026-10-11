import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, postForm, login, getAs, ADMIN, META } from './helpers.js';

/** r1: a=<b>a1</b>, b=b1 / r2: a=a2, png / r3: b 삭제 */
async function seeded(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', message: '가져옴', changes: { 'rules/x/00-a.md': '<b>a1</b>\n', 'rules/x/01-b.md': 'b1\n' } });
  s.store.commit({ ...META, message: '둘째', changes: { 'rules/x/00-a.md': 'a2\n', 'skills/s/logo.png': Buffer.from([1, 2, 3]) } });
  s.store.commit({ ...META, message: '셋째', changes: { 'rules/x/01-b.md': null } });
  return { s, cookie: await login(s) };
}

const rowsOf = page => (page.match(/<tr><td><a href="\/r\/\d+">/g) ?? []).length;

test('이력은 최신순으로 30개씩, 아래에 이전·다음', async t => {
  const s = await startApp(t);
  for (let i = 0; i < 65; i++) s.store.commit({ ...META, message: `m${i}`, changes: { 'rules/x/00-a.md': `v${i}` } });
  const cookie = await login(s);
  const first = (await getAs(s, cookie, '/history')).text;
  assert.equal(rowsOf(first), 30);
  assert.ok(first.includes('href="/r/65"') && !first.includes('href="/r/35"'));
  assert.ok(first.includes('href="/history?page=2"'));
  assert.ok(!first.includes('href="/history?page=0"'));
  const third = (await getAs(s, cookie, '/history?page=3')).text;
  assert.equal(rowsOf(third), 5);
  assert.ok(third.includes('href="/history?page=2"'));
  assert.ok(!third.includes('href="/history?page=4"'));
  for (const q of ['?page=0', '?page=-1', '?page=x', '?before=2']) {
    const r = await getAs(s, cookie, `/history${q}`);
    assert.equal(r.status, 200, q);
    assert.ok(r.text.includes('href="/r/65"'), q);
  }
  const far = await getAs(s, cookie, '/history?page=99');
  assert.equal(far.status, 200);
  assert.equal(rowsOf(far.text), 0);
  assert.ok(far.text.includes('href="/history?page=98"'));
});

test('파일 하나의 이력도 30개씩 나누고, 되돌리기 폼은 그 쪽 행만', async t => {
  const s = await startApp(t);
  for (let i = 0; i < 35; i++) s.store.commit({ ...META, message: `m${i}`, changes: { 'rules/x/00-a.md': `v${i}` } });
  const cookie = await login(s);
  const first = (await getAs(s, cookie, '/history/rules/x/00-a.md')).text;
  assert.equal(rowsOf(first), 30);
  assert.ok(first.includes('href="/history/rules/x/00-a.md?page=2"'));
  assert.equal((first.match(/name="rev" value="\d+"/g) ?? []).length, 30);
  assert.equal(rowsOf((await getAs(s, cookie, '/history/rules/x/00-a.md?page=2')).text), 5);
});

test('파일 이력은 그 파일의 리비전과 삭제를 보인다', async t => {
  const { s, cookie } = await seeded(t);
  const r = await getAs(s, cookie, '/history/rules/x/01-b.md');
  assert.ok(r.text.includes('href="/r/3"'));
  assert.ok(r.text.includes('href="/r/1"'));
  assert.ok(!r.text.includes('href="/r/2"'));
  assert.ok(r.text.includes('삭제'));
});

test('리비전 화면은 고른 파일의 이스케이프한 줄 차이를, 바이너리는 크기를 보인다', async t => {
  const { s, cookie } = await seeded(t);
  const r = await getAs(s, cookie, '/r/2');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('<span class="del">-&lt;b&gt;a1&lt;/b&gt;</span>'));
  assert.ok(r.text.includes('<span class="add">+a2</span>'));
  const bin = await getAs(s, cookie, '/r/2?file=skills%2Fs%2Flogo.png');
  assert.ok(bin.text.includes('바이너리 · 없음 → 3 바이트'));
  assert.ok(r.text.includes('둘째'));
  assert.equal((await getAs(s, cookie, '/r/9')).status, 404);
  assert.equal((await getAs(s, cookie, '/r/abc')).status, 404);
});

test('파일 되돌리기는 확인 화면을 거쳐 새 리비전을 만든다', async t => {
  const { s, cookie } = await seeded(t);
  const confirm = await postForm(s, '/revert', { kind: 'file', path: 'rules/x/00-a.md', rev: '1' }, { cookie });
  assert.equal(confirm.status, 200);
  assert.ok(confirm.text.includes('name="confirmed" value="1"'));
  assert.ok(confirm.text.includes('<span class="add">+&lt;b&gt;a1&lt;/b&gt;</span>'));
  assert.equal(s.store.headRevision(), 3);
  const done = await postForm(s, '/revert', { kind: 'file', path: 'rules/x/00-a.md', rev: '1', confirmed: '1', message: '' }, { cookie });
  assert.equal(done.status, 303);
  assert.equal(done.headers.location, '/r/4');
  assert.equal(s.store.fileAt('rules/x/00-a.md').toString(), '<b>a1</b>\n');
  assert.equal(s.store.revision(4).message, '되돌리기: rules/x/00-a.md → r1');
  const same = await postForm(s, '/revert', { kind: 'file', path: 'rules/x/00-a.md', rev: '1', confirmed: '1' }, { cookie });
  assert.ok(same.text.includes('변경 없음'));
});

test('리비전 되돌리기는 뒤에 또 바뀐 파일을 알리고, 확인하면 되돌린다', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'rules/x/00-a.md': 'a3\n' } });
  const confirm = await postForm(s, '/revert', { kind: 'revision', rev: '2' }, { cookie });
  assert.ok(confirm.text.includes('이 리비전 뒤에 또 바뀐 파일'));
  assert.ok(confirm.text.includes('rules/x/00-a.md'));
  const done = await postForm(s, '/revert', { kind: 'revision', rev: '2', confirmed: '1', message: '둘째 취소' }, { cookie });
  assert.equal(done.headers.location, '/r/5');
  assert.equal(s.store.fileAt('rules/x/00-a.md').toString(), '<b>a1</b>\n');
  assert.equal(s.store.fileAt('skills/s/logo.png'), null);
  assert.equal((await postForm(s, '/revert', { kind: 'revision', rev: '99' }, { cookie })).status, 404);
  assert.equal((await postForm(s, '/revert', { kind: 'other', rev: '2' }, { cookie })).status, 400);
});

test('토큰은 발급 직후 한 번만 보이고, API 에 쓰이고, 폐기하면 막힌다', async t => {
  const s = await startApp(t);
  const cookie = await login(s);
  const issued = await postForm(s, '/tokens', { name: 'jang-macbook', scope: 'read' }, { cookie });
  assert.equal(issued.status, 200);
  const token = /glt_[A-Za-z0-9_-]{43}/.exec(issued.text)[0];
  assert.ok(issued.text.includes('다시 볼 수 없음'));
  const list = await getAs(s, cookie, '/tokens');
  assert.ok(list.text.includes('jang-macbook'));
  assert.ok(!list.text.includes(token));
  assert.equal((await s.req('/api/v1/catalog', { auth: token })).status, 200);
  const id = s.tokens.list()[0].id;
  const revoked = await postForm(s, `/tokens/${id}/revoke`, {}, { cookie });
  assert.equal(revoked.status, 303);
  assert.equal(revoked.headers.location, '/tokens');
  assert.equal((await s.req('/api/v1/catalog', { auth: token })).status, 401, '공개 서버여도 폐기한 토큰은 401');
  assert.ok((await getAs(s, cookie, '/tokens')).text.includes('폐기'));
  const dup = await postForm(s, '/tokens', { name: 'jang-macbook', scope: 'read' }, { cookie });
  assert.equal(dup.status, 400);
  assert.ok(dup.text.includes('이미 있는 이름: jang-macbook'));
  assert.equal((await postForm(s, '/tokens', { name: 'x', scope: 'read' }, { cookie, origin: 'http://evil.test' })).status, 403);
  assert.ok(!(await getAs(s, cookie, '/tokens')).text.includes(ADMIN));
});

test('리비전 상세는 왼쪽에 바뀐 파일 트리, 가운데에 고른 파일 하나의 diff', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/base/README.md': '---\nlabel: 기본 규칙\n---\n# b\n', 'rules/base/00-a.md': '---\nload: always\n---\n# a\n' } });
  s.store.commit({
    ...META, message: '여럿',
    changes: { 'rules/base/00-a.md': '---\nload: always\n---\n# a\nAAA\n', 'skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\nSSS\n', 'rules/한글/01-a.md': 'KKK\n', 'rules/base/02-long.md': `${Array.from({ length: 200 }, (_, i) => `L${i}`).join('\n')}\n` },
  });
  const cookie = await login(s);
  const first = (await getAs(s, cookie, '/r/2')).text;
  assert.ok(first.includes('href="/r/2?file=skills%2Fs%2FSKILL.md"'));
  assert.ok(first.includes('href="/r/2?file=rules%2F%ED%95%9C%EA%B8%80%2F01-a.md"'));
  assert.ok(first.includes('AAA'), '첫 파일(스택 base 의 00-a.md)');
  assert.ok(!first.includes('SSS') && !first.includes('KKK'), '다른 파일 내용은 없다');
  assert.ok(first.includes('기본 규칙'), '위치 표시·트리에 표시 이름');
  assert.match(first, /파일 4개/);
  const skill = (await getAs(s, cookie, '/r/2?file=skills%2Fs%2FSKILL.md')).text;
  assert.ok(skill.includes('SSS') && !skill.includes('AAA'));
  assert.ok((await getAs(s, cookie, '/r/2?file=nope')).text.includes('AAA'), '없는 경로는 첫 파일');
  assert.ok((await getAs(s, cookie, `/r/2?file=${encodeURIComponent('rules/한글/01-a.md')}`)).text.includes('KKK'));
  const long = (await getAs(s, cookie, '/r/2?file=rules%2Fbase%2F02-long.md')).text;
  assert.match(long, /나머지 \d+줄 보기/);
});

test('지운 블록의 변경도 트리에 나온다', async t => {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: { 'rules/gone/00-a.md': 'x\n', 'rules/keep/00-a.md': 'k\n' } });
  s.store.commit({ ...META, message: '지움', changes: { 'rules/gone/00-a.md': null } });
  const page = (await s.req('/r/2')).text;
  assert.ok(page.includes('gone'));
  assert.ok(page.includes('href="/r/2?file=rules%2Fgone%2F00-a.md"'));
});
