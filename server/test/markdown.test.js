import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, splitFrontmatter, firstSentence, linkHref } from '../src/web/markdown.js';

const md = (text, path = 'rules/base/01-git.md') => renderMarkdown(text, { path });

test('제목·문단·가로줄', () => {
  assert.equal(md('# 하나\n\n## 둘 ##\n\n###### 여섯'), '<h1>하나</h1>\n<h2>둘</h2>\n<h6>여섯</h6>');
  assert.equal(md('첫 줄\n둘째 줄\n\n다음 문단'), '<p>첫 줄\n둘째 줄</p>\n<p>다음 문단</p>');
  assert.equal(md('위\n\n---\n\n아래'), '<p>위</p>\n<hr>\n<p>아래</p>');
  assert.equal(md('* * *'), '<hr>');
  assert.equal(md('#제목아님'), '<p>#제목아님</p>');
  assert.equal(md('####### 일곱'), '<p>####### 일곱</p>');
});

test('인라인: 코드·굵게·기울임·링크', () => {
  assert.equal(md('`a*b*` 와 **굵게** 와 *기울임* 과 _밑줄_ 과 ***둘 다***'),
    '<p><code>a*b*</code> 와 <strong>굵게</strong> 와 <em>기울임</em> 과 <em>밑줄</em> 과 <strong><em>둘 다</em></strong></p>');
  assert.equal(md('snake_case_name 과 2 * 3 * 4'), '<p>snake_case_name 과 2 * 3 * 4</p>');
  assert.equal(md('``a ` b``'), '<p><code>a ` b</code></p>');
  assert.equal(md('**닫히지 않음'), '<p>**닫히지 않음</p>');
  assert.equal(md('\\*별\\* 그대로'), '<p>*별* 그대로</p>');
  assert.equal(md('[문서](https://example.com/a?b=1&c=2) 와 [메일](mailto:a@b.c)'),
    '<p><a href="https://example.com/a?b=1&amp;c=2">문서</a> 와 <a href="mailto:a@b.c">메일</a></p>');
  assert.equal(md('[**굵은** 링크](http://x.test "제목")'), '<p><a href="http://x.test"><strong>굵은</strong> 링크</a></p>');
  assert.equal(md('![그림](logo.png)'), '<p><a href="/f/rules/base/logo.png">그림</a></p>');
});

test('상대 링크는 지금 파일 기준으로 풀어 /f/ 주소로, 디렉터리는 /d/ 로', () => {
  assert.equal(md('[옆](02-x.md)'), '<p><a href="/f/rules/base/02-x.md">옆</a></p>');
  assert.equal(md('[위](../orca/README.md#절)'), '<p><a href="/f/rules/orca/README.md#%EC%A0%88">위</a></p>');
  assert.equal(md('[한글](./한 글.md)'), '<p><a href="/f/rules/base/%ED%95%9C%20%EA%B8%80.md">한글</a></p>');
  assert.equal(md('[디렉터리](../orca/)'), '<p><a href="/d/rules/orca">디렉터리</a></p>');
  assert.equal(md('[절](#how)'), '<p><a href="#how">절</a></p>');
  assert.equal(linkHref('../../skills/x/SKILL.md', 'rules/base/01-git.md'), '/f/skills/x/SKILL.md');
  assert.equal(linkHref('%2e%2e/%2e%2e/%2e%2e/etc', 'rules/base/01-git.md'), null);
});

test('목록: 중첩, 번호, 느슨한 목록, 이어지는 줄', () => {
  assert.equal(md('- 하나\n- 둘\n  - 둘의 하나\n  - 둘의 둘\n- 셋'),
    '<ul>\n<li>하나</li>\n<li>둘\n<ul>\n<li>둘의 하나</li>\n<li>둘의 둘</li>\n</ul></li>\n<li>셋</li>\n</ul>');
  assert.equal(md('1. 가\n2. 나\n   * 깊이\n3. 다'),
    '<ol>\n<li>가</li>\n<li>나\n<ul>\n<li>깊이</li>\n</ul></li>\n<li>다</li>\n</ol>');
  assert.equal(md('3. 셋부터'), '<ol start="3">\n<li>셋부터</li>\n</ol>');
  assert.equal(md('- 가\n\n- 나'), '<ul>\n<li><p>가</p></li>\n<li><p>나</p></li>\n</ul>');
  assert.equal(md('- 긴 항목\n이어지는 줄\n- 다음'), '<ul>\n<li>긴 항목\n이어지는 줄</li>\n<li>다음</li>\n</ul>');
  assert.equal(md('- **How to apply:**\n  - `git status` 확인\n\n문단'),
    '<ul>\n<li><strong>How to apply:</strong>\n<ul>\n<li><code>git status</code> 확인</li>\n</ul></li>\n</ul>\n<p>문단</p>');
});

test('펜스 코드 블록 안의 마크다운과 HTML 은 글자 그대로', () => {
  assert.equal(md('```sh\n# 제목 아님\n**굵게 아님** <b>x</b>\n```'),
    '<pre class="code"><code># 제목 아님\n**굵게 아님** &lt;b&gt;x&lt;/b&gt;</code></pre>');
  assert.equal(md('~~~~\n```\n안\n~~~~\n뒤'), '<pre class="code"><code>```\n안</code></pre>\n<p>뒤</p>');
  assert.equal(md('- 항목\n  ```\n  - 목록 아님\n  ```'), '<ul>\n<li>항목\n<pre class="code"><code>- 목록 아님</code></pre></li>\n</ul>');
  assert.equal(md('```\n닫히지 않음'), '<pre class="code"><code>닫히지 않음</code></pre>');
});

test('인용', () => {
  assert.equal(md('> 인용 **굵게**\n> 둘째 줄\n>\n> - 목록'),
    '<blockquote>\n<p>인용 <strong>굵게</strong>\n둘째 줄</p>\n<ul>\n<li>목록</li>\n</ul>\n</blockquote>');
});

test('GFM 표: 정렬은 클래스로, 칸 안의 \\| 와 인라인 문법', () => {
  assert.equal(md('| 마커 | 어디 |\n| :--- | ---: |\n| `a\\|b` | **굵게** |\n| 하나만 |'),
    '<div class="table-wrap"><table>\n<thead><tr><th class="al-l">마커</th><th class="al-r">어디</th></tr></thead>\n'
    + '<tbody>\n<tr><td class="al-l"><code>a|b</code></td><td class="al-r"><strong>굵게</strong></td></tr>\n'
    + '<tr><td class="al-l">하나만</td><td class="al-r"></td></tr>\n</tbody></table></div>');
  assert.equal(md('a | b\n--- | :-:\n1 | 2'),
    '<div class="table-wrap"><table>\n<thead><tr><th>a</th><th class="al-c">b</th></tr></thead>\n<tbody>\n<tr><td>1</td><td class="al-c">2</td></tr>\n</tbody></table></div>');
  assert.equal(md('| 표 아님 |\n그냥 줄'), '<p>| 표 아님 |\n그냥 줄</p>');
});

test('XSS: HTML 원문은 글자로 보인다', () => {
  const out = md('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n# <b onclick=alert(1)>제목</b>');
  assert.ok(!/<script|<img|<b /.test(out), out);
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(out.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
});

test('XSS: javascript:·data: 같은 주소는 링크가 되지 않고 글자로 남는다', () => {
  for (const target of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:x', '//evil.example.com/x', '/etc/passwd', 'file:///etc/passwd']) {
    const out = md(`[x](${target})`);
    assert.ok(!out.includes('<a '), `${target} → ${out}`);
    assert.ok(!/href=/.test(out), target);
  }
  assert.equal(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.ok(!md('![x](javascript:alert(1))').includes('<a '));
});

test('XSS: 링크 텍스트·주소·표 칸에서 따옴표로 속성을 벗어나지 못한다', () => {
  const a = md('[" onmouseover="alert(1)](https://x.test/"onmouseover="alert(1))');
  assert.equal(a, '<p><a href="https://x.test/&quot;onmouseover=&quot;alert(1)">&quot; onmouseover=&quot;alert(1)</a></p>');
  const b = md("[x](https://x.test/'><script>alert(1)</script>)");
  assert.ok(!b.includes('<script>'), b);
  assert.ok(b.includes('href="https://x.test/&#39;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'), b);
  const rel = md('[x](a"b.md)');
  assert.equal(rel, '<p><a href="/f/rules/base/a%22b.md">x</a></p>');
  const cell = md('| a |\n| --- |\n| "><script>alert(1)</script> |');
  assert.ok(!cell.includes('<script>'), cell);
  assert.ok(cell.includes('&quot;&gt;&lt;script&gt;'));
  const code = md('```"><script>x</script>\n```');
  assert.ok(!code.includes('<script>'), code);
});

test('상대 링크가 저장 경로 밖으로 나가면 글자로 남는다', () => {
  assert.equal(md('[x](../../../etc/passwd)'), '<p>[x](../../../etc/passwd)</p>');
  assert.equal(md('[x](../../etc)', 'rules/a.md'), '<p>[x](../../etc)</p>');
  assert.equal(md('[x](..)', 'a.md'), '<p>[x](..)</p>');
  assert.equal(md('[x](../../agents/a.md)'), '<p><a href="/f/agents/a.md">x</a></p>');
});

test('지원하지 않는 문법은 글자 그대로', () => {
  assert.equal(md('제목\n===\n\n<https://x.test>\n\n~~취소~~'), '<p>제목\n===</p>\n<p>&lt;https://x.test&gt;</p>\n<p>~~취소~~</p>');
});

test('frontmatter 를 떼어 칸으로 돌려준다', () => {
  const r = splitFrontmatter('---\nload: reference\nwhen: "커밋할 때"\ncategories: [backend, database]\ntools:\n  - Read\n  - Bash\n---\n\n# 본문\n');
  assert.deepEqual(r.fields, [
    { key: 'load', values: ['reference'] },
    { key: 'when', values: ['커밋할 때'] },
    { key: 'categories', values: ['backend', 'database'] },
    { key: 'tools', values: ['Read', 'Bash'] },
  ]);
  assert.equal(r.body, '\n# 본문\n');
  assert.deepEqual(splitFrontmatter('# 없음\n'), { fields: [], body: '# 없음\n' });
  assert.deepEqual(splitFrontmatter('---\n닫히지 않음\n'), { fields: [], body: '---\n닫히지 않음\n' });
});

test('첫 문장은 frontmatter·제목·표를 건너뛴 첫 문단에서 마크다운을 벗겨 뽑는다', () => {
  assert.equal(firstSentence('---\ncategories: [a]\n---\n\n# erdd 스택\n\nDB 스키마를 **ERDD**(`@erdd/cli`)로 설계하는 저장소에서 참인 규칙이다. 로컬 모드를 기본으로 둔다.\n'),
    'DB 스키마를 ERDD(@erdd/cli)로 설계하는 저장소에서 참인 규칙이다.');
  assert.equal(firstSentence('# 제목\n\n[링크](x.md) 를 본다\n둘째 줄'), '링크 를 본다 둘째 줄');
  assert.equal(firstSentence('# 제목만\n'), '');
});

test('깊은 중첩과 닫히지 않는 괄호가 많아도 빨리 끝나고 터지지 않는다', () => {
  const started = Date.now();
  assert.ok(md(`${'>'.repeat(20000)} 깊다`).includes('깊다'));
  assert.ok(md(`${'*a '.repeat(5000)}${'b*'.repeat(5000)}`).length > 0);
  assert.ok(md('['.repeat(50000)).length > 0);
  assert.ok(md(`${'**'.repeat(50000)}x`).length > 0);
  assert.ok(md('_a'.repeat(50000)).length > 0);
  assert.ok(md('`'.repeat(1) + 'a`'.repeat(1) + ' `x'.repeat(30000)).length > 0);
  assert.ok(Date.now() - started < 3000, `${Date.now() - started}ms`);
});
