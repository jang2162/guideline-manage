import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.js';

const SYNC_COMMON = fileURLToPath(new URL('../src/commands/sync-common.js', import.meta.url));

// 에이전트·스크립트는 `--json` 의 stdout 을 그대로 JSON.parse 한다. ruler 가 stdout 에 쓰는 로그가 섞이면 파싱이 깨진다.
// 그래서 ruler 의 stdout 을 우리 stderr 로 돌린다. 자식 프로세스 안에서 돌려야 stdout 에 무엇이 나갔는지 볼 수 있다.
function runInChild(t, { quiet }) {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'fake-ruler');
  fs.writeFileSync(bin, '#!/bin/sh\necho "[ruler] out-line"\necho "[ruler] err-line" >&2\nexit 0\n', { mode: 0o755 });
  const script = `import { defaultRunRuler } from ${JSON.stringify(SYNC_COMMON)};\n`
    + `const code = defaultRunRuler(${JSON.stringify(bin)}, ${JSON.stringify(dir)}, { quiet: ${quiet} });\n`
    + `process.stdout.write(JSON.stringify({ code }));\n`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
}

test('ruler 의 출력은 stdout 에 섞이지 않고 stderr 로 간다', t => {
  const r = runInChild(t, { quiet: false });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { code: 0 });
  assert.match(r.stderr, /\[ruler\] out-line/);
  assert.match(r.stderr, /\[ruler\] err-line/);
});

test('quiet 면 ruler 의 출력을 보이지 않는다', t => {
  const r = runInChild(t, { quiet: true });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { code: 0 });
  assert.doesNotMatch(r.stderr, /\[ruler\]/);
});
