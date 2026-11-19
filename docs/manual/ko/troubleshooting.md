<!-- source: docs/manual/en/troubleshooting.md @ v0.24.0 -->
[English](../en/troubleshooting.md) | **한국어**

# 문제 해결

오류 메시지와 증상을 원인·해결과 함께 모았습니다.
막힌 CLI 사용자와 서버 운영자를 위한 문서입니다.

## CLI

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| `서버 주소 없음` | CLI 가 어느 서버를 쓸지 모릅니다 | `--server <URL>` 을 주거나 `GUIDELINE_SERVER` 를 설정하세요 |
| `로그인 필요: guideline login --server …` | 토큰이 없거나 폐기됐습니다 | 안내된 명령을 실행하세요 |
| 메시지가 영어로 나옵니다 | 기본 언어가 영어입니다. 서버는 서버 환경을 따릅니다 | 셸에 `GUIDELINE_LANG=ko` 를 두세요. 서버 메시지는 서버 환경에 두세요 |
| `CLI 버전이 낮음 — guideline-manage 업데이트 필요` | 서버가 0.12.0 보다 낮은 CLI 를 거부했습니다 | `npm install -g guideline-manage` 로 올리세요 |
| `제출되지 않음: 만료됨` (종료 코드 3) | 폼을 10분 안에 열지 않았거나, 탭을 닫고 90초가 지났습니다. 아무것도 쓰지 않았습니다 | `pick` 을 다시 실행하세요 |
| 폼에 「이미 끝난 폼.」 이 보입니다 | 제출·취소·만료된 폼입니다 | 터미널에서 `pick` 을 다시 실행하세요 |
| `서버에서 폼이 사라짐` | 기다리는 동안 서버 데이터가 바뀌었습니다 | `pick` 을 다시 실행하세요 |
| 할 일 `conflict` | 같은 이름이 이미 있고 원본과 다릅니다 | `pick` 의 **차이 보기**로 보고 **갱신**을 켜거나 그대로 두세요 |
| `ruler 프로젝트가 아님` | 그 디렉터리에 `.ruler/` 가 없습니다 | 기존 지침을 `.ruler/` 로 옮긴 뒤 다시 실행하세요 |
| `이 프로젝트는 아직 옛 배치 — guideline update 를 한 번 실행 …`(종료 코드 2) | 0.24 전에 받은 프로젝트(사본이 `.ruler/<스택>/`)에서 `status`·`propose`·`apply` 를 실행했습니다 | `guideline update` 를 한 번 실행하세요. 서버가 필요합니다. [서버와 CLI 올리기](how-to/upgrade.md#guideline-배치로-프로젝트-옮기기)를 보세요 |
| `먼저 커밋하거나 stash 하라` | `.guideline/` 배치로 옮기면 추적 파일을 다시 쓰는데, 그 디렉터리의 추적 파일에 커밋 안 된 변경이 있습니다 | 커밋하거나 stash 한 뒤 `update` 를 다시 실행하세요 |
| `CLAUDE.md` 가 생겼거나 Claude Code 가 `AGENTS.md` 를 무시합니다(`stray-ruler-output` 할 일) | `.ruler/ruler.toml` 없이 `ruler apply` 가 돌았습니다. 보통 클론 직후이고, ruler 가 모든 에이전트 몫을 썼습니다 | `guideline apply` 를 실행하세요. ruler 표시가 있는 `CLAUDE.md` 는 지우고 알립니다. 표시가 없으면 두므로 확인하고 직접 지우세요. 검사는 `CLAUDE.md` 만 하니, ruler 가 쓴 다른 에이전트 파일은 `git status` 로 보고 쓰지 않는 것을 지우세요 |
| 클론한 뒤나 새 워크트리에 지침이 없습니다: `.ruler/<스택>/` 이 없음 | 생성물은 git 에 없습니다 | `guideline apply` 를 실행하세요(서버가 필요 없습니다). 설치할 때 자동으로 하려면 [새로 클론하거나 새 워크트리를 만들었을 때](getting-started.md#6-새로-클론하거나-새-워크트리를-만들었을-때)를 보세요 |
| `ruler apply` 만 돌렸더니 지침이 낡았습니다 | ruler 는 `.guideline/` 이 아니라 생성물을 읽습니다. `.guideline/` 이나 `ruler.project.toml` 을 바꿔도 `guideline apply` 를 하기 전까지 생성물은 그대로입니다 | `guideline apply` 를 실행하세요. ruler 도 함께 돕니다. 생성물이 낡으면 `status` 가 `apply` 할 일을 냅니다 |
| `.ruler/<스택>/01-git.md`(또는 `docs/guideline/…`)를 고쳤는데 사라졌습니다 | 생성물이라 `guideline apply` 때마다 다시 쓰입니다 | `.guideline/` 의 사본을 고쳐 `guideline propose` 로 원본에 올리거나 [바꿈](how-to/override-guidelines.md)을 쓰세요 |
| `ruler 를 돌지 않음: git 루트 … 에 아직 .ruler/ruler.toml 이 없음`(`root-apply` 할 일) | 모노레포에서 git 루트에 `.ruler/ruler.toml` 이 없으면 단위의 `apply` 가 ruler 를 돌기 전에 멈춥니다 | git 루트에서 `guideline apply` 를 먼저 실행하거나, 거기에 `nested = true` 인 `.ruler/ruler.toml` 을 직접 두고 단위에서 다시 실행하세요 |
| `git status` 에 옛 사본이 삭제로 보이거나, `untracked` 할 일이 `git rm --cached` 명령을 알려 줍니다 | 이제 생성물인 파일을 CLI 가 git 인덱스에서 뺐거나(`git rm --cached`, 파일은 남음), 못 해서 명령을 알려 줍니다 | 명령이 있으면 실행하고 `git status` 를 확인해 커밋하세요. `git add -A` 전에 `guideline apply` 를 하세요. 안 하면 옛 사본이 다시 들어갑니다 |
| `[<표>] 을 .ruler/ruler.toml 에 넣지 않음`(`mcp-conflict` 할 일) | `ruler.project.toml` 에 같은 이름의 표가 이미 있거나 TOML 모양이 겹칩니다. 프로젝트 것을 둡니다 | 표를 확인하세요. 받은 MCP 표를 이 프로젝트에서 고쳤다면 `.guideline/mcp/<이름>/server.json` 을 고쳐 `guideline propose` 로 올리세요. 고친 표는 `ruler.project.toml` 에 남고 `status` 에는 MCP 가 current 로 보입니다 |
| 직접 만든 `.claude/skills/<이름>` 이나 `.mcp.json` 항목이 첫 `pick` 뒤에 사라졌습니다 | 같은 이름의 받은 스킬·MCP 서버가 `.ruler/` 로 조합되고, ruler 가 그것으로 덮어씁니다. 폼은 이제 `.claude/skills` 와 `.mcp.json` 을 비교하지 않아 경고하지 않습니다 | `pick` 하기 전에 이름을 바꾸거나 `guideline-export` 스킬로 원본에 올리세요 |
| `CLAUDE.md 형은 더 이상 지원하지 않음` | 0.12 의 CLAUDE.md 형으로 받은 프로젝트입니다 | ruler 로 옮기고 `guideline pick` 을 다시 실행하세요 |
| `제안 권한이 없는 토큰` | 읽기 토큰입니다 | 관리자에게 범위 `propose` 토큰을 받아 `--token-stdin` 으로 넣으세요 |
| `개인 범위는 git 저장소 안에서, git 2.31 이상(git rev-parse --path-format)으로만 씀`(종료 코드 2) | `pick --local` 을 git 저장소 밖에서 실행했거나 git 이 2.31 보다 옛날입니다 | git 저장소에서 실행하거나 git 을 올리세요. git 밖의 폴더에는 개인 범위가 없습니다 |
| `이 서버는 개인 폼을 모름` | 서버가 CLI 의 개인 폼보다 옛날입니다 | 서버 운영자에게 서버를 올려 달라고 하세요([서버와 CLI 올리기](how-to/upgrade.md)) |
| `…/local.json 을(를) 읽을 수 없음 — 올바른 개인 선택 파일이 아님`(`local-bad` 할 일) | git 공용 디렉터리의 내 개인 선택이 깨졌습니다. 고칠 때까지 `apply` 는 프로젝트 선택만으로 조합하고, `pick --local` 은 덮어쓰지 않고 멈춥니다 | 파일을 고치거나, 지워서 개인 선택을 버린 뒤 `guideline apply` 를 실행하세요 |
| `…/defaults.json 을(를) 읽을 수 없음 — 올바른 머신 기본값 파일이 아님` | 머신 기본값이 깨져 `pick --local` 이 덮어쓰지 않고 멈춥니다 | 파일을 고치거나 지우세요 |
| `개인 생성물을 git 의 info/exclude 에 쓰지 못함` | CLI 가 `<git 공용 디렉터리>/info/exclude` 를 쓰지 못했습니다. 그 블록을 생성물보다 먼저 쓰므로, 생성물을 쓰지 않고 멈췄습니다(종료 코드 1). 추적 안 된 파일로 보이지 않습니다 | 파일 권한을 확인하고 `guideline apply` 를 실행하세요 |
| `role-missing` 할 일: 「이 워크트리의 역할 … 이(가) 어느 단위에도 정의돼 있지 않아」 | 역할 파일의 역할을 어느 단위의 `local.json` 도 정의하지 않습니다. 예: `guideline role remove` 뒤, 새 클론. 공통 개인 선택만 씁니다 | `guideline pick --local --role <이름>` 으로 역할을 정의하거나 `guideline role use --none` 으로 지우세요 |
| `role-bad` 할 일: 「…/guideline/role: 역할 이름 규칙에 맞지 않아」 | 워크트리의 역할 파일을 손으로 고쳤거나 파일이 아닙니다. 역할 없이 조합합니다 | `guideline role use <이름>` 이나 `guideline role use --none` 을 실행하세요 |
| `역할은 …(으)로 바꿨고 반영 일부가 실패함` | `guideline role use` 가 생성물 일부를 쓴 뒤 실패했습니다(예: git 루트 아래 단위). 새 역할은 그대로입니다 | 그 위 메시지의 원인을 고친 뒤 git 루트에서 `guideline apply` 를 실행하세요 |
| 0.24.0 CLI 가 `local-bad` 를 내거나 그 `pick --local` 이 종료 코드 1 로 멈춥니다 | 더 새 CLI 가 `local.json` 이나 `defaults.json` 을 버전 2 로 썼고, 0.24.0 은 그것을 읽지 못합니다 | CLI 를 올리세요([서버와 CLI 올리기](how-to/upgrade.md)) |
| 다른 클론에 내 개인 더함이 없습니다 | 개인 선택은 그 클론의 git 공용 디렉터리에 있습니다. 한 클론의 워크트리끼리는 함께 쓰지만 다른 클론과는 아닙니다 | 그 클론에서 `guideline pick --local` 을 실행하세요. [머신 기본값](how-to/use-guidelines-only-on-your-machine.md#머신-기본값)이 있으면 폼이 미리 체크된 채로 열립니다 |

## 관리자 웹

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| 로그인·저장이 403 입니다 | `PUBLIC_URL` 과 다른 주소로 열었습니다 | `PUBLIC_URL` 주소로 여세요 |
| **제안**에서 **수락** 버튼이 막혀 있습니다 | 원본과 같은 곳을 고쳐 충돌했습니다(Outdated) | **고치기**로 풀거나 거절하세요 |

## 서버가 뜨지 않음

로그의 첫 줄이 이유입니다.
운영 로그와 설정 오류는 언어 설정과 상관없이 영어입니다.

| 로그 | 원인 | 해결 |
| --- | --- | --- |
| `… is not set`, `… must be at least 32 characters` | 필수 변수가 없거나 너무 짧습니다 | `.env` 를 고치고 다시 띄우세요 |
| `cannot write to … (chown 1000:1000)` | 서버 사용자(uid 1000)가 데이터 폴더에 쓸 수 없습니다 | `DATA_HOST_DIR` 에 `chown 1000:1000` 을 실행하세요 |
| `DB schema vN is newer than this server (vM) …` | 더 새 이미지로 배포했다가 되돌렸습니다 | 새 버전으로 다시 배포하거나 [업그레이드 전 백업으로 복구](how-to/back-up-and-restore.md#백업으로-복구하기)하세요 |

## 다음 문서

- [설정](configuration.md)
- [서버와 CLI 올리기](how-to/upgrade.md)
- [전체 문서](../README.md)
