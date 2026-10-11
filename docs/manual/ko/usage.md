# 명령 레퍼런스

[English](../usage.md) · 한국어

`guideline` 명령의 옵션, 환경 변수, 종료 코드를 정리한다. 처음 쓰는 순서는 [guide.md](guide.md).

## 환경 변수

| 이름 | 뜻 |
| --- | --- |
| `GUIDELINE_SERVER` | 지침 서버 주소. `--server` 와 프로젝트의 `guideline.json` 이 없을 때 쓴다 |
| `GUIDELINE_TOKEN` | 저장한 토큰 대신 쓸 토큰(CI 등). 출처가 하나일 때만 쓴다 |
| `GUIDELINE_LANG` | CLI 메시지와 프로젝트에 쓰는 글(관리 지침, 색인)의 언어. 기본 `en`, 한국어는 `ko`. 없으면 CLI 는 `~/.config/guideline/config.json` 의 `lang`(`{ "lang": "ko" }`)을 읽는다 |
| `GUIDELINE_LOCALES_DIR` | 사용자 언어팩 폴더. 없으면 `$XDG_CONFIG_HOME/guideline/locales`, 그것도 없으면 `~/.config/guideline/locales` |
| `GUIDELINE_PROJECTS_DIR` | `pick --new <이름>` 이 프로젝트를 만들 상위 폴더 |

토큰은 `~/.config/guideline/credentials.json`(권한 600)에 서버마다 저장된다.

## 프로젝트 명령

모두 단위 디렉터리(`.ruler/` 가 있는 곳)에서 실행한다. 공통 옵션: `--project <경로>`(기본: 현재 디렉터리), `--server <URL>`, `--source <이름>`(출처가 여럿일 때 하나만), `--json`.

| 명령 | 하는 일 |
| --- | --- |
| `guideline pick` | 서버 폼을 열고, 제출하면 고른 항목을 반영한다. `--new <이름\|경로>` 는 새 프로젝트를 만들고(`git init`) 반영한다. `--no-browser` 는 주소만 낸다. `--recommend <파일\|->` 는 에이전트가 고른 블록(JSON `{"블록 키": "이유"}`)을 미리 체크한 폼을 연다 — 출처 하나일 때만(여럿이면 `--source`). 0.19 이상 서버가 필요하다 — 옛 서버는 추천 없이 폼을 연다 |
| `guideline update` | 고른 항목 그대로 서버 최신으로 다시 반영한다. 프로젝트에서 고친 파일은 건너뛰고, `--force` 면 덮어쓴다 |
| `guideline status` | 반영한 지침이 최신인지, 프로젝트에서 고친 것이 있는지 본다 |
| `guideline propose` | 고친 사본을 원본 모양으로 되돌려 제안한다. `--dry-run`, `--title`, `--message`, `--only <항목,…>`, `--from <폴더>` |
| `guideline login` / `logout` | 서버에 로그인해 토큰을 저장하거나 지운다. `--token-stdin` 은 브라우저 없이 토큰을 넣는다 |

`pick`·`update` 는 쓴 파일, 지운 파일, **할 일**을 낸다. 할 일 종류는 서버의 `/llms.txt` 「에이전트가 할 일」 표에 있다.

## 원본 명령

| 명령 | 하는 일 |
| --- | --- |
| `guideline source <폴더>` | 서버 최신 원본을 빈 폴더에 푼다. 원본 경로로 고친 뒤 `propose --from <폴더>` 로 올린다 |
| `guideline list [폴더]` | 원본 목록과 검사 결과. 폴더를 주면 그 폴더(`source` 로 받은 원본)를, 아니면 서버를 읽는다 |

`list` 는 스택(지침 파일과 칸, 스택 사이 바꿈), 스킬, 서브에이전트, MCP 서버를 보이고, 규칙에 맞지 않아 빠지는 파일(무시됨)과 고칠 것(경고)을 이유와 함께 보인다. 경고가 있어도 종료 코드는 0 이다. 쓰는 규칙은 원본의 `docs/authoring.md`.

## 언어팩 명령

| 명령 | 하는 일 |
| --- | --- |
| `guideline locale list` | 쓸 수 있는 언어(패키지·사용자 폴더)와 지금 설정 |
| `guideline locale check <폴더>` | 언어팩 폴더를 정본(`en`)과 비교한다. 빠진 키·남는 키·자리 표시가 다른 키·빠진 템플릿·`pack.json` 문제 |

언어팩 만드는 법은 [locales.md](locales.md).

## 종료 코드

| 코드 | 뜻 |
| --- | --- |
| 0 | 성공 |
| 1 | 실행 실패(서버에 닿지 못함, 권한 없음, 쓰기 실패, 언어팩 문제 등). 출처 하나가 실패하고 나머지는 반영됐을 때도 1 |
| 2 | 잘못된 사용, ruler 프로젝트가 아님, 이름 겹침 |
| 3 | `pick`: 제출하지 않음(취소, 탭 닫힘, 아무도 열지 않음). 아무것도 쓰지 않았다 |

## 0.15 로 옮기기

- **기본 언어가 영어가 됐다.** 한국어를 계속 쓰려면 셸에 `GUIDELINE_LANG=ko` 를, 서버 환경에도 `GUIDELINE_LANG=ko` 를 둔다. 두지 않으면 다음 `update` 에서 관리 지침(`.ruler/guideline.md`)과 색인(`99-reference.md`)이 영어로 다시 써진다.
- **0.10 의 문서 저장소 명령이 없어졌다.** `init`, 문서 저장소 안에서의 `pick`·`update`, 문서 저장소용 관리 스킬이 사라졌다. 원본은 지침 서버에만 있다. 옛 문서 저장소 클론을 서버로 옮기려면 `GUIDELINE_SEED=off` 로 빈 서버를 띄우고, 클론의 `rules/`·`skills/`·`agents/`·`mcp/`·`docs/authoring.md` 를 관리자 토큰으로 `POST /api/v1/proposals` 에 `apply: true` 로 올린다.
- **원본 폴더 검사**는 `guideline list <폴더>` 다(현재 폴더를 저절로 원본으로 보지 않는다).
- 사람이 쓴 지침의 표지 문구는 영어(`## Overrides of other stacks`, ``Overrides: `<스택>/<파일>` "<절 제목>"``, `## Build on apply`)와 한국어(`## 다른 스택을 바꾸는 것`, ``바꾸는 절: …``, `## 반영할 때 항목 만들기`)를 둘 다 읽는다. 기존 지침은 고치지 않아도 된다.
