import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpDir, write } from './helpers.js';
import {
  MANIFEST, LOCK, ManifestError, checkManifest, readManifest, checkLock, readLock, manifestText, lockText, qualify, splitQualified,
} from '../src/manifest.js';

const V1 = { version: 1, server: 'http://a', form: 'ruler', instructionFiles: [], agents: ['claude'], items: ['rules/base/00-a.md'] };
const M = {
  version: 3, form: 'ruler', agents: ['codex', 'claude'],
  sources: { default: { server: 'http://localhost:3000', items: ['skills/b', 'rules/base', 'skills/b'] } },
};

test('없으면 null', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(readManifest(dir), null);
  assert.equal(readLock(dir), null);
});

test('v1 매니페스트는 default 출처 하나로 읽고 v3 로 쓴다', () => {
  const m = checkManifest(V1);
  assert.deepEqual(m, { version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://a', items: ['rules/base'], aliases: {} } } });
  assert.deepEqual(JSON.parse(manifestText(m)), {
    version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'http://a', items: ['rules/base'] } },
  });
});

test('checkManifest 는 v2 파일 항목을 블록 키로 바꾸고 중복을 없앤다', () => {
  const m = checkManifest({ version: 2, form: 'ruler', agents: ['claude'], sources: { default: { server: 'https://s', items: ['rules/base/00-a.md', 'rules/base/SETUP.md', 'skills/x'], aliases: { 'rules/base': 'co' } } } });
  assert.equal(m.version, 3);
  assert.deepEqual(m.sources.default.items, ['rules/base', 'skills/x']);
  assert.deepEqual(m.sources.default.aliases, { 'rules/base': 'co' });
});

test('checkManifest 는 하위 스택 파일 id 를 그 스택 키로 바꾸고 조상을 채운다', () => {
  const v2 = checkManifest({ version: 2, form: 'ruler', agents: ['claude'], sources: { default: { server: 'https://s', items: ['rules/a/b/00-x.md'] } } });
  assert.deepEqual(v2.sources.default.items, ['rules/a', 'rules/a/b']);
  const v3 = checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'https://s', items: ['rules/a/b'] } } });
  assert.deepEqual(v3.sources.default.items, ['rules/a', 'rules/a/b']);
  const v1 = checkManifest({ ...V1, items: ['rules/a/b/00-x.md'] });
  assert.deepEqual(v1.sources.default.items, ['rules/a', 'rules/a/b']);
});

test('점 든 최상위 스택(rules/next.js)을 고른 v2 매니페스트는 v3 로 써도 다시 읽힌다', () => {
  const v3 = checkManifest({ version: 2, form: 'ruler', agents: ['claude'], sources: { default: { server: 'https://s', items: ['rules/next.js/00-a.md'] } } });
  assert.deepEqual(v3.sources.default.items, ['rules/next.js']);
  const again = checkManifest(JSON.parse(manifestText(v3)));
  assert.deepEqual(again.sources.default.items, ['rules/next.js']);
});

test('checkManifest 는 블록 키가 아닌 v3 항목을 거절한다', () => {
  const bad = items => assert.throws(
    () => checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources: { default: { server: 'https://s', items } } }),
    err => err instanceof ManifestError && /sources\.default\.items: .*(is not a block key|블록 키가 아님)/.test(err.message),
  );
  bad(['rules/a/00-x.md']);
  bad(['rules/base/SETUP.md']);
  bad(['nope']);
});

test('manifestText 는 version 3 으로 쓴다', () => {
  assert.equal(JSON.parse(manifestText(checkManifest(M))).version, 3);
  assert.equal(JSON.parse(manifestText(checkManifest({ version: 2, form: 'ruler', agents: ['claude'], sources: { default: { server: 'https://s', items: ['rules/a/b/00-x.md'] } } }))).version, 3);
});

test('manifestText 는 에이전트·항목을 정렬하고 중복을 없앤다', () => {
  const text = manifestText(checkManifest(M));
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(JSON.parse(text), {
    version: 3, form: 'ruler', agents: ['claude', 'codex'],
    sources: { default: { server: 'http://localhost:3000', items: ['rules/base', 'skills/b'] } },
  });
});

test('v3 매니페스트: 출처·별칭 이름과 키를 검사하고 정렬해 쓴다', () => {
  const m = checkManifest({ version: 3, form: 'ruler', agents: ['codex', 'claude'], sources: {
    personal: { server: 'http://p', items: ['skills/s', 'rules/orca'] },
    company: { server: 'http://c', items: ['rules/base'], aliases: { 'rules/base': 'company-base' } },
    empty: { server: 'http://e', items: [] },
  } });
  const text = manifestText(m);
  assert.ok(text.indexOf('"company"') < text.indexOf('"personal"'));
  assert.doesNotMatch(text, /"empty"/);
  assert.match(text, /"rules\/orca",\n\s+"skills\/s"/);
  assert.match(text, /"aliases": \{\n\s+"rules\/base": "company-base"/);
  const bad = sources => assert.throws(() => checkManifest({ version: 3, form: 'ruler', agents: ['claude'], sources }), ManifestError);
  bad({ Company: { server: 'http://c', items: [] } });
  bad({ c: { server: 'http://c', items: [], aliases: { 'rules/base/01.md': 'x' } } });
  bad({ c: { server: 'http://c', items: [], aliases: { 'rules/base': 'X Y' } } });
});

test('readManifest 는 쓴 것을 그대로 읽는다', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, MANIFEST, manifestText(checkManifest(M)));
  assert.deepEqual(readManifest(dir).sources.default.items, ['rules/base', 'skills/b']);
});

test('checkManifest 는 틀린 값을 이유와 함께 거부한다', () => {
  assert.throws(() => checkManifest({ ...M, version: 4 }), /version is not 1, 2 or 3|version 이 1, 2/);
  assert.throws(() => checkManifest({ ...V1, server: 'ftp://x' }), /server/);
  assert.throws(() => checkManifest({ ...M, sources: { default: { server: 'ftp://x', items: [] } } }), /server/);
  assert.throws(() => checkManifest({ ...M, form: 'none' }), /form/);
  assert.throws(() => checkManifest({ ...M, agents: [] }), /agents/);
  assert.throws(() => checkManifest({ ...M, agents: ['cursor'] }), /agents/);
  assert.throws(() => checkManifest({ ...M, sources: { default: { server: 'http://a', items: 'x' } } }), /items/);
  assert.throws(() => checkManifest({ ...V1, instructionFiles: [1] }), ManifestError);
});

test('JSON 이 깨졌으면 ManifestError', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, MANIFEST, '{');
  assert.throws(() => readManifest(dir), /guideline\.json 을 JSON 으로 읽을 수 없음/);
});

test('v1 잠금은 default 로 읽고 v2 로 쓴다', () => {
  const l = checkLock({ version: 1, revision: 4, sources: { 'rules/base/00-a.md': 'h1' }, outputs: [{ path: '.ruler/base/00-a.md', items: ['rules/base/00-a.md'], hash: 'h2', adopted: true }] });
  assert.deepEqual(l, { version: 2, revisions: { default: 4 }, sources: { 'default:rules/base/00-a.md': 'h1' },
    outputs: [{ path: '.ruler/base/00-a.md', items: ['default:rules/base/00-a.md'], hash: 'h2', adopted: true }] });
  assert.deepEqual(checkLock(JSON.parse(lockText(l))), l);
  assert.deepEqual(splitQualified('company:rules/base/01.md'), { source: 'company', id: 'rules/base/01.md' });
  assert.equal(qualify('company', 'mcp/c7'), 'company:mcp/c7');
});

test('lockText 는 revisions·sources 키와 outputs 를 정렬하고 key 가 없으면 빼고 쓴다', t => {
  const lock = {
    version: 2,
    revisions: { personal: 1, company: 3 },
    sources: { 'default:skills/b': 'h2', 'default:rules/base/00-a.md': 'h1' },
    outputs: [
      { path: 'b.md', items: ['default:x'], hash: 'h' },
      { path: 'a.toml', key: 'mcp_servers.z', items: ['default:mcp/z'], hash: 'h' },
      { path: 'a.toml', key: 'mcp_servers.a', items: ['default:mcp/a'], hash: 'h' },
    ],
  };
  const parsed = JSON.parse(lockText(lock));
  assert.deepEqual(Object.keys(parsed.revisions), ['company', 'personal']);
  assert.deepEqual(Object.keys(parsed.sources), ['default:rules/base/00-a.md', 'default:skills/b']);
  assert.deepEqual(parsed.outputs.map(o => [o.path, o.key]), [['a.toml', 'mcp_servers.a'], ['a.toml', 'mcp_servers.z'], ['b.md', undefined]]);
  assert.equal('key' in parsed.outputs[2], false);
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, LOCK, lockText(lock));
  assert.deepEqual(readLock(dir).revisions, { company: 3, personal: 1 });
});

test('readLock 은 틀린 모양을 거부한다', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  write(dir, LOCK, JSON.stringify({ version: 1, revision: 0, sources: {}, outputs: [] }));
  assert.throws(() => readLock(dir), /revision/);
  write(dir, LOCK, JSON.stringify({ version: 2, revisions: { a: 0 }, sources: {}, outputs: [] }));
  assert.throws(() => readLock(dir), /revisions/);
  write(dir, LOCK, JSON.stringify({ version: 2, revisions: {}, sources: {}, outputs: [{ path: 'a', items: 'x', hash: 'h' }] }));
  assert.throws(() => readLock(dir), /outputs/);
});

test('잠금 version 이 모르는 값이면 더 새 CLI 가 썼을 수 있다고 CLI 를 올리라 한다', () => {
  assert.throws(() => checkLock({ version: 4, revisions: { default: 1 }, sources: {}, outputs: [] }), /version 이 1, 2, 3 이 아님 — 더 새 guideline CLI 가 썼을 수 있음\. CLI 를 업데이트할 것/);
});
