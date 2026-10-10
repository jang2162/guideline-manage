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
