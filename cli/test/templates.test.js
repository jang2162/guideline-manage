import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, setLocale, currentLocale } from '../src/i18n.js';
import { managementText, indexText, docsReadme } from '../src/render/text.js';

// 도구가 처음 만들어 주는 지침. 영어판에는 한글이 없고 영어 표지를 안내한다. 한국어판은 지금 문장 그대로다.

const HANGUL = /[가-힣]/;
const TEMPLATES = ['management.md', 'llms.txt', 'authoring.md', 'skills/guideline-sync/SKILL.md', 'skills/guideline-export/SKILL.md',
  'new-file/readme.md', 'new-file/rule.md', 'new-file/setup.md', 'new-file/skill.md', 'new-file/agent.md', 'new-file/mcp.md'];

function use(t, lang) {
  const prev = currentLocale();
  setLocale(createI18n({ lang, env: {} }));
  t.after(() => setLocale(prev));
}

test('en: 관리 지침·색인·README 와 모든 템플릿에 한글이 없다', t => {
  use(t, 'en');
  const texts = {
    management: managementText({ setupStacks: ['base'], stackSource: { base: 'a' }, additions: [{ source: 'a', text: '# x\n\n## y\n\nz\n' }] }),
    index: indexText('base', [{ when: 'when b', path: 'docs/guideline/base/01-b.md' }]),
    readme: docsReadme(),
  };
  for (const name of TEMPLATES) texts[name] = currentLocale().template(name, { SERVER: 'http://s' });
  for (const [name, text] of Object.entries(texts)) {
    const bad = text.split('\n').filter(l => HANGUL.test(l));
    assert.deepEqual(bad, [], name);
  }
});

test('en: 관리 지침과 작성 규칙은 영어 표지를 안내한다', t => {
  use(t, 'en');
  assert.match(managementText(), /Overrides: `<stack>\/<file>` "<## section title>"/);
  const authoring = currentLocale().template('authoring.md');
  assert.ok(authoring.includes('## Overrides of other stacks'));
  assert.ok(authoring.includes('## Build on apply'));
});

test('ko: 관리 지침·색인은 0.14 와 같다', t => {
  use(t, 'ko');
  assert.equal(indexText('base', [{ when: 'b 할 때', path: 'docs/guideline/base/01-b.md' }]),
    '# base 참조 지침\n\n아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.\n\n| 언제 | 읽을 파일 |\n| --- | --- |\n| b 할 때 | `docs/guideline/base/01-b.md` |\n');
  assert.equal(managementText(), [
    '# 공용 지침 관리', '',
    '이 프로젝트의 지침 일부는 지침 서버에서 받은 사본이다.', '',
    '- 사본은 직접 고치지 않는다: `.ruler/<스택>/NN-*.md`, `.ruler/<스택>/99-reference.md`, `docs/guideline/`, `guideline.json`·`guideline-lock.json`, 이 파일. 사본을 고쳐 원본에 올릴 것은 `guideline propose` 로, 새 지침은 `guideline-export` 스킬로 제안한다.',
    '- 이 프로젝트에만 다르게 할 것은 바꿈에 쓴다. 자리는 `.ruler/<스택>/override.md`, 파일이 여럿이면 `.ruler/<스택>/override.d/*.md` 다. 바꿈 절마다 제목 바로 아래 첫 줄에 ``바꾸는 절: `<스택>/<파일>` 「<## 절 제목>」`` 을 쓰고(파일 전체를 바꾸면 「」 를 뺀다), 그 아래에 이 프로젝트의 규칙을 쓴다. 바꿈이 사본보다 우선한다.',
    '- 지침을 최신으로 맞출 때는 `guideline status` 로 보고 `guideline update` 를 쓴다(에이전트는 `guideline-sync` 스킬).',
    '',
  ].join('\n'));
  const multi = managementText({ setupStacks: ['base'], stackSource: { base: 'a' }, additions: [{ source: 'a', text: '# x\n\n## y\n\nz\n' }] });
  assert.ok(multi.includes('`guideline propose` 로(그 항목이 온 출처로 제안된다)'));
  assert.ok(multi.includes('\n- 프로젝트를 세팅할 때(그 스택을 처음 받았을 때, 새로 클론했을 때, 세팅이 맞는지 의심될 때)는 아래 문서를 읽고 따른다. 스택을 고른 것은 그 기술을 이 프로젝트에 들이기로 한 결정이다. 프로젝트가 아직 그 기술을 쓰지 않는다는 이유로 세팅을 건너뛰지 않는다 — 세팅이 바로 그 기술을 들이는 단계다. 세팅할 수 없으면(권한, 사람이 앱에서 해야 하는 설정 등) 건너뛰지 말고 사용자에게 알린다.\n\n| 스택 | 출처 | 세팅 문서 |\n| --- | --- | --- |\n| base | a | `docs/guideline/base/SETUP.md` |\n'));
  assert.ok(multi.endsWith('\n## a 추가 지침\n\n### y\n\nz\n'));
});

test('템플릿: llms.txt 의 JSON 예시 중괄호는 남고 {{SERVER}} 는 채워진다', t => {
  for (const lang of ['en', 'ko']) {
    use(t, lang);
    const text = currentLocale().template('llms.txt', { SERVER: 'http://srv' });
    assert.ok(!text.includes('{{SERVER}}'), lang);
    assert.ok(text.includes('http://srv'), lang);
    assert.match(text, /"sources": \{/, lang);
  }
});
