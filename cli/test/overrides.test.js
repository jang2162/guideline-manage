import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overrideRows, headings } from '../src/overrides.js';

const README = rows => `# orca 스택\n\n설명\n\n## 다른 스택을 바꾸는 것\n\n| 이 스택의 절 | 바꾸는 절 |\n| --- | --- |\n${rows.join('\n')}\n\n## 여기 없는 것\n\n| 가 | 나 |\n| --- | --- |\n| x | y |\n`;

test('overrideRows 는 표가 없으면 빈 배열이다', () => {
  assert.deepEqual(overrideRows('# orca\n\n## 여기 없는 것\n'), []);
  assert.deepEqual(overrideRows(''), []);
});

test('overrideRows 는 행마다 from·to 의 파일과 절 제목을 읽는다', () => {
  const text = README([
    '| `05-switch.md` 「Orca 가 살아 있으면 워크트리도 Orca 로 만든다」 | `base/01-git.md` 「워크트리는 저장소 안에 만들고, 하나의 작업이 하나를 갖는다」 |',
    '|`06-x.md`「가」|`base/02-y.md`  「나」|',
  ]);
  assert.deepEqual(overrideRows(text), [
    {
      from: { file: '05-switch.md', title: 'Orca 가 살아 있으면 워크트리도 Orca 로 만든다' },
      to: { stack: 'base', file: '01-git.md', title: '워크트리는 저장소 안에 만들고, 하나의 작업이 하나를 갖는다' },
    },
    { from: { file: '06-x.md', title: '가' }, to: { stack: 'base', file: '02-y.md', title: '나' } },
  ]);
});

test('overrideRows 는 바뀌는 쪽의 스택 경로를 마지막 조각 앞까지로 읽는다', () => {
  const rows = overrideRows(README(['| `00-a.md` 「A」 | `browser/x/01-b.md` 「B」 |', '| `00-a.md` 「A」 | `a/b/c/01-d.md` 「D」 |']));
  assert.deepEqual(rows[0].to, { stack: 'browser/x', file: '01-b.md', title: 'B' });
  assert.deepEqual(rows[1].to, { stack: 'a/b/c', file: '01-d.md', title: 'D' });
  assert.deepEqual(rows[0].from, { file: '00-a.md', title: 'A' });
});

test('overrideRows 는 이쪽 셀에 경로가 있거나 바뀌는 셀 경로의 조각이 비면 error 다', () => {
  for (const row of ['| `x/00-a.md` 「A」 | `browser/01-b.md` 「B」 |', '| `00-a.md` 「A」 | `browser//01-b.md` 「B」 |', '| `00-a.md` 「A」 | `/01-b.md` 「B」 |']) {
    assert.deepEqual(overrideRows(README([row])), [{ error: row }], row);
  }
});

test('overrideRows 는 읽을 수 없는 행을 error 로 돌려준다', () => {
  const bad = [
    '| `05-switch.md` 「가」 |',
    '| 05-switch.md 「가」 | `base/01-git.md` 「나」 |',
    '| `orca/05-switch.md` 「가」 | `base/01-git.md` 「나」 |',
    '| `05-switch.md` 「가」 | `01-git.md` 「나」 |',
    '| `05-switch.md` 「가」 | `base/01-git.md` 나 |',
    '| `05-switch.md` 「」 | `base/01-git.md` 「나」 |',
  ];
  for (const row of bad) {
    assert.deepEqual(overrideRows(README([row])), [{ error: row }], row);
  }
});

test('headings 는 코드 블록 밖의 ## 제목만 글자 그대로 모은다', () => {
  const text = '---\nload: always\n---\n\n# 제목\n\n## 첫 절  \n\n```markdown\n## 예시 안의 제목\n```\n\n### 하위\n\n## 둘째 절\n';
  assert.deepEqual([...headings(text)], ['첫 절', '둘째 절']);
});

test('overrideRows 는 셀의 절 제목 앞에 붙은 `## ` 를 뗀다', () => {
  const text = '# orca\n\n## 다른 스택을 바꾸는 것\n\n| 이 스택 | 바꾸는 절 |\n| --- | --- |\n| `05-switch.md` 「## 바꾸는 절」 | `base/00-alpha.md` "## 기본 절" |\n';
  assert.deepEqual(overrideRows(text), [
    { from: { file: '05-switch.md', title: '바꾸는 절' }, to: { stack: 'base', file: '00-alpha.md', title: '기본 절' } },
  ]);
});
