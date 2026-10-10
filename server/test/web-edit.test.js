import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, postForm, login, getAs, META } from './helpers.js';
import { sha256 } from '../src/store.js';

const RULE = '---\nload: always\n---\n\n# x\n\n본문\n';

async function seeded(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: {
    'rules/base/00-x.md': RULE,
    'skills/demo/SKILL.md': '---\nname: demo\ndescription: 데모\n---\n',
    'skills/demo/ref.md': 'ref\n',
    'skills/demo/logo.png': Buffer.from([0x89, 0x50]),
  } });
  return { s, cookie: await login(s) };
}

const textOf = (s, p) => s.store.fileAt(p)?.toString('utf8') ?? null;

test('편집 화면은 원문과 base 해시를 담고, 저장하면 CRLF 를 LF 로 맞춰 새 리비전을 만든다', async t => {
  const { s, cookie } = await seeded(t);
  const page = await getAs(s, cookie, '/edit/rules/base/00-x.md');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('본문'));
  assert.ok(page.text.includes(`name="base" value="${sha256(Buffer.from(RULE))}"`));
  const r = await postForm(s, '/edit/rules/base/00-x.md', {
    content: '---\r\nload: always\r\n---\r\n\r\n# x\r\n\r\n고침\r\n', base: sha256(Buffer.from(RULE)), message: '고친다', action: 'save',
  }, { cookie });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/f/rules/base/00-x.md');
  assert.equal(textOf(s, 'rules/base/00-x.md'), '---\nload: always\n---\n\n# x\n\n고침\n');
  assert.deepEqual(s.store.revision(2), { ...s.store.revision(2), author: 'admin', source: 'web', message: '고친다' });
});

test('메시지가 없으면 400 이고 쓴 내용을 그대로 돌려준다', async t => {
  const { s, cookie } = await seeded(t);
  const r = await postForm(s, '/edit/rules/base/00-x.md', { content: '새 내용', base: sha256(Buffer.from(RULE)), message: ' ', action: 'save' }, { cookie });
  assert.equal(r.status, 400);
  assert.ok(r.text.includes('메시지를 쓴다'));
  assert.ok(r.text.includes('새 내용'));
  assert.equal(s.store.headRevision(), 1);
});

test('경고 보기는 저장하지 않고 그 내용으로 생길 목록 경고를 보인다', async t => {
  const { s, cookie } = await seeded(t);
  const r = await postForm(s, '/edit/rules/base/00-x.md', { content: '---\nload: sometimes\n---\n', base: 'x', message: '', action: 'preview' }, { cookie });
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('rules/base/00-x.md'));
  assert.ok(r.text.includes('저장하면 목록에 이런 경고가 남는다'));
  assert.equal(s.store.headRevision(), 1);
  const clean = await postForm(s, '/edit/rules/base/00-x.md', { content: RULE, base: 'x', message: '', action: 'preview' }, { cookie });
  assert.ok(clean.text.includes('경고 없음'));
});

test('열어 둔 사이 다른 저장이 있으면 409 충돌 화면을 보이고, 새 base 로 다시 저장할 수 있다', async t => {
  const { s, cookie } = await seeded(t);
  const oldBase = sha256(Buffer.from(RULE));
  s.store.commit({ ...META, changes: { 'rules/base/00-x.md': `${RULE}다른 사람\n` } });
  const r = await postForm(s, '/edit/rules/base/00-x.md', { content: `${RULE}내 것\n`, base: oldBase, message: '내 것', action: 'save' }, { cookie });
  assert.equal(r.status, 409);
  assert.ok(r.text.includes('열어 둔 사이 다른 저장이 있었다'));
  assert.ok(r.text.includes('<span class="del">-다른 사람</span>'));
  assert.ok(r.text.includes('<span class="add">+내 것</span>'));
  const newBase = sha256(Buffer.from(`${RULE}다른 사람\n`));
  assert.ok(r.text.includes(`name="base" value="${newBase}"`));
  const again = await postForm(s, '/edit/rules/base/00-x.md', { content: `${RULE}내 것\n`, base: newBase, message: '내 것', action: 'save' }, { cookie });
  assert.equal(again.status, 303);
  assert.equal(textOf(s, 'rules/base/00-x.md'), `${RULE}내 것\n`);
});

test('바이너리는 편집할 수 없고, 없는 파일 편집은 404, 다른 출처는 403', async t => {
  const { s, cookie } = await seeded(t);
  assert.equal((await getAs(s, cookie, '/edit/skills/demo/logo.png')).status, 400);
  assert.equal((await getAs(s, cookie, '/edit/rules/base/09-none.md')).status, 404);
  const r = await postForm(s, '/edit/rules/base/00-x.md', { content: 'x', base: 'none', message: 'm', action: 'save' }, { cookie, origin: 'http://evil.test' });
  assert.equal(r.status, 403);
});

test('새 파일은 틀을 채운 화면에서 만들고, 이미 있는 경로와 규칙을 어긴 경로는 거부한다', async t => {
  const { s, cookie } = await seeded(t);
  const page = await getAs(s, cookie, '/new?dir=rules%2Fbase&template=reference');
  assert.ok(page.text.includes('value="rules/base/00-&lt;주제&gt;.md"'));
  assert.ok(page.text.includes('load: reference'));
  const ok = await postForm(s, '/new', { path: 'rules/base/01-new.md', content: RULE, message: '새 규칙', action: 'save' }, { cookie });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.location, '/f/rules/base/01-new.md');
  assert.equal(textOf(s, 'rules/base/01-new.md'), RULE);
  const dup = await postForm(s, '/new', { path: 'rules/base/01-new.md', content: 'x', message: '또', action: 'save' }, { cookie });
  assert.equal(dup.status, 409);
  assert.ok(dup.text.includes('이미 있는 경로다'));
  const bad = await postForm(s, '/new', { path: 'docs/x.md', content: 'x', message: 'm', action: 'save' }, { cookie });
  assert.equal(bad.status, 400);
  assert.ok(bad.text.includes('최상위는 rules/'));
});

test('삭제는 파일 하나나 디렉터리 전체를 한 리비전으로 지운다', async t => {
  const { s, cookie } = await seeded(t);
  assert.equal((await postForm(s, '/delete/skills/demo/ref.md', { message: '' }, { cookie })).status, 400);
  const one = await postForm(s, '/delete/skills/demo/ref.md', { message: '지운다' }, { cookie });
  assert.equal(one.status, 303);
  assert.equal(one.headers.location, '/d/skills/demo');
  assert.equal(textOf(s, 'skills/demo/ref.md'), null);
  const dir = await postForm(s, '/delete/skills/demo', { message: '스킬을 지운다' }, { cookie });
  assert.equal(dir.headers.location, '/d/skills');
  assert.deepEqual(s.store.pathsAt().map(f => f.path), ['rules/base/00-x.md']);
  assert.deepEqual(s.store.changes(3).map(c => c.kind), ['delete', 'delete']);
  assert.equal((await postForm(s, '/delete/skills/nope', { message: 'm' }, { cookie })).status, 404);
});

test('이름 바꾸기는 파일과 디렉터리를 한 리비전으로 옮기고, 자리가 차 있거나 자기 아래면 거부한다', async t => {
  const { s, cookie } = await seeded(t);
  const f = await postForm(s, '/rename', { from: 'rules/base/00-x.md', to: 'rules/base/05-x.md', message: '번호' }, { cookie });
  assert.equal(f.headers.location, '/f/rules/base/05-x.md');
  assert.equal(textOf(s, 'rules/base/05-x.md'), RULE);
  assert.equal(textOf(s, 'rules/base/00-x.md'), null);
  const d = await postForm(s, '/rename', { from: 'skills/demo', to: 'skills/demo2', message: '이름' }, { cookie });
  assert.equal(d.headers.location, '/d/skills/demo2');
  assert.deepEqual(s.store.pathsAt().map(x => x.path), ['rules/base/05-x.md', 'skills/demo2/SKILL.md', 'skills/demo2/logo.png', 'skills/demo2/ref.md']);
  assert.ok(s.store.fileAt('skills/demo2/logo.png').equals(Buffer.from([0x89, 0x50])));
  assert.equal((await postForm(s, '/rename', { from: 'skills/demo2/ref.md', to: 'skills/demo2/SKILL.md', message: 'm' }, { cookie })).status, 409);
  assert.equal((await postForm(s, '/rename', { from: 'skills/demo2', to: 'skills/demo2/x', message: 'm' }, { cookie })).status, 400);
});

test('올리기는 바이트 그대로 저장하고, base 가 틀리거나 크거나 메시지가 없으면 JSON 오류를 낸다', async t => {
  const { s, cookie } = await seeded(t);
  const put = (p, body, headers = {}) => s.req(p, {
    method: 'PUT', body,
    headers: { Cookie: cookie, Origin: s.config.publicUrl.origin, 'Content-Type': 'application/octet-stream', 'X-Base-Hash': 'none', 'X-Message': encodeURIComponent('그림'), ...headers },
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const ok = await put('/upload/skills/demo/img.png', png);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json(), { revision: 2 });
  assert.ok(s.store.fileAt('skills/demo/img.png').equals(png));
  assert.equal(s.store.revision(2).message, '그림');
  const dup = await put('/upload/skills/demo/img.png', png);
  assert.equal(dup.status, 409);
  assert.match(dup.json().error, /그사이 같은 이름의 파일이 바뀌었다/);
  assert.equal((await put('/upload/skills/demo/img.png', Buffer.from([1]), { 'X-Base-Hash': sha256(png) })).status, 200);
  const big = await put('/upload/skills/demo/big.bin', Buffer.alloc(1024 * 1024 + 1));
  assert.equal(big.status, 400);
  assert.match(big.json().error, /1MB/);
  assert.equal((await put('/upload/skills/demo/a.png', png, { 'X-Message': '' })).status, 400);
  assert.equal((await put('/upload/skills/demo/a.png', png, { Origin: 'http://evil.test' })).status, 403);
  const anon = await s.req('/upload/skills/demo/a.png', { method: 'PUT', body: png, headers: { Origin: s.config.publicUrl.origin } });
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.json(), { error: '로그인이 필요하다' });
});

test('첫 줄이 빈 파일도 편집 화면이 내용을 그대로 담는다(textarea 가 첫 줄바꿈 하나를 버리므로 하나를 앞에 둔다)', async t => {
  const { s, cookie } = await seeded(t);
  s.store.commit({ ...META, changes: { 'rules/base/README.md': '\n# base\n' } });
  const page = await getAs(s, cookie, '/edit/rules/base/README.md');
  assert.ok(page.text.includes('<textarea name="content" spellcheck="false">\n\n# base\n</textarea>'));
});
