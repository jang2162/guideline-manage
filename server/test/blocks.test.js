import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, META } from './helpers.js';
import { catalogSummary } from '../../cli/src/summary.js';
import { dbTree } from '../src/db-tree.js';
import { blockOf, blockHref, viewHref, blockFiles, blockDir, blockOfKey, keyOfBlock, settingsHref } from '../src/web/blocks.js';
import { blockLabel } from '../src/web/layout.js';

const ALWAYS = '---\nload: always\n---\n';
function setup() {
  const store = memoryStore();
  store.commit({ ...META, changes: {
    'rules/base/README.md': '# base\n',
    'rules/base/00-a.md': `${ALWAYS}# a\n`,
    'rules/한글 스택/00-a.md': `${ALWAYS}# a\n`,
    'rules/skeleton/README.md': '# 뼈대\n',
    'skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\n# s\n',
    'skills/s/references/x.md': '# x\n',
    'agents/x.md': '---\nname: x\ndescription: d\n---\n# x\n',
    'mcp/m/server.json': '{"type":"stdio","command":"npx"}\n',
    'docs/authoring.md': '# 작성\n',
  } });
  return { store, summary: catalogSummary(dbTree(store)) };
}

test('blockOf 는 카탈로그 블록만 알아보고 rel 을 낸다', () => {
  const { summary } = setup();
  assert.deepEqual(blockOf('rules/base/00-a.md', summary), { kind: 'stack', name: 'base', rel: '00-a.md' });
  assert.deepEqual(blockOf('rules/base', summary), { kind: 'stack', name: 'base', rel: '' });
  assert.deepEqual(blockOf('skills/s/references/x.md', summary), { kind: 'skill', name: 's', rel: 'references/x.md' });
  assert.deepEqual(blockOf('agents/x.md', summary), { kind: 'agent', name: 'x', rel: '' });
  assert.deepEqual(blockOf('mcp/m/server.json', summary), { kind: 'mcp', name: 'm', rel: 'server.json' });
  assert.equal(blockOf('rules/skeleton/README.md', summary), null);
  assert.equal(blockOf('docs/authoring.md', summary), null);
  assert.equal(blockOf('agents/README.md', summary), null);
});

test('viewHref 는 블록이면 상세 주소, docs/ 면 문서 화면, 그 밖은 null 이고 조각마다 인코딩한다', () => {
  const { summary } = setup();
  assert.equal(viewHref('rules/한글 스택/00-a.md', summary), '/s/%ED%95%9C%EA%B8%80%20%EC%8A%A4%ED%83%9D/00-a.md');
  assert.equal(viewHref('rules/base', summary), '/s/base');
  assert.equal(viewHref('agents/x.md', summary), '/agents/x');
  assert.equal(viewHref('skills/s/references/x.md', summary), '/skills/s/references/x.md');
  assert.equal(viewHref('docs/authoring.md', summary), '/docs/authoring.md');
  assert.equal(viewHref('docs', summary), '/docs');
  assert.equal(viewHref('agents/README.md', summary), null);
  assert.equal(viewHref('', summary), null);
  assert.equal(blockHref('mcp', 'm'), '/mcp/m');
  assert.equal(blockDir('agent', 'x'), 'agents');
  assert.equal(blockDir('stack', 'base'), 'rules/base');
});

test('blockFiles 는 하위 디렉터리 파일까지 rel 로, 서브에이전트는 빈 배열', () => {
  const { store } = setup();
  assert.deepEqual(blockFiles(store, 'skill', 's'), ['references/x.md', 'SKILL.md'].sort());
  assert.deepEqual(blockFiles(store, 'stack', 'base'), ['00-a.md', 'README.md']);
  assert.deepEqual(blockFiles(store, 'agent', 'x'), []);
});

test('blockOf 는 최장 스택 접두를 고른다', () => {
  const summary = { stacks: [{ name: 'browser' }, { name: 'browser/neo' }], skills: [], subagents: [], mcp: [] };
  assert.deepEqual(blockOf('rules/browser/neo/00-x.md', summary), { kind: 'stack', name: 'browser/neo', rel: '00-x.md' });
  assert.deepEqual(blockOf('rules/browser/00-a.md', summary), { kind: 'stack', name: 'browser', rel: '00-a.md' });
  assert.deepEqual(blockOf('rules/browser/neo', summary), { kind: 'stack', name: 'browser/neo', rel: '' });
  assert.deepEqual(blockOf('rules/browser/assets/x.png', summary), { kind: 'stack', name: 'browser', rel: 'assets/x.png' });
  assert.equal(blockOf('rules/browser-x/00-a.md', summary), null);
});

test('blockOfKey 는 하위 스택 키를 경로 이름으로, keyOfBlock 은 그 반대', () => {
  assert.deepEqual(blockOfKey('rules/a/b'), { kind: 'stack', name: 'a/b' });
  assert.deepEqual(blockOfKey('rules/a'), { kind: 'stack', name: 'a' });
  assert.equal(blockOfKey('rules/a//b'), null);
  assert.equal(blockOfKey('skills/a/b'), null);
  assert.equal(keyOfBlock('stack', 'a/b'), 'rules/a/b');
});

test('blockFiles 는 자손 스택 폴더 아래 파일을 빼고, 스택이 아닌 하위 폴더는 둔다', () => {
  const store = memoryStore();
  store.commit({ ...META, changes: {
    'rules/browser/README.md': '# browser\n',
    'rules/browser/00-a.md': `${ALWAYS}# a\n`,
    'rules/browser/assets/logo.png': 'png',
    'rules/browser/neo/README.md': '# neo\n',
    'rules/browser/neo/00-x.md': `${ALWAYS}# x\n`,
    'rules/browser/neo/deep/00-y.md': `${ALWAYS}# y\n`,
  } });
  assert.deepEqual(blockFiles(store, 'stack', 'browser'), ['00-a.md', 'README.md', 'assets/logo.png']);
  assert.deepEqual(blockFiles(store, 'stack', 'browser/neo'), ['00-x.md', 'README.md']);
  assert.deepEqual(blockFiles(store, 'stack', 'browser/neo/deep'), ['00-y.md']);
});

test('하위 스택 주소는 조각마다 인코딩한다', () => {
  assert.equal(blockHref('stack', '한글/neo'), '/s/%ED%95%9C%EA%B8%80/neo');
  assert.equal(blockHref('stack', 'browser/neo', '00-x.md'), '/s/browser/neo/00-x.md');
  assert.equal(settingsHref('stack', '한글/neo'), '/settings/stack/%ED%95%9C%EA%B8%80/neo');
  assert.equal(settingsHref('skill', 'a b'), '/settings/skill/a%20b');
});

test('blockLabel 은 하위 스택의 마지막 조각에서 도메인을 가른다', () => {
  const out = String(blockLabel('tools/deploy__gitlab.example.com'));
  assert.ok(out.includes('<span class="domain">gitlab.example.com</span>'), out);
  assert.ok(out.includes('>tools/deploy</span>'), out);
  assert.ok(out.includes('title="tools/deploy__gitlab.example.com"'), out);
  const parentDomain = String(blockLabel('deploy__gitlab.example.com/neo'));
  assert.ok(!parentDomain.includes('class="domain"'), parentDomain);
  assert.ok(parentDomain.includes('>deploy__gitlab.example.com/neo</span>'), parentDomain);
});
