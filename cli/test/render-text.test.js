import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexText, managementText, docsReadme } from '../src/render/text.js';

test('indexText 는 0.10 색인 모양이고 언제의 | 를 이스케이프한다', () => {
  const rows = [{ when: '배포 | 할 때', path: 'docs/guideline/x/00-a.md' }];
  assert.equal(indexText('x', rows), [
    '# x 참조 지침', '',
    '아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.', '',
    '| 언제 | 읽을 파일 |', '| --- | --- |',
    '| 배포 \\| 할 때 | `docs/guideline/x/00-a.md` |', '',
  ].join('\n'));
});

const BAKKUM = '바꿈 절마다 제목 바로 아래 첫 줄에 ``바꾸는 절: `<스택>/<파일>` 「<절 제목>」`` 을 쓰고(파일 전체를 바꾸면 「」 를 뺀다. 절 제목은 원본의 `## ` 뒤를 글자 그대로 옮긴다), 그 아래에 이 프로젝트의 규칙을 쓴다. 바꿈이 사본보다 우선한다.';
const HEAD = [
  '# 공용 지침 관리', '',
  '이 프로젝트의 지침 일부는 지침 서버에서 받은 사본이다.', '',
  '- 받은 사본은 `.guideline/` 에 있다(`.guideline/rules/<스택>/NN-*.md` 등). 사본과 `guideline.json`·`guideline-lock.json`, 이 파일은 직접 고치지 않는다. 사본을 고쳐 원본에 올릴 것은 `guideline propose` 로, 새 지침은 `guideline-export` 스킬로 제안한다.',
  '- `.ruler/` 의 지침 파일(`.ruler/<스택>/`, `.ruler/guideline.md`, `.ruler/skills/`)과 `docs/guideline/`, `.ruler/ruler.toml` 은 `guideline apply` 가 `.guideline/` 에서 만든 생성물이라 `.gitignore` 에 들어 있다. 거기서 고친 것은 다음 `guideline apply` 때 덮이므로 그 폴더에 프로젝트 파일을 두지 않는다. 프로젝트에만 쓰는 규칙은 `.ruler/*.md`(예: `.ruler/50-project.md`)나 바꿈에 둔다.',
  `- 이 프로젝트에만 다르게 할 것은 바꿈에 쓴다. 자리는 \`.guideline/overrides/<스택 경로>/override.md\`(하위 스택은 \`.guideline/overrides/<부모>/<자식>/override.md\`), 파일이 여럿이면 \`.guideline/overrides/<스택 경로>/override.d/*.md\` 다. ${BAKKUM}`,
  '- 이 프로젝트의 ruler 설정(에이전트, 출력 경로, 프로젝트가 직접 쓴 MCP 서버)은 `.ruler/ruler.project.toml` 에 둔다. `guideline apply` 가 그 파일과 받은 MCP 서버로 `.ruler/ruler.toml` 을 만든다.',
  '- 새로 클론했거나 새 워크트리를 만든 직후에는 `guideline apply` 를 돌려(서버가 필요 없다) 생성물을 만든다.',
  '- 지침을 최신으로 맞출 때는 `guideline status` 로 보고 `guideline update` 를 쓴다(에이전트는 `guideline-sync` 스킬).',
];

test('managementText — 세팅 문서 있음', () => {
  assert.equal(managementText({ setupStacks: ['mise', 'erdd'] }), [
    ...HEAD,
    '- 프로젝트를 세팅할 때(그 스택을 처음 받았을 때, 새로 클론했을 때, 세팅이 맞는지 의심될 때)는 아래 문서를 읽고 따른다. 스택을 고른 것은 그 기술을 이 프로젝트에 들이기로 한 결정이다. 프로젝트가 아직 그 기술을 쓰지 않는다는 이유로 세팅을 건너뛰지 않는다 — 세팅이 바로 그 기술을 들이는 단계다. 세팅할 수 없으면(권한, 사람이 앱에서 해야 하는 설정 등) 건너뛰지 말고 사용자에게 알린다.', '',
    '| 스택 | 세팅 문서 |', '| --- | --- |',
    '| erdd | `docs/guideline/erdd/SETUP.md` |',
    '| mise | `docs/guideline/mise/SETUP.md` |', '',
  ].join('\n'));
});

test('managementText — 세팅 문서 없음', () => {
  assert.equal(managementText({ setupStacks: [] }), [...HEAD, ''].join('\n'));
});

test('docsReadme 는 생성물이라는 것과 고칠 자리(.guideline)를 말한다', () => {
  assert.equal(docsReadme(), '이 디렉터리는 `guideline apply` 가 `.guideline/` 의 사본으로 만든 생성물이라 다음 apply 때 다시 쓰인다. 직접 고치지 않는다 — `.guideline/` 의 사본을 고치고(원본에 올릴 것은 `guideline propose` 로 제안), 지침을 맞출 때는 `guideline update` 를 쓴다.\n');
});

test('관리 지침: 출처가 하나면 지금과 같고, 출처 열은 stackSource 가 있을 때만', () => {
  assert.equal(managementText({ setupStacks: ['mise'] }), managementText({ setupStacks: ['mise'], stackSource: null, additions: [] }));
  const t = managementText({ setupStacks: ['company-base', 'mise'], stackSource: { 'company-base': 'company', mise: 'personal' } });
  assert.match(t, /\| 스택 \| 출처 \| 세팅 문서 \|/);
  assert.match(t, /\| company-base \| company \| `docs\/guideline\/company-base\/SETUP\.md` \|/);
  assert.match(t, /`guideline propose` 로\(그 항목이 온 출처로 제안된다\)/);
});

test('관리 지침: 출처의 추가 절은 출처 이름순으로 붙고 제목이 한 단계 내려간다', () => {
  const t = managementText({ additions: [
    { source: 'personal', text: '# 무시\n\n## 규칙\n\n본문 P\n' },
    { source: 'company', text: '## 보안\n\n```\n## 코드 안\n```\n' },
  ] });
  assert.ok(t.indexOf('## company 추가 지침') < t.indexOf('## personal 추가 지침'));
  assert.match(t, /## company 추가 지침\n\n### 보안\n\n```\n## 코드 안\n```\n/);
  assert.match(t, /## personal 추가 지침\n\n### 규칙\n\n본문 P\n/);
  assert.doesNotMatch(t, /무시/);
});

test('managementText — 개인 절과 세팅 표의 개인 행', () => {
  const personal = {
    added: [{ key: 'rules/mise', source: null }, { key: 'rules/erdd', source: null }],
    removed: [{ key: 'skills/s', source: null }],
    ignored: [{ key: 'rules/base', source: null, why: 'required' }, { key: 'rules/gone', source: null, why: 'no-effect' }],
    stacks: ['mise'],
  };
  assert.equal(managementText({ setupStacks: ['mise', 'base'], personal }), [
    ...HEAD,
    '- 프로젝트를 세팅할 때(그 스택을 처음 받았을 때, 새로 클론했을 때, 세팅이 맞는지 의심될 때)는 아래 문서를 읽고 따른다. 스택을 고른 것은 그 기술을 이 프로젝트에 들이기로 한 결정이다. 프로젝트가 아직 그 기술을 쓰지 않는다는 이유로 세팅을 건너뛰지 않는다 — 세팅이 바로 그 기술을 들이는 단계다. 세팅할 수 없으면(권한, 사람이 앱에서 해야 하는 설정 등) 건너뛰지 말고 사용자에게 알린다.', '',
    '| 스택 | 세팅 문서 |', '| --- | --- |',
    '| base | `docs/guideline/base/SETUP.md` |',
    '| mise (개인) | `docs/guideline/mise/SETUP.md` |', '',
    '## 이 작업자의 개인 범위', '',
    '이 작업자는 프로젝트 선택 위에 아래 개인 선택을 얹었다. 개인 선택은 이 작업자의 git 저장소에만 있고 커밋되지 않는다. 개인 범위에서만 나온 생성물은 `.gitignore` 가 아니라 git 의 `info/exclude` 에 적힌다.', '',
    '- 더한 것: `rules/erdd`, `rules/mise`',
    '- 뺀 것: `skills/s`',
    '- 무시된 뺌: `rules/base` (필수라 뺄 수 없음), `rules/gone` (뺄 것이 없음)',
    '- 개인 범위 스택(세팅 표에서 「개인」 표시)의 세팅은 세팅 문서를 따르되 커밋되는 파일을 바꾸지 않는다. 바꿔야 하는 단계(커밋되는 설정 파일, `.gitignore` 등)는 건너뛰지 말고 사용자에게 알린다.', '',
  ].join('\n'));
  // 더한 것만 있으면 그 줄과 세팅 규칙만
  const only = managementText({ personal: { added: [{ key: 'rules/x', source: 'team' }], removed: [], ignored: [], stacks: [] } });
  assert.ok(only.endsWith('\n\n- 더한 것: `rules/x` (team)\n- 개인 범위 스택(세팅 표에서 「개인」 표시)의 세팅은 세팅 문서를 따르되 커밋되는 파일을 바꾸지 않는다. 바꿔야 하는 단계(커밋되는 설정 파일, `.gitignore` 등)는 건너뛰지 말고 사용자에게 알린다.\n'), only);
});
