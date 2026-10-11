import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, META } from './helpers.js';
import { catalogSummary } from '../../cli/src/summary.js';
import { dbTree } from '../src/db-tree.js';
import { blockOf, blockHref, viewHref, blockFiles, blockDir } from '../src/web/blocks.js';

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
