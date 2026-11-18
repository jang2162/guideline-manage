import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBlock, writeBlock } from '../src/gitignore-block.js';

const block = lines => ['# START guideline generated files', ...lines, '# END guideline generated files', ''].join('\n');

test('writeBlock 은 블록이 없으면 끝에 붙인다', () => {
  assert.equal(writeBlock(null, ['/b', '/a']), block(['/a', '/b']));
  assert.equal(writeBlock('', ['/a']), block(['/a']));
  assert.equal(writeBlock('node_modules\n', ['/a']), `node_modules\n${block(['/a'])}`);
  // 끝 줄바꿈이 없는 파일은 줄을 나눠서 붙인다
  assert.equal(writeBlock('node_modules', ['/a']), `node_modules\n${block(['/a'])}`);
});

test('writeBlock 은 블록 밖을 바꾸지 않는다', () => {
  const before = '# 내 설정\nnode_modules\n\n';
  const after = '\n# 뒤\n*.log  \n';
  const text = `${before}${block(['/old'])}${after}`;
  assert.equal(writeBlock(text, ['/x', '/y']), `${before}${block(['/x', '/y'])}${after}`);
  // 빈 목록이면 블록만 지운다
  assert.equal(writeBlock(text, []), `${before}${after}`);
  // 블록이 없고 빈 목록이면 그대로
  assert.equal(writeBlock('a\n', []), 'a\n');
  assert.equal(writeBlock(null, []), '');
});

test('writeBlock 은 CRLF 파일에서 CRLF 로 쓰고 블록 밖은 그대로 둔다', () => {
  const text = 'a\r\n# START guideline generated files\r\n/old\r\n# END guideline generated files\r\nb\r\n';
  assert.equal(writeBlock(text, ['/n']), 'a\r\n# START guideline generated files\r\n/n\r\n# END guideline generated files\r\nb\r\n');
  assert.deepEqual(readBlock(text), ['/old']);
  assert.equal(writeBlock(text, []), 'a\r\nb\r\n');
});

test('readBlock 은 블록의 경로를 읽는다', () => {
  assert.deepEqual(readBlock(null), []);
  assert.deepEqual(readBlock('a\n'), []);
  assert.deepEqual(readBlock(`x\n${block(['/a', '', '/b'])}y\n`), ['/a', '/b']);
  // 끝 표시가 없으면 블록이 아니다
  assert.deepEqual(readBlock('# START guideline generated files\n/a\n'), []);
});

test('writeBlock·readBlock 은 gitignore 패턴 글자를 이스케이프해 왕복한다', () => {
  const paths = ['/.ruler/skills/s/a[1].png', '/.ruler/skills/s/b*?.md', '/.ruler/skills/s/c\\d.md', '/.ruler/skills/s/e '];
  const text = writeBlock(null, paths);
  assert.match(text, /a\\\[1\]\.png/);
  assert.match(text, /b\\\*\\\?\.md/);
  assert.match(text, /e\\ \n/);
  assert.deepEqual(readBlock(text), [...paths].sort());
});

const S = '# START guideline generated files';
const E = '# END guideline generated files';

test('끝 표시 없는 고아 START 에 두 번 써도 사용자 줄이 남는다', () => {
  const text = `node_modules\n${S}\n/a\nmy-user-line\n`;
  const once = writeBlock(text, ['/x']);
  const twice = writeBlock(once, ['/y']);
  // 고아 START 아래 줄은 블록이 아니다: 그대로 두고 새 블록만 바꾼다
  assert.equal(twice, `node_modules\n${S}\n/a\nmy-user-line\n${block(['/y'])}`);
  assert.deepEqual(readBlock(twice), ['/y']);
  assert.equal(writeBlock(twice, []), text);
});

test('블록이 두 벌이면 둘 다 읽고 첫 자리에 하나로 합친다', () => {
  const text = `a\n${block(['/one', '/both'])}mid\n${block(['/two', '/both'])}z\n`;
  assert.deepEqual(readBlock(text).sort(), ['/both', '/one', '/two']);
  assert.equal(writeBlock(text, ['/n']), `a\n${block(['/n'])}mid\nz\n`);
  assert.equal(writeBlock(text, []), 'a\nmid\nz\n');
});

test('어떤 손상 입력에도 writeBlock 두 번 뒤 블록 밖 사용자 줄이 모두 남는다', () => {
  // user 는 블록 밖이라 반드시 남아야 할 줄(입력에 나온 횟수만큼)
  const cases = [
    { text: `u1\n${S}\n/a\nu2\n`, user: ['u1', '/a', 'u2'] },
    { text: `u1\n${E}\nu2\n`, user: ['u1', 'u2'] },
    { text: `u1\n${E}\n${S}\nu2\n`, user: ['u1', 'u2'] },
    { text: `${S}\nu1\n${S}\n/x\n${E}\nu2\n`, user: ['u1', 'u2'] },
    { text: `u1\n${S}\n/x\n${E}\nu2\n${S}\n/y\n${E}\nu3\n${S}\nu4`, user: ['u1', 'u2', 'u3', 'u4'] },
    { text: `u1\r\n${S}\r\nu2\r\n`, user: ['u1\r', 'u2\r'] },
    { text: `u1\n${S}\n/x\n${E}`, user: ['u1'] },
    { text: `${E}\n${E}\nu1\nu1\n${S}\n${S}\nu2`, user: ['u1', 'u1', 'u2'] },
  ];
  const count = (lines, x) => lines.filter(l => l === x).length;
  for (const { text, user } of cases) {
    for (const [p1, p2] of [[['/p'], ['/q']], [['/p'], []], [[], ['/q']], [[], []]]) {
      const out = writeBlock(writeBlock(text, p1), p2).split('\n');
      for (const u of new Set(user)) {
        assert.ok(count(out, u) >= count(user, u), `${JSON.stringify(text)} ${JSON.stringify([p1, p2])}: ${JSON.stringify(u)} 가 사라짐`);
      }
      assert.deepEqual(readBlock(out.join('\n')), p2.length ? p2 : []);
    }
  }
});

test('readBlock·writeBlock 은 표시를 받아 다른 표시의 블록을 건드리지 않는다', () => {
  const mine = { start: '# START guideline personal files .', end: '# END guideline personal files .' };
  const sub = { start: '# START guideline personal files sub', end: '# END guideline personal files sub' };
  const text = `# 사용자\n${block(['/a'])}`;
  const next = writeBlock(text, ['/x', '/sub/y'], mine);
  assert.equal(next, `# 사용자\n${block(['/a'])}${mine.start}\n/sub/y\n/x\n${mine.end}\n`);
  assert.deepEqual(readBlock(next), ['/a']);
  assert.deepEqual(readBlock(next, mine), ['/sub/y', '/x']);
  assert.deepEqual(readBlock(next, sub), []);
  const both = writeBlock(next, ['/sub/z'], sub);
  assert.deepEqual(readBlock(both, mine), ['/sub/y', '/x']);
  assert.equal(writeBlock(both, [], mine), `# 사용자\n${block(['/a'])}${sub.start}\n/sub/z\n${sub.end}\n`);
});
