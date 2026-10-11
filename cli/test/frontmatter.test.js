import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatter, yamlString, setFrontmatterValue, readQuoted, categoriesValue } from '../src/frontmatter.js';
import { parseCategories } from '../src/categories.js';

test('frontmatter 는 최상위 key: value 를 읽는다', () => {
  const fm = frontmatter('---\nname: code-reviewer\ndescription: 검토한다\nmodel: inherit\n---\n\n# 본문\n');
  assert.deepEqual(fm, { name: 'code-reviewer', description: '검토한다', model: 'inherit' });
});

test('frontmatter 는 여러 줄 YAML 목록과 들여쓴 줄을 건너뛴다', () => {
  const fm = frontmatter('---\nname: a\ntools:\n  - Read\n  - Grep\ndescription: d\n---\n');
  assert.equal(fm.name, 'a');
  assert.equal(fm.description, 'd');
  assert.equal(fm.tools, '');
});

const BOM = String.fromCharCode(0xfeff);

test('frontmatter 는 CRLF 를 받아들이고 값을 따옴표째 돌려준다', () => {
  const fm = frontmatter('---\r\nname: "a"\r\ndescription: \'설명\'\r\n---\r\n본문\r\n');
  assert.deepEqual(fm, { name: '"a"', description: "'설명'" });
});

test('frontmatter 는 ruler 처럼 BOM 이나 뒤에 공백이 붙은 여는 줄을 frontmatter 로 보지 않는다', () => {
  assert.equal(frontmatter(`${BOM}---\nname: a\n---\n`), null);
  assert.equal(frontmatter('---  \nname: a\n---\n'), null);
});

test('frontmatter 가 없거나 닫히지 않으면 null', () => {
  assert.equal(frontmatter('# 제목\n'), null);
  assert.equal(frontmatter('---\nname: a\n'), null);
  assert.equal(frontmatter(''), null);
});

test('yamlString 은 따옴표를 벗기고 주석을 떼어 문자열을 돌려준다', () => {
  assert.equal(yamlString('code-reviewer'), 'code-reviewer');
  assert.equal(yamlString('"검토: diff 를 본다"'), '검토: diff 를 본다');
  assert.equal(yamlString("'a'"), 'a');
  assert.equal(yamlString('x # 주석'), 'x');
  assert.equal(yamlString('끝에 콜론:'), '끝에 콜론:');
  assert.equal(yamlString(''), '');
});

test('yamlString 은 YAML 로 읽히지 않을 값에 null', () => {
  for (const raw of ['검토: diff 를 본다', '`코드`', '"닫히지 않음', "'닫히지 않음", '[a, b]', '{a: 1}', '*alias', '@x', '#주석뿐']) {
    assert.equal(yamlString(raw), null, raw);
  }
});

test('setFrontmatterValue 는 키를 바꾸거나 더하거나 지우고, frontmatter 가 없으면 만든다', () => {
  assert.equal(setFrontmatterValue('---\nname: a\nlabel: 옛\n---\n# t\n', 'label', '새'), '---\nname: a\nlabel: 새\n---\n# t\n');
  assert.equal(setFrontmatterValue('---\nname: a\n---\n# t\n', 'label', '새'), '---\nname: a\nlabel: 새\n---\n# t\n');
  assert.equal(setFrontmatterValue('---\nname: a\nlabel: 옛\n---\n# t\n', 'label', ''), '---\nname: a\n---\n# t\n');
  assert.equal(setFrontmatterValue('---\nname: a\nlabel: 옛\n---\n# t\n', 'label', null), '---\nname: a\n---\n# t\n');
  assert.equal(setFrontmatterValue('# t\n', 'label', '새'), '---\nlabel: 새\n---\n\n# t\n');
  assert.equal(setFrontmatterValue('# t\n', 'label', null), '# t\n');
});

test('setFrontmatterValue 는 YAML 이 문자열로 못 읽을 값을 큰따옴표로 감싸고, 다시 읽으면 원래 값', () => {
  for (const v of ['a: b', '#tag', ' 앞 공백', '"따옴표"', '[x]', 'a # 주석']) {
    const text = setFrontmatterValue('---\nname: a\n---\n', 'label', v);
    const raw = frontmatter(text).label;
    assert.ok(raw.startsWith('"'), `${v} → ${raw}`);
    assert.equal(readQuoted(raw), v);
  }
  assert.equal(frontmatter(setFrontmatterValue('---\n---\n', 'label', '사내 개발서버 배포')).label, '사내 개발서버 배포');
});

test('categoriesValue 는 항목마다 필요할 때만 따옴표를 단다', () => {
  assert.equal(categoriesValue(['deploy', 'backend']), '[deploy, backend]');
  assert.equal(categoriesValue(['a]', 'b: c', 'd,e']), '["a]", "b: c", "d,e"]');
  assert.deepEqual(parseCategories(categoriesValue(['a]', 'b: c', 'd,e'])).categories, ['a]', 'b: c', 'd,e']);
});
