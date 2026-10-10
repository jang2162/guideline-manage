import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { tarGz } from '../../server/src/tar.js';
import { untarGz, archiveTree, TarError } from '../src/tar-read.js';
import { readText } from '../src/tree.js';

test('서버의 tarGz 로 묶은 것을 그대로 푼다(바이너리 포함)', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  const files = untarGz(tarGz([
    { path: 'rules/base/00-a.md', content: Buffer.from('# a\n') },
    { path: 'skills/s/img/a.png', content: png },
  ]));
  assert.deepEqual([...files.keys()], ['rules/base/00-a.md', 'skills/s/img/a.png']);
  assert.ok(files.get('skills/s/img/a.png').equals(png));
});

test('100바이트가 넘는 한글 경로(prefix 로 나뉜 것)를 다시 잇는다', () => {
  const long = `rules/${'가나다라마'.repeat(5)}/${'바사아자차'.repeat(5)}/00-긴-이름.md`;
  assert.ok(Buffer.byteLength(long) > 100);
  const files = untarGz(tarGz([{ path: long, content: Buffer.from('x') }]));
  assert.deepEqual([...files.keys()], [long]);
});

test('archiveTree 는 트리 인터페이스로 읽힌다', () => {
  const tree = archiveTree(tarGz([{ path: 'mcp/c7/server.json', content: Buffer.from('{}') }]));
  assert.deepEqual(tree.list('mcp'), [{ name: 'c7', dir: true }]);
  assert.equal(readText(tree, 'mcp/c7/server.json'), '{}');
});

test('.. 이나 / 로 시작하는 경로는 버린다', () => {
  const files = untarGz(tarGz([
    { path: '../etc/passwd', content: Buffer.from('x') },
    { path: 'ok.md', content: Buffer.from('y') },
  ]));
  assert.deepEqual([...files.keys()], ['ok.md']);
});

test('gzip 이 아니거나 잘린 tar 는 TarError', () => {
  assert.throws(() => untarGz(Buffer.from('nope')), TarError);
  const whole = zlib.gunzipSync(tarGz([{ path: 'a.md', content: Buffer.alloc(2000, 1) }]));
  assert.throws(() => untarGz(zlib.gzipSync(whole.subarray(0, 1024))), /잘렸다/);
});
