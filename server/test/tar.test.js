import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpDir, filesOf } from '../../cli/test/helpers.js';
import { tarGz } from '../src/tar.js';

test('tarGz 로 묶은 것을 tar 로 풀면 같은 파일이 나온다(한글, 100바이트 넘는 경로, 바이너리)', t => {
  const dir = tmpDir('guideline-tar-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const long = `skills/${'a'.repeat(60)}/${'b'.repeat(60)}.md`;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const input = {
    'rules/base/00-a.md': Buffer.from('# a\n'),
    'rules/한글/00-b.md': Buffer.from('한글 내용\n'),
    [long]: Buffer.alloc(1000, 'x'),
    'skills/s/logo.png': png,
    'docs/authoring.md': Buffer.alloc(512, 'y'),
  };
  const file = path.join(dir, 'out.tar.gz');
  fs.writeFileSync(file, tarGz(Object.entries(input).map(([p, content]) => ({ path: p, content })), { mtime: new Date('2026-10-07T00:00:00Z') }));
  const out = path.join(dir, 'x');
  fs.mkdirSync(out);
  execFileSync('tar', ['-xzf', file, '-C', out]);
  const got = filesOf(out);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(input).sort());
  for (const [p, content] of Object.entries(input)) assert.ok(got[p].equals(content), p);
});

test('담을 수 없는 긴 이름은 던진다', () => {
  assert.throws(() => tarGz([{ path: `rules/${'x'.repeat(120)}.md`, content: Buffer.from('') }]), /path too long/);
});
