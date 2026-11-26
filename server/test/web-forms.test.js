import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startApp, META, login, postForm, getAs } from './helpers.js';

const ITEMS = [
  { kind: 'rule', id: 'rules/base/00-a.md', stack: 'base', load: 'always', state: 'same', lockState: 'current' },
  { kind: 'rule', id: 'rules/base/01-b.md', stack: 'base', load: 'always', state: 'different', lockState: 'local' },
];

async function setup(t, project = {}, extra = {}) {
  const s = await startApp(t);
  s.store.commit({
    ...META, source: 'import',
    changes: { 'rules/base/00-a.md': '---\nload: always\n---\n\n# a\n', 'rules/base/01-b.md': '---\nload: always\n---\n\n# b\n' },
  });
  const token = s.tokens.issue({ name: 'cli-a', scope: 'read' }).token;
  const body = {
    formVersion: 2,
    revision: 1,
    project: { name: 'p', path: '/x/p', form: 'ruler', instructionFiles: [], agents: ['claude'], isNew: false, gitRepo: true, dirty: false, ...project },
    items: ITEMS,
    overrides: [],
    diffs: { 'rule:rules/base/01-b.md': { files: [{ path: '.ruler/base/01-b.md', diff: '-a\n+b' }] } },
    ...extra,
  };
  const r = await s.req('/api/v1/forms', { method: 'POST', auth: token, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const { id, url } = r.json();
  const u = new URL(url);
  return { s, token, id, link: u.pathname + u.search };
}

const openForm = async f => (await f.s.req(f.link)).headers['set-cookie'][0].split(';')[0];
const postJson = (s, path, body, { cookie, origin = s.config.publicUrl.origin, type = 'application/json' } = {}) => s.req(path, {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': type, ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
});
const result = f => f.s.req(`/api/v1/forms/${f.id}/result`, { auth: f.token }).then(r => r.json());

test('링크 토큰은 그 폼에만 쓰는 쿠키로 바뀌고 주소에서 빠진다', async t => {
  const f = await setup(t);
  assert.equal((await f.s.req(`/forms/${f.id}?k=wrong`)).status, 404);
  const r = await f.s.req(f.link);
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, `/forms/${f.id}`);
  const cookie = r.headers['set-cookie'][0];
  assert.match(cookie, new RegExp(`Path=/forms/${f.id};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(f.s.app.deps.forms.load(f.id).openedAt);
});

test('쿠키가 있어야 화면·데이터·차이가 보인다', async t => {
  const f = await setup(t);
  const cookie = await openForm(f);
  const page = await getAs(f.s, cookie, `/forms/${f.id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, new RegExp(`data-id="${f.id}"`));
  assert.match(page.text, /<script type="module" src="\/static\/forms\.js"><\/script>/);
  assert.equal((await f.s.req(`/forms/${f.id}`)).status, 404);
  const data = (await getAs(f.s, cookie, `/forms/${f.id}/data`)).json();
  assert.deepEqual(data.items, ITEMS);
  assert.deepEqual(data.catalog.stacks.map(x => x.name), ['base']);
  const diff = (await getAs(f.s, cookie, `/forms/${f.id}/diff?key=${encodeURIComponent('rule:rules/base/01-b.md')}`)).json();
  assert.equal(diff.files[0].path, '.ruler/base/01-b.md');
  const noCookie = await f.s.req(`/forms/${f.id}/data`);
  assert.equal(noCookie.status, 404);
  assert.match(noCookie.json().error, /폼 링크/);
});

test('제출은 Origin·JSON 을 검사하고 서버가 선택을 계산해 한 번만 받는다', async t => {
  const f = await setup(t);
  const cookie = await openForm(f);
  const choices = {
    'rule:rules/base/00-a.md': { checked: false, update: false },
    'rule:rules/base/01-b.md': { checked: true, update: false, overwrite: true },
  };
  assert.equal((await postJson(f.s, `/forms/${f.id}/submit`, { choices }, { cookie, origin: null })).status, 403);
  assert.equal((await postJson(f.s, `/forms/${f.id}/submit`, { choices }, { cookie, type: 'text/plain' })).status, 415);
  assert.equal((await postJson(f.s, `/forms/${f.id}/submit`, { choices }, { cookie })).status, 200);
  const r = await result(f);
  assert.equal(r.status, 'submitted');
  assert.deepEqual(r.selection.items.map(i => [i.id, i.action, i.overwrite ?? false]), [
    ['rules/base/00-a.md', 'remove', false],
    ['rules/base/01-b.md', 'keep', true],
  ]);
  assert.equal((await postJson(f.s, `/forms/${f.id}/submit`, { choices }, { cookie })).status, 409);
});

test('작업 트리가 더러우면 force 없이 제출할 수 없다', async t => {
  const f = await setup(t, { dirty: true });
  const cookie = await openForm(f);
  const bad = await postJson(f.s, `/forms/${f.id}/submit`, { choices: {} }, { cookie });
  assert.equal(bad.status, 400);
  assert.match(bad.json().error, /그래도 진행/);
  assert.equal((await postJson(f.s, `/forms/${f.id}/submit`, { choices: {}, force: true }, { cookie })).status, 200);
});

test('새 프로젝트는 에이전트를 골라야 하고, 형태는 늘 ruler 다', async t => {
  const f = await setup(t, { isNew: true, form: 'ruler', gitRepo: false });
  const cookie = await openForm(f);
  assert.doesNotMatch((await f.s.req(`/forms/${f.id}`, { headers: { Cookie: cookie } })).text, /name="form"/);
  assert.match((await postJson(f.s, `/forms/${f.id}/submit`, { choices: {} }, { cookie })).json().error, /에이전트를 하나 이상 선택/);
  const ok = await postJson(f.s, `/forms/${f.id}/submit`, { choices: {}, chosen: { agents: ['claude', 'claude'] } }, { cookie });
  assert.equal(ok.status, 200);
  assert.deepEqual((await result(f)).selection.project, { form: 'ruler', agents: ['claude'] });
});

test('취소하면 cancelled, 그 뒤 ping 은 409', async t => {
  const f = await setup(t);
  const cookie = await openForm(f);
  assert.equal((await postJson(f.s, `/forms/${f.id}/ping`, {}, { cookie })).status, 200);
  assert.equal((await postJson(f.s, `/forms/${f.id}/cancel`, {}, { cookie })).status, 200);
  assert.equal((await result(f)).status, 'cancelled');
  assert.equal((await postJson(f.s, `/forms/${f.id}/ping`, {}, { cookie })).status, 409);
});

test('CLI 로그인: 관리자 세션으로 승인하면 콜백으로 코드를 보내고, 그 코드는 토큰으로 바뀐다', async t => {
  const s = await startApp(t);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const q = new URLSearchParams({ callback: 'http://127.0.0.1:5555/cb', state, challenge, name: 'my-mac' });
  const anon = await s.req(`/cli/login?${q}`);
  assert.equal(anon.status, 303);
  assert.match(anon.headers.location, /^\/login\?next=/);
  const cookie = await login(s);
  const page = await getAs(s, cookie, `/cli/login?${q}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /my-mac/);
  const evil = new URLSearchParams({ callback: 'http://evil.example/cb', state, challenge, name: 'x' });
  assert.equal((await getAs(s, cookie, `/cli/login?${evil}`)).status, 400);
  assert.equal((await postForm(s, '/cli/login', Object.fromEntries(q), { cookie, origin: null })).status, 403);
  const r = await postForm(s, '/cli/login', Object.fromEntries(q), { cookie });
  assert.equal(r.status, 303);
  const back = new URL(r.headers.location);
  assert.equal(back.origin + back.pathname, 'http://127.0.0.1:5555/cb');
  assert.equal(back.searchParams.get('state'), state);
  const ex = await s.req('/api/v1/cli/token', {
    method: 'POST', body: JSON.stringify({ code: back.searchParams.get('code'), verifier }), headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(ex.status, 200);
  assert.match(ex.json().name, /^cli-my-mac-[0-9a-f]{6}$/);
});

test('정적 forms.js·selection.js·blocks.js 를 낸다', async t => {
  const s = await startApp(t);
  for (const name of ['forms.js', 'selection.js', 'blocks.js']) {
    const r = await s.req(`/static/${name}`);
    assert.equal(r.status, 200, name);
    assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
  }
});

test('폼 본문에 catalog 가 있으면 데이터는 그것을 쓴다(별칭을 입힌 원본)', async t => {
  const catalog = { stacks: [{ name: 'company-base', categories: [], setup: false, files: [], overrides: [] }], skills: [], subagents: [], mcp: [] };
  const f = await setup(t, {}, { catalog });
  const cookie = await openForm(f);
  const data = (await f.s.req(`/forms/${f.id}/data`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(data.catalog.stacks.map(x => x.name), ['company-base']);
  const plain = await setup(t);
  const d2 = (await plain.s.req(`/forms/${plain.id}/data`, { headers: { Cookie: await openForm(plain) } })).json();
  assert.deepEqual(d2.catalog.stacks.map(x => x.name), ['base']);
});

test('폼 data 의 recommend: 없으면 빈 객체, 문자열 값이 아닌 recommend 로는 폼을 만들지 못한다', async t => {
  const f = await setup(t);
  const cookie = await openForm(f);
  assert.deepEqual((await f.s.req(`/forms/${f.id}/data`, { headers: { Cookie: cookie } })).json().recommend, {});
  const bad = await f.s.req('/api/v1/forms', {
    method: 'POST', auth: f.token, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formVersion: 2, revision: 1, project: { name: 'p' }, items: [], overrides: [], recommend: [1] }),
  });
  assert.equal(bad.status, 400);
  const bad2 = await f.s.req('/api/v1/forms', {
    method: 'POST', auth: f.token, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formVersion: 2, revision: 1, project: { name: 'p' }, items: [], overrides: [], recommend: { 'rules/base': 1 } }),
  });
  assert.equal(bad2.status, 400);
});

test('폼 data 의 recommendRemove: 받은 그대로 싣고(없으면 빈 객체), 문자열 값이 아니면 폼을 만들지 못한다', async t => {
  const f = await setup(t, {}, { recommendRemove: { 'rules/base': '안 씀' } });
  const data = (await f.s.req(`/forms/${f.id}/data`, { headers: { Cookie: await openForm(f) } })).json();
  assert.deepEqual(data.recommendRemove, { 'rules/base': '안 씀' });
  const plain = await setup(t);
  assert.deepEqual((await plain.s.req(`/forms/${plain.id}/data`, { headers: { Cookie: await openForm(plain) } })).json().recommendRemove, {});
  for (const recommendRemove of [[1], { 'rules/base': 1 }, 'rules/base']) {
    const bad = await f.s.req('/api/v1/forms', {
      method: 'POST', auth: f.token, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formVersion: 2, revision: 1, project: { name: 'p' }, items: [], overrides: [], recommendRemove }),
    });
    assert.equal(bad.status, 400, JSON.stringify(recommendRemove));
  }
});

test('폼 페이지는 빼라는 추천 문구를 브라우저 문구 블록에 싣는다', async t => {
  const f = await setup(t);
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: await openForm(f) } })).text;
  assert.ok(page.includes('"web.client.recommendedRemove"'));
});

test('폼 페이지는 추천·의존성 문구를 브라우저 문구 블록에 싣는다', async t => {
  const f = await setup(t);
  const cookie = await openForm(f);
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: cookie } })).text;
  for (const key of ['web.client.recommended', 'web.client.why', 'web.client.dependency', 'web.client.autoChecked', 'web.client.missingRequire']) {
    assert.ok(page.includes(`"${key}"`), key);
  }
});

test('폼에는 단계 탭 다섯(지침·MCP·서브에이전트·스킬·확인)과 이전·다음 버튼이 있다', async t => {
  const f = await setup(t);
  const cookie = await openForm(f);
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: cookie } })).text;
  for (const step of ['rules', 'mcp', 'agents', 'skills', 'confirm']) assert.ok(page.includes(`data-step="${step}"`), step);
  assert.ok(page.includes('id="prev"') && page.includes('id="next"'));
  for (const key of ['web.client.stepTiers', 'web.client.stepNone', 'web.client.hiddenByCategory', 'web.client.allCategories', 'web.client.step.rules', 'web.client.step.mcp', 'web.client.step.agents', 'web.client.step.skills']) assert.ok(page.includes(`"${key}"`), key);
});

test('폼 데이터의 catalog 스택에 parent·when 이 있다', async t => {
  const f = await setup(t);
  f.s.store.commit({
    ...META,
    changes: {
      'rules/base/browser/README.md': '---\nwhen: 브라우저를 직접 다루는 작업\n---\n# browser\n',
      'rules/base/browser/00-tool.md': '---\nload: always\n---\n\n# tool\n',
    },
  });
  const r = await f.s.req('/api/v1/forms', {
    method: 'POST', auth: f.token, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formVersion: 2, revision: 2, project: { name: 'p', path: '/x/p', isNew: false, gitRepo: true, dirty: false }, items: [], overrides: [] }),
  });
  const u = new URL(r.json().url);
  const g = { s: f.s, link: u.pathname + u.search };
  const cookie = await openForm(g);
  const data = (await f.s.req(`${u.pathname}/data`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(data.catalog.stacks.map(x => [x.name, x.parent, x.when]), [
    ['base', null, null],
    ['base/browser', 'base', '브라우저를 직접 다루는 작업'],
  ]);
});

test('정적 forms.js 가 blocks.js 를 import 하고, 스택 나무·조상·자손 풀림 문구를 쓴다', async t => {
  const s = await startApp(t);
  const src = (await s.req('/static/forms.js')).text;
  assert.match(src, /^import \{[^}]*\bancestorKeys\b[^}]*\} from '\.\/blocks\.js';$/m);
  assert.match(src, /^import \{[^}]*\bstackRows\b[^}]*\} from '\.\/selection\.js';$/m);
  for (const key of ['web.client.ancestor', 'web.client.childrenReleased']) assert.ok(src.includes(`'${key}'`), key);
  // .stack 은 app.css 의 폼 배치 클래스(max-width 640px, 안의 label 을 세로로)라 스택 행에 쓰면 행이 좁아지고 갱신 칸이 꺾인다.
  assert.doesNotMatch(src, /class="[^"]*\bstack(?![\w-])/);
  assert.match(src, /class="group stack-group/);
});

test('폼 페이지는 조상·자손 풀림 문구를 브라우저 문구 블록에 싣는다', async t => {
  const f = await setup(t);
  const cookie = await openForm(f);
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: cookie } })).text;
  for (const key of ['web.client.ancestor', 'web.client.childrenReleased', 'web.client.when']) assert.ok(page.includes(`"${key}"`), key);
});

const PERSONAL = {
  chosen: ['rules/base', 'rules/base/browser', 'rules/web'],
  required: ['rules/base/browser'],
  add: ['rules/tools'], remove: [], preset: 'local',
};

test('개인 모드 제출은 personalSelection 결과를 결과로 둔다', async t => {
  // 더러운 작업 트리라도 개인 모드는 force 를 묻지 않는다(커밋되는 파일을 바꾸지 않는다).
  const f = await setup(t, { dirty: true }, { mode: 'personal', personal: PERSONAL });
  const cookie = await openForm(f);
  const data = (await getAs(f.s, cookie, `/forms/${f.id}/data`)).json();
  assert.equal(data.mode, 'personal');
  assert.deepEqual(data.personal, { ...PERSONAL, role: null });
  const rejected = await postJson(f.s, `/forms/${f.id}/submit`, { personalChoices: { 'rules/base': 'remove' } }, { cookie });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json().error, /필수/);
  const ok = await postJson(f.s, `/forms/${f.id}/submit`, {
    personalChoices: { 'rules/tools/deep': 'add', 'rules/web': 'remove', 'rules/base': 'add', 'skills/s': 'bogus' },
    saveDefault: true,
  }, { cookie });
  assert.equal(ok.status, 200);
  assert.deepEqual((await result(f)).selection, {
    mode: 'personal', add: ['rules/tools', 'rules/tools/deep'], remove: ['rules/web'], saveDefault: true, rejected: [],
  });
});

test('프로젝트 모드 제출은 필수를 싣고, 폼 data 는 mode·required 를 준다', async t => {
  const f = await setup(t, {}, { required: ['rules/base'] });
  const cookie = await openForm(f);
  const data = (await getAs(f.s, cookie, `/forms/${f.id}/data`)).json();
  assert.equal(data.mode, 'project');
  assert.deepEqual(data.required, ['rules/base']);
  assert.equal(data.personal, null);
  assert.equal((await postJson(f.s, `/forms/${f.id}/submit`, { choices: {}, required: ['rules/base', 'rules/other'] }, { cookie })).status, 200);
  assert.deepEqual((await result(f)).selection.required, ['rules/base']);
});

test('payload 에 required 가 없으면(옛 CLI) 화면이 보낸 필수를 결과에 싣지 않는다', async t => {
  // 새 화면은 늘 required 를 보낸다. payload 에 필수가 없으면 화면은 필수 없이 시작하므로 [] 를 「필수 모두 지움」 으로 믿으면 안 된다.
  const f = await setup(t);
  const cookie = await openForm(f);
  assert.deepEqual((await getAs(f.s, cookie, `/forms/${f.id}/data`)).json().required, []);
  assert.equal((await postJson(f.s, `/forms/${f.id}/submit`, { choices: {}, required: [] }, { cookie })).status, 200);
  assert.equal(Object.hasOwn((await result(f)).selection, 'required'), false);
});

test('폼 data 의 personal 은 chosen·required·add·remove·preset·role 만 넘긴다', async t => {
  const f = await setup(t, {}, { mode: 'personal', personal: { ...PERSONAL, secret: 'x', store: '/home/me/.git' } });
  const cookie = await openForm(f);
  // 역할이 없는 payload(옛 CLI·역할 없는 pick --local)는 role: null
  assert.deepEqual((await getAs(f.s, cookie, `/forms/${f.id}/data`)).json().personal, { ...PERSONAL, role: null });
});

test('/data 는 personal.role 을 넘기고 다른 personal 필드는 거른다', async t => {
  const f = await setup(t, {}, { mode: 'personal', personal: { ...PERSONAL, role: 'ui', secret: 'x' } });
  const cookie = await openForm(f);
  assert.deepEqual((await getAs(f.s, cookie, `/forms/${f.id}/data`)).json().personal, { ...PERSONAL, role: 'ui' });
  // 문자열이 아니면 null
  const g = await setup(t, {}, { mode: 'personal', personal: { ...PERSONAL, role: { name: 'ui' } } });
  const c = await openForm(g);
  assert.equal((await getAs(g.s, c, `/forms/${g.id}/data`)).json().personal.role, null);
});

test('정적 forms.js 는 역할이 있으면 개인 폼 제목에 역할 이름을 보인다(personalRoleTitle)', async t => {
  const s = await startApp(t);
  const src = (await s.req('/static/forms.js')).text;
  assert.ok(src.includes("'web.client.personalRoleTitle'"));
  const f = await setup(t, {}, { mode: 'personal', personal: { ...PERSONAL, role: 'ui' } });
  const cookie = await openForm(f);
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: cookie } })).text;
  assert.ok(page.includes('"web.client.personalRoleTitle"'));
});

test('정적 forms.js 는 개인 폼을 켬·끔 토글(data-toggle)로 그리고 그대로·더함·뺌 라디오는 없다', async t => {
  const s = await startApp(t);
  const src = (await s.req('/static/forms.js')).text;
  assert.match(src, /data-toggle="/);
  assert.doesNotMatch(src, /tri-opt|data-personal=/);
  assert.match(src, /^import \{[^}]*\btoggleOn\b[^}]*\btoggleTo\b[^}]*\} from '\.\/selection\.js';$/m);
  for (const key of ['on', 'off', 'fixedGroup', 'toggleGroup', 'defaultTag', 'commonTag', 'turnedOn', 'turnedOff']) {
    assert.ok(src.includes(`'web.client.personal.${key}'`), key);
  }
  const f = await setup(t, {}, { mode: 'personal', personal: { ...PERSONAL, role: 'ui' } });
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: await openForm(f) } })).text;
  assert.ok(page.includes('"web.client.personal.commonTag":"내 공통 선택"'));
  assert.ok(page.includes('"web.client.personal.turnedOff":"내가 끔"'));
});

test('폼 페이지는 개인 모드·필수 문구를 브라우저 문구 블록에 싣는다', async t => {
  const f = await setup(t, {}, { mode: 'personal', personal: PERSONAL });
  const cookie = await openForm(f);
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: cookie } })).text;
  for (const key of ['web.client.personal.on', 'web.client.personal.off', 'web.client.personal.defaultTag', 'web.client.personal.locked', 'web.client.personal.preset.local', 'web.client.personal.preset.defaults', 'web.client.personal.saveDefault']) {
    assert.ok(page.includes(`"${key}"`), key);
  }
});

test('정적 forms.js 는 프로젝트 블록마다 사용 안 함·기본·고정 칸(data-tier)을 쓰고 필수 체크박스는 없다', async t => {
  const s = await startApp(t);
  const src = (await s.req('/static/forms.js')).text;
  assert.match(src, /data-tier="/);
  assert.doesNotMatch(src, /data-required=/);
  assert.match(src, /^import \{[^}]*\btierOf\b[^}]*\bapplyTier\b[^}]*\} from '\.\/selection\.js';$/m);
  for (const key of ['web.client.tier.off', 'web.client.tier.default', 'web.client.tier.fixed', 'web.client.tierLegend', 'web.client.stepTiers', 'web.client.confirm.fixed', 'web.client.confirm.default']) {
    assert.ok(src.includes(`'${key}'`), key);
  }
  const f = await setup(t);
  const page = (await f.s.req(`/forms/${f.id}`, { headers: { Cookie: await openForm(f) } })).text;
  assert.ok(page.includes('"web.client.tier.fixed":"고정"'));
  assert.ok(page.includes('"web.client.tier.default":"기본"'));
  assert.ok(page.includes('"web.client.tier.off":"사용 안 함"'));
});

test('폼 data 의 fixedKnown: payload 에 required 가 있을 때만 참(옛 CLI 폼은 고정을 고를 수 없다)', async t => {
  const f = await setup(t, {}, { required: [] });
  assert.equal((await getAs(f.s, await openForm(f), `/forms/${f.id}/data`)).json().fixedKnown, true);
  const old = await setup(t);
  assert.equal((await getAs(old.s, await openForm(old), `/forms/${old.id}/data`)).json().fixedKnown, false);
});

test('/data 는 역할 폼의 personal.project(프로젝트만의 선택)를 넘기고, 문자열 목록이 아니면 뺀다', async t => {
  const f = await setup(t, {}, { mode: 'personal', personal: { ...PERSONAL, role: 'ui', project: ['rules/base'] } });
  assert.deepEqual((await getAs(f.s, await openForm(f), `/forms/${f.id}/data`)).json().personal.project, ['rules/base']);
  const g = await setup(t, {}, { mode: 'personal', personal: { ...PERSONAL, role: 'ui', project: [1] } });
  assert.equal(Object.hasOwn((await getAs(g.s, await openForm(g), `/forms/${g.id}/data`)).json().personal, 'project'), false);
});
