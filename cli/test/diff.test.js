import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff, keyPathDiff } from '../src/diff.js';

test('unifiedDiff 는 같으면 빈 문자열이고, 줄바꿈 문자만 다른 것도 같다고 본다', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '');
  assert.equal(unifiedDiff('a\r\nb\r\n', 'a\nb\n'), '');
});

test('unifiedDiff 는 바뀐 줄 앞뒤 3줄을 묶어 낸다', () => {
  const a = `${['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n')}\n`;
  const b = a.replace('5\n', '5x\n');
  assert.equal(unifiedDiff(a, b), ['--- 원본', '+++ 프로젝트', '@@ -2,7 +2,7 @@', ' 2', ' 3', ' 4', '-5', '+5x', ' 6', ' 7', ' 8'].join('\n'));
});

test('unifiedDiff 는 멀리 떨어진 변경을 두 묶음으로 낸다', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `${i + 1}`);
  const b = [...lines];
  b[1] = '2x';
  b[17] = '18x';
  const out = unifiedDiff(lines.join('\n'), b.join('\n'));
  assert.equal(out.split('\n').filter(l => l.startsWith('@@')).length, 2);
});

test('unifiedDiff 는 파일 끝 줄바꿈만 다르면 그렇다고 적는다', () => {
  assert.equal(unifiedDiff('a\n', 'a'), '--- 원본\n+++ 프로젝트\n(파일 끝 줄바꿈만 다름)');
});

test('keyPathDiff 는 type 을 빼고 다른 키 경로만 값 없이 낸다', () => {
  const src = { type: 'stdio', command: 'npx', args: ['-y', 'a'], env: { TOKEN: '${TOKEN}', LOG: 'info' } };
  const proj = { command: 'npx', args: ['-y', 'b'], env: { TOKEN: 'hunter2' }, cwd: '/x' };
  const out = keyPathDiff(src, proj);
  assert.deepEqual(out, ['args 다름', 'cwd 프로젝트에만 있음', 'env.LOG 원본에만 있음', 'env.TOKEN 다름']);
  assert.ok(out.every(l => !l.includes('hunter2')));
  assert.deepEqual(keyPathDiff({ type: 'http', url: 'u' }, { type: 'sse', url: 'u' }), []);
  assert.deepEqual(keyPathDiff({ url: 'u' }, undefined), ['url 원본에만 있음']);
});
