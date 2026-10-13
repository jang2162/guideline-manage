import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge3, splitKeep, markOurs, MARK_SEP, markTheirs } from '../src/merge3.js';

const BASE = 'a\nb\nc\nd\ne\n';

test('splitKeep 은 줄바꿈을 붙인 채로 나눈다', () => {
  assert.deepEqual(splitKeep('a\nb'), ['a\n', 'b']);
  assert.deepEqual(splitKeep(''), []);
});

test('겹치지 않는 두 수정은 합쳐진다', () => {
  assert.deepEqual(merge3(BASE, 'a\nB\nc\nd\ne\n', 'a\nb\nc\nD\ne\n'), { ok: true, text: 'a\nB\nc\nD\ne\n', conflicts: 0 });
});

test('한쪽만 고쳤으면 그쪽을 따른다', () => {
  assert.equal(merge3(BASE, BASE, 'a\nb\nX\nd\ne\n').text, 'a\nb\nX\nd\ne\n');
  assert.equal(merge3(BASE, 'a\nb\nX\nd\ne\n', BASE).text, 'a\nb\nX\nd\ne\n');
});

test('같은 곳을 다르게 고치면 충돌 표지를 넣는다', () => {
  const r = merge3(BASE, 'a\nb\nO\nd\ne\n', 'a\nb\nT\nd\ne\n');
  assert.equal(r.ok, false);
  assert.equal(r.conflicts, 1);
  assert.equal(r.text, `a\nb\n${markOurs()}\nO\n${MARK_SEP}\nT\n${markTheirs()}\nd\ne\n`);
});

test('양쪽이 같게 고친 곳은 충돌이 아니다', () => {
  assert.deepEqual(merge3(BASE, 'a\nZ\nc\nd\ne\n', 'a\nZ\nc\nd\ne\n'), { ok: true, text: 'a\nZ\nc\nd\ne\n', conflicts: 0 });
});

test('끝에 추가한 줄과 앞을 고친 것은 합쳐진다', () => {
  assert.equal(merge3(BASE, 'A\nb\nc\nd\ne\n', `${BASE}f\n`).text, 'A\nb\nc\nd\ne\nf\n');
});

test('끝 줄바꿈 유무도 수정으로 친다', () => {
  assert.equal(merge3('a\nb', 'a\nb', 'a\nb\n').text, 'a\nb\n');
});

test('CRLF 는 LF 로 맞춘 뒤 합친다', () => {
  assert.equal(merge3('a\r\nb\r\n', 'a\nB\n', 'A\r\nb\r\n').text, 'A\nB\n');
});

test('빈 기준에 양쪽이 다르게 쓰면 충돌, 한쪽만 쓰면 그쪽', () => {
  assert.equal(merge3('', 'x\n', 'y\n').ok, false);
  assert.equal(merge3('', '', 'y\n').text, 'y\n');
});
