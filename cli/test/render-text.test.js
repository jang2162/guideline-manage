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

const BAKKUM = '바꿈 절마다 제목 바로 아래 첫 줄에 ``바꾸는 절: `<스택>/<파일>` 「<## 절 제목>」`` 을 쓰고(파일 전체를 바꾸면 「」 를 뺀다), 그 아래에 이 프로젝트의 규칙을 쓴다. 바꿈이 사본보다 우선한다.';
const HEAD = [
  '# 공용 지침 관리', '',
  '이 프로젝트의 지침 일부는 지침 서버에서 받은 사본이다.', '',
  '- 사본은 직접 고치지 않는다: `.ruler/<스택>/NN-*.md`, `.ruler/<스택>/99-reference.md`, `docs/guideline/`, `guideline.json`·`guideline-lock.json`, 이 파일. 사본을 고쳐 원본에 올릴 것은 `guideline propose` 로, 새 지침은 `guideline-export` 스킬로 제안한다.',
  `- 이 프로젝트에만 다르게 할 것은 바꿈에 쓴다. 자리는 \`.ruler/<스택>/override.md\`, 파일이 여럿이면 \`.ruler/<스택>/override.d/*.md\` 다. ${BAKKUM}`,
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

test('docsReadme 는 한 문장이다', () => {
  assert.equal(docsReadme(), '이 디렉터리는 `guideline` CLI 가 지침 서버에서 받은 사본이다. 직접 고치지 않는다 — 지침을 맞출 때는 `guideline update` 를 쓰고, 원본에 올릴 것은 `guideline propose` 로 제안한다.\n');
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
