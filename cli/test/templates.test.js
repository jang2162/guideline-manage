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

test('ko: 색인은 0.14 와 같고 관리 지침은 .guideline 배치를 말한다', t => {
  use(t, 'ko');
  assert.equal(indexText('base', [{ when: 'b 할 때', path: 'docs/guideline/base/01-b.md' }]),
    '# base 참조 지침\n\n아래 작업을 할 때는 **시작하기 전에** 그 파일을 읽는다. 이 규칙들은 상시 지침에 없다.\n\n| 언제 | 읽을 파일 |\n| --- | --- |\n| b 할 때 | `docs/guideline/base/01-b.md` |\n');
  assert.equal(managementText(), [
    '# 공용 지침 관리', '',
    '이 프로젝트의 지침 일부는 지침 서버에서 받은 사본이다.', '',
    '- 받은 사본은 `.guideline/` 에 있다(`.guideline/rules/<스택>/NN-*.md` 등). 사본과 `guideline.json`·`guideline-lock.json`, 이 파일은 직접 고치지 않는다. 사본을 고쳐 원본에 올릴 것은 `guideline propose` 로, 새 지침은 `guideline-export` 스킬로 제안한다.',
    '- `.ruler/` 의 지침 파일(`.ruler/<스택>/`, `.ruler/guideline.md`, `.ruler/skills/`)과 `docs/guideline/`, `.ruler/ruler.toml` 은 `guideline apply` 가 `.guideline/` 에서 만든 생성물이라 `.gitignore` 에 들어 있다. 거기서 고친 것은 다음 `guideline apply` 때 덮이므로 그 폴더에 프로젝트 파일을 두지 않는다. 프로젝트에만 쓰는 규칙은 `.ruler/*.md`(예: `.ruler/50-project.md`)나 바꿈에 둔다.',
    '- 이 프로젝트에만 다르게 할 것은 바꿈에 쓴다. 자리는 `.guideline/overrides/<스택 경로>/override.md`(하위 스택은 `.guideline/overrides/<부모>/<자식>/override.md`), 파일이 여럿이면 `.guideline/overrides/<스택 경로>/override.d/*.md` 다. 바꿈 절마다 제목 바로 아래 첫 줄에 ``바꾸는 절: `<스택>/<파일>` 「<## 절 제목>」`` 을 쓰고(파일 전체를 바꾸면 「」 를 뺀다), 그 아래에 이 프로젝트의 규칙을 쓴다. 바꿈이 사본보다 우선한다.',
    '- 이 프로젝트의 ruler 설정(에이전트, 출력 경로, 프로젝트가 직접 쓴 MCP 서버)은 `.ruler/ruler.project.toml` 에 둔다. `guideline apply` 가 그 파일과 받은 MCP 서버로 `.ruler/ruler.toml` 을 만든다.',
    '- 새로 클론했거나 새 워크트리를 만든 직후에는 `guideline apply` 를 돌려(서버가 필요 없다) 생성물을 만든다.',
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

test('안내 템플릿: 사본은 .guideline/, 생성물은 apply 가 만든다고 하고, 사라진 할 일 종류를 안내하지 않는다', t => {
  const KINDS = ['apply', 'root-apply', 'no-copy', 'override-unchosen', 'mcp-conflict', 'untracked', 'stray-ruler-output', 'migrated', 'manifest-v3', 'prepare', 'dev-dependency', 'apply-hook'];
  for (const lang of ['en', 'ko']) {
    use(t, lang);
    const llms = currentLocale().template('llms.txt', { SERVER: 'http://s' });
    const sync = currentLocale().template('skills/guideline-sync/SKILL.md');
    const exp = currentLocale().template('skills/guideline-export/SKILL.md');
    const mgmt = managementText();
    for (const [name, text] of [['llms.txt', llms], ['guideline-sync', sync]]) {
      for (const kind of KINDS) assert.ok(text.includes(`\`${kind}\``), `${lang} ${name}: ${kind}`);
      assert.doesNotMatch(text, /`mcp-local`|`moved`|`new-file`/, `${lang} ${name}`);
      assert.ok(text.includes('guideline apply'), `${lang} ${name}`);
      assert.ok(text.includes('.ruler/ruler.project.toml'), `${lang} ${name}`);
      assert.ok(text.includes('.guideline/overrides/'), `${lang} ${name}`);
    }
    assert.ok(mgmt.includes('.guideline/overrides/<') && mgmt.includes('.guideline/rules/<') && mgmt.includes('guideline apply') && mgmt.includes('.ruler/ruler.project.toml'), lang);
    assert.ok(exp.includes('.guideline/overrides/<') && exp.includes('.ruler/ruler.project.toml'), lang);
    assert.ok(!exp.includes('.ruler/<stack>/override.md') && !exp.includes('.ruler/<스택>/override.md'), lang);
    assert.ok(docsReadme().includes('guideline apply') && docsReadme().includes('.guideline/'), lang);
  }
});

// 개인 범위: 안내 템플릿 두 벌이 pick --local 흐름과 새 할 일을 다루고, 개인 세팅은 커밋되는 파일을 바꾸지 않는다고 시킨다.
const PERSONAL_KINDS = ['setup-personal', 'personal-ignored', 'personal-shadowed', 'personal-revision', 'personal-sync', 'local-bad', 'ruler-leftover', 'override-target', 'unit-write-failed'];

test('안내 템플릿: 개인 범위의 pick --local·추천 모양·새 할 일과 scope 를 다룬다', t => {
  for (const lang of ['en', 'ko']) {
    use(t, lang);
    const llms = currentLocale().template('llms.txt', { SERVER: 'http://s' });
    const sync = currentLocale().template('skills/guideline-sync/SKILL.md');
    for (const [name, text] of [['llms.txt', llms], ['guideline-sync', sync]]) {
      for (const kind of PERSONAL_KINDS) assert.ok(text.includes(`| \`${kind}\` |`), `${lang} ${name}: ${kind} 행`);
      for (const want of ['guideline pick --local', '--recommend', '{"add": {', '"remove": {', 'scope: "personal"', lang === 'en' ? '<git common dir>' : '<git 공용 디렉터리>', 'info/exclude']) {
        assert.ok(text.includes(want), `${lang} ${name}: ${want}`);
      }
      // 개인 세팅 행은 커밋되는 파일을 바꾸지 않고 바꿔야 하는 단계를 알리라고 시킨다
      const row = text.split('\n').find(l => l.startsWith('| `setup-personal` |'));
      assert.match(row, lang === 'en' ? /do not change committed files/ : /커밋되는 파일[^|]*바꾸지 않/, `${lang} ${name}`);
      assert.match(row, lang === 'en' ? /tell the user/ : /사용자에게 알린/, `${lang} ${name}`);
      // 루트 단위 할 일은 apply 만이 아니라 update·pick·pick --local 도 낸다
      for (const kind of ['unit-update', 'unit-problem', 'unit-write-failed']) {
        assert.match(text.split('\n').find(l => l.startsWith(`| \`${kind}\` |`)), /pick --local/, `${lang} ${name}: ${kind}`);
      }
    }
  }
});
