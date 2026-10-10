import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, normalized, isDirItem, dirHash, itemHash, treeHashes } from '../src/hashes.js';
import { memoryTree } from '../src/tree.js';

test('sha256 은 16진 문자열', () => {
  assert.equal(sha256('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});

test('normalized 는 텍스트 파일의 CRLF 만 LF 로 맞춘다', () => {
  assert.equal(normalized('a.md', Buffer.from('x\r\ny\r\n')).toString(), 'x\ny\n');
  const bin = Buffer.from([0x0d, 0x0a, 0xff]);
  assert.ok(normalized('a.png', bin).equals(bin));
});

test('isDirItem 은 스킬·MCP 만 디렉터리 항목이다', () => {
  assert.equal(isDirItem('skills/a'), true);
  assert.equal(isDirItem('mcp/b'), true);
  assert.equal(isDirItem('rules/base/00-a.md'), false);
  assert.equal(isDirItem('agents/x.md'), false);
});

test('dirHash 는 순서와 무관하고 . 으로 시작하는 이름을 뺀다', () => {
  const a = dirHash([{ path: 'b.md', hash: '2' }, { path: 'a.md', hash: '1' }]);
  const b = dirHash([{ path: 'a.md', hash: '1' }, { path: 'b.md', hash: '2' }, { path: 'x/.DS_Store', hash: '9' }]);
  assert.equal(a, b);
  assert.notEqual(a, dirHash([{ path: 'a.md', hash: '1' }]));
});

test('itemHash 는 파일 항목이면 파일 해시, 디렉터리 항목이면 dirHash, 없으면 null', () => {
  const hashes = new Map([['rules/base/00-a.md', 'h1'], ['skills/s/SKILL.md', 'h2'], ['skills/s/img/a.png', 'h3']]);
  assert.equal(itemHash(hashes, 'rules/base/00-a.md'), 'h1');
  assert.equal(itemHash(hashes, 'skills/s'), dirHash([{ path: 'SKILL.md', hash: 'h2' }, { path: 'img/a.png', hash: 'h3' }]));
  assert.equal(itemHash(hashes, 'skills/none'), null);
  assert.equal(itemHash(hashes, 'rules/base/99-x.md'), null);
});

test('treeHashes 는 트리의 모든 파일을 해시한다', () => {
  const t = memoryTree({ 'a.md': 'A', 'd/b.md': 'B' });
  assert.deepEqual([...treeHashes(t)], [['a.md', sha256('A')], ['d/b.md', sha256('B')]]);
});

test('normalized 는 확장자와 상관없이 UTF-8 텍스트면 CRLF 를 맞춘다(스킬의 .sh·.py)', () => {
  assert.equal(normalized('skills/s/run.sh', Buffer.from('a\r\nb\r\n')).toString(), 'a\nb\n');
  assert.equal(normalized('skills/s/Makefile', Buffer.from('a\r\n')).toString(), 'a\n');
  const nul = Buffer.from([0x61, 0x0d, 0x0a, 0x00]);
  assert.ok(normalized('skills/s/x.bin', nul).equals(nul));
});
