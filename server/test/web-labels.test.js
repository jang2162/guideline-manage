import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, META } from './helpers.js';

const DEPLOY = 'deploy-agent__deploy.kbrainc.dev';
const FILES = {
  [`rules/${DEPLOY}/README.md`]: '---\nlabel: 사내 개발서버 배포\n---\n# 배포\n',
  [`rules/${DEPLOY}/00-a.md`]: '---\nload: always\n---\n# a\n',
  'rules/base/00-a.md': '---\nload: always\n---\n# a\n',
  'rules/xss/README.md': '---\nlabel: <b>x</b>\n---\n# x\n',
  'rules/xss/00-a.md': '---\nload: always\n---\n# a\n',
  'skills/s/SKILL.md': '---\nname: s\ndescription: 스킬\nlabel: 배포 스킬\n---\n',
};

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, changes: FILES });
  return s;
}

const SHOWN = '<span class="nm" title="deploy-agent__deploy.kbrainc.dev">사내 개발서버 배포</span><span class="real">deploy-agent</span><span class="domain">deploy.kbrainc.dev</span>';

test('표시 이름이 있으면 카드·상세 제목·왼쪽 목록에 표시 이름과 작은 실제 이름이 함께 보인다', async t => {
  const s = await setup(t);
  assert.ok((await s.req('/')).text.includes(SHOWN), '카드');
  const detail = (await s.req(`/s/${DEPLOY}`)).text;
  assert.ok(detail.includes(`<h1>${SHOWN}</h1>`), '상세 제목');
  assert.ok(detail.includes(`<b>${SHOWN}</b>`), '왼쪽 목록');
});

test('표시 이름이 없으면 지금 모양 그대로, HTML 은 이스케이프된다', async t => {
  const s = await setup(t);
  const home = (await s.req('/')).text;
  assert.ok(home.includes('<span class="nm" title="base">base</span>'));
  assert.ok(!home.includes('<span class="real">base</span>'));
  assert.ok(home.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!home.includes('<b>x</b>'));
});

test('스킬도 표시 이름을 쓴다', async t => {
  const s = await setup(t);
  const page = (await s.req('/skills')).text;
  assert.ok(page.includes('<span class="nm" title="s">배포 스킬</span><span class="real">s</span>'));
  assert.ok((await s.req('/skills/s')).text.includes('<h1><span class="nm" title="s">배포 스킬</span><span class="real">s</span></h1>'));
});
