# Glossary · 용어 대응표

English terms in the source documents and the Korean words the translations use for them.
Product names, commands, file names, setting keys and code stay untranslated.

영어 원본의 용어와 한국어 번역본에서 쓰는 말의 대응표입니다. 제품 이름·명령·파일 이름·설정 키·코드는 번역하지 않습니다.

| English | 한국어 | Note · 설명 |
| --- | --- | --- |
| guideline server | 지침 서버 | The server that holds the source (`guideline-server`) |
| source (guideline content) | 원본 | The guidelines held on a server. `guideline source`, `propose --from` |
| source (a server entry) | 출처 | A named server in `guideline.json`, chosen with `--source <name>` |
| source (of a revision) | 생성 경로 | How a revision was made: `import`, `web`, `revert`, `proposal`, `seed` |
| copy | 사본 | A source file written into a project, in `.guideline/` |
| generated files | 생성물 | What `guideline apply` composes from `.guideline/` for ruler (`.ruler/<stack>/`, `docs/guideline/` …). Git-ignored |
| stack | 스택 | A group of rule files under `rules/<stack>/` |
| domain stack | 도메인 스택 | A stack named `<tool>__<domain>` |
| block | 블록 | One stack, skill, subagent or MCP server |
| block key | 블록 키 | `rules/<stack path>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>`. `items` of `guideline.json` |
| child stack | 하위 스택 | A stack in a folder inside another stack's folder (`browser/browseros-neo`) |
| bundle stack | 묶음 스택 | A stack that holds only child stacks, no guideline files of its own |
| ancestor | 조상 | The parents of a child stack, up to the top-level stack. Choosing a child stack chooses them |
| skill | 스킬 | |
| subagent | 서브에이전트 | |
| MCP server | MCP 서버 | |
| always-on guideline | 상시 지침 | |
| reference guideline | 참조 지침 | |
| index | 색인 | `.ruler/<stack>/99-reference.md` (generated) |
| management guideline | 관리 지침 | `.ruler/guideline.md` |
| setup doc | 세팅 문서 | `.guideline/rules/<stack>/SETUP.md`, generated into `docs/guideline/<stack>/SETUP.md` |
| authoring rules | 작성 규칙 | `docs/authoring.md` on the server |
| seed | 씨앗 | What an empty server gets as revision 1 |
| revision | 리비전 | |
| proposal | 제안 | |
| override | 바꿈 | `.guideline/overrides/<stack path>/override.md`, `override.d/*.md` |
| to-do | 할 일 | |
| form (pick form) | 폼 | |
| display name | 표시 이름 | `label` |
| category | 분류 | `categories` |
| required blocks | 필요한 블록 | `requires`. Not the same as Required (`required`) |
| Required (block) | 필수 (블록) | `required` of a source in `guideline.json`: a chosen block that nobody can remove in a personal selection |
| alias | 별칭 | `aliases` in `guideline.json` |
| unit directory | 단위 디렉터리 | A directory with `.ruler/` |
| manifest | 매니페스트 | `guideline.json` |
| lock | 잠금 | `guideline-lock.json` |
| personal scope | 개인 범위 | What one worker adds to or removes from the project's choice with `guideline pick --local`. Never committed |
| personal selection | 개인 선택 | `local.json` in `<git common dir>/guideline/units/<unit key>/` |
| personal copy | 개인 사본 | A copy received for the personal scope, kept in the git common directory |
| machine defaults | 머신 기본값 | `defaults.json` in the CLI's config folder: pre-checks the personal form, per server |
| git common directory | git 공용 디렉터리 | The `.git` folder that all worktrees of a clone share (`git rev-parse --git-common-dir`) |
| admin token | 관리자 토큰 | `ADMIN_TOKEN` |
| read token | 읽기 토큰 | |
| scope | 범위 | `read`, `propose`, `admin` |
| public read | 공개 읽기 | `PUBLIC_READ` |
| language pack | 언어팩 | |
| marker | 표지 문구 | |
| admin web | 관리자 웹 | |
