import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTier } from '../src/tiers.js';

const fm = body => `---\n${body}\n---\n\n# 제목\n`;

test('readTier 는 always 파일을 읽는다', () => {
  assert.deepEqual(readTier(fm('load: always')), { load: 'always', when: null });
});

test('readTier 는 reference 파일과 when 을 읽고 따옴표·주석을 벗긴다', () => {
  assert.deepEqual(readTier(fm('load: reference\nwhen: 브라우저를 띄울 때')), { load: 'reference', when: '브라우저를 띄울 때' });
  assert.deepEqual(
    readTier(fm('load: "reference"\nwhen: "검토: diff 를 볼 때"')),
    { load: 'reference', when: '검토: diff 를 볼 때' },
  );
  assert.deepEqual(readTier(fm('load: always # 매 턴')), { load: 'always', when: null });
});

test('readTier 는 frontmatter 가 없거나 load 가 없으면 경고한다', () => {
  const warning = 'frontmatter 에 load 없음';
  for (const text of ['# 제목\n', fm('when: 언제'), fm('load:'), `${String.fromCharCode(0xfeff)}${fm('load: always')}`, '---\nload: always\n']) {
    assert.deepEqual(readTier(text), { warning }, JSON.stringify(text));
  }
});

test('readTier 는 load 가 always·reference 가 아니면 경고한다', () => {
  for (const load of ['Always', 'ref', '"sometimes"']) {
    assert.deepEqual(readTier(fm(`load: ${load}`)), { warning: 'load 가 always·reference 가 아님' }, load);
  }
});

test('readTier 는 reference 에 when 이 없거나 비면 경고한다', () => {
  for (const body of ['load: reference', 'load: reference\nwhen:', 'load: reference\nwhen: ""']) {
    assert.deepEqual(readTier(fm(body)), { warning: 'load 가 reference 인데 when 없음' }, body);
  }
});

test('readTier 는 always 에 when 이 있으면 경고한다', () => {
  assert.deepEqual(readTier(fm('load: always\nwhen: 언제나')), { warning: 'load 가 always 인데 when 이 있음' });
});

test('readTier 는 load·when 이 YAML 문자열로 읽히지 않으면 경고한다', () => {
  const warning = 'load·when 이 YAML 문자열로 읽히지 않음 — 값을 따옴표로 감싸야 함';
  for (const body of ['load: reference\nwhen: 검토: diff 를 볼 때', 'load: reference\nwhen: "닫히지 않음', 'load: `always`']) {
    assert.deepEqual(readTier(fm(body)), { warning }, body);
  }
});
