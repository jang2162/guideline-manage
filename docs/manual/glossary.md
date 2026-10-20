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
| copy | 사본 | A source file written into a project |
| stack | 스택 | A group of rule files under `rules/<stack>/` |
| domain stack | 도메인 스택 | A stack named `<tool>__<domain>` |
| block | 블록 | One stack, skill, subagent or MCP server |
| skill | 스킬 | |
| subagent | 서브에이전트 | |
| MCP server | MCP 서버 | |
| always-on guideline | 상시 지침 | |
| reference guideline | 참조 지침 | |
| index | 색인 | `.ruler/<stack>/99-reference.md` |
| management guideline | 관리 지침 | `.ruler/guideline.md` |
| setup doc | 세팅 문서 | `docs/guideline/<stack>/SETUP.md` |
| authoring rules | 작성 규칙 | `docs/authoring.md` on the server |
| seed | 씨앗 | What an empty server gets as revision 1 |
| revision | 리비전 | |
| proposal | 제안 | |
| override | 바꿈 | `.ruler/<stack>/override.md`, `override.d/*.md` |
| to-do | 할 일 | |
| form (pick form) | 폼 | |
| display name | 표시 이름 | `label` |
| category | 분류 | `categories` |
| required blocks | 필요한 블록 | `requires` |
| alias | 별칭 | `aliases` in `guideline.json` |
| unit directory | 단위 디렉터리 | A directory with `.ruler/` |
| manifest | 매니페스트 | `guideline.json` |
| lock | 잠금 | `guideline-lock.json` |
| admin token | 관리자 토큰 | `ADMIN_TOKEN` |
| read token | 읽기 토큰 | |
| scope | 범위 | `read`, `propose`, `admin` |
| public read | 공개 읽기 | `PUBLIC_READ` |
| language pack | 언어팩 | |
| marker | 표지 문구 | |
| admin web | 관리자 웹 | |
