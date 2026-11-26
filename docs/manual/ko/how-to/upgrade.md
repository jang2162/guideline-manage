<!-- source: docs/manual/en/how-to/upgrade.md @ v0.26.1 -->
[English](../../en/how-to/upgrade.md) | **한국어**

# 서버와 CLI 올리기

지침 서버와 `guideline` CLI 를 새 버전으로 올리고, 버전에 따라 손으로 해야 하는 일을 정리합니다.
새 릴리스로 옮기는 서버 운영자와 CLI 사용자를 위한 문서입니다. 버전마다 바뀐 내용은 [CHANGELOG.md](../../../../CHANGELOG.md)(영어)에 있습니다.

## 서버 올리기

1. 새 릴리스를 받으세요.

   ```bash
   git pull                    # or: git checkout v<version>
   ```

2. 다시 빌드하고 띄우세요.

   ```bash
   docker compose up -d --build
   ```

서버는 시작할 때 DB 스키마를 올립니다.
올리기 직전에 `backups/guideline-pre-v<버전>-<시각>.db` 를 만들고, 이 파일은 자동으로 지우지 않습니다.
서버가 뜨지 않으면 [문제 해결](../troubleshooting.md#서버가-뜨지-않음)을 보세요.

## CLI 올리기

```bash
npm install -g guideline-manage
```

- 서버는 0.12.0 보다 낮은 CLI 를 「CLI 버전이 낮음 — guideline-manage 업데이트 필요」 로 거부합니다.
- 공개 서버에서 토큰 없이 받으려면 CLI 0.16 이상이어야 합니다. 0.15 CLI 는 토큰이 없으면 서버에 묻기 전에 멈춥니다.
- 폼을 쓰려면 **CLI 와 서버를 함께 0.24 이상으로 올리세요.** 폼은 파일이 아니라 스택 단위로 고르고 `guideline.json` 을 버전 3 으로 씁니다. 0.24 서버는 옛 CLI 의 폼을 426 으로 거절하고(서버 언어에 따라 「guideline CLI 를 0.24.0 이상으로 업데이트 필요」 또는 「update the guideline CLI to 0.24.0 or newer」), 0.24 CLI 는 서버가 옛날인 출처를 건너뜁니다(「서버가 CLI 보다 옛날」, 종료 코드 1). 갱신·상태·제안은 서버를 올리지 않아도 됩니다.
- `guideline pick --local`(개인 범위)과 고르기 폼의 **필수** 표시도 0.24 서버가 필요합니다. 옛 서버는 개인 폼을 몰라 `pick --local` 이 「이 서버는 개인 폼을 모름」 으로 그 폼을 취소합니다(종료 코드 1).
- 새 CLI 로 처음 `pick` 이나 `update` 를 한 뒤 `guideline.json` 을 커밋하세요. 버전 3(블록 키)으로 다시 쓰이며, 옛 CLI 는 읽지 못합니다(CLI 언어에 따라 「version 이 1 이나 2 가 아님」 또는 「version is not 1 or 2」).
- **서버도 CLI 와 함께 다시 배포하세요.** 고르기 폼의 스크립트(`/static/selection.js`)는 서버가 내주는데, 0.24 판은 `.guideline/` 에 남은 스킬·서브에이전트·MCP 서버를 맞는 단계에 보입니다. 옛 서버는 엉뚱한 단계에 보입니다.
- **개인 역할은 버전 2 파일을 씁니다.** 0.24.0 보다 새 CLI 의 첫 `guideline pick --local`(또는 `guideline role remove`)은 `local.json` 을 버전 2 로 쓰고, 머신 기본값 저장은 `defaults.json` 을 버전 2 로 씁니다. 0.24.0 CLI 는 그것을 읽지 못합니다: 그 `apply`·`update`·`status` 는 프로젝트 선택만으로 조합하고(`local-bad` 할 일), 그 `pick --local` 은 종료 코드 1 로 멈춥니다. 그 파일을 함께 쓰는 모든 워크트리와 머신의 CLI 를 올리세요. 버전 1 파일도 그대로 읽습니다.
- 역할 폼(`pick --local --role`)은 0.24 서버에서도 동작하며, 보통의 개인 폼으로 보입니다. 역할 부제와 「프로젝트·공통 선택이 받음」 열을 보려면 서버를 다시 배포하세요.
- 0.20 이상 CLI 는 옛 서버에서도 동작합니다. 옛 서버는 `whoami` 가 404 라서 `guideline propose` 는 예전처럼 제안으로 보내고, `status`·`login` 은 토큰 범위를 보이지 않습니다. 옛 CLI 는 0.20 서버에서 예전과 같습니다.

## `.guideline/` 배치로 프로젝트 옮기기

0.24 부터 받은 지침은 `.guideline/` 의 사본이고, ruler 가 읽는 파일(`.ruler/<스택>/`, `.ruler/guideline.md`, `.ruler/ruler.toml`, `docs/guideline/`)은 `guideline apply` 가 만드는 생성물이라 git 이 무시합니다.
0.24 이상 CLI 로 처음 `guideline update` 나 `guideline pick` 을 하면 옛 배치로 받은 프로젝트를 옮깁니다.
그때까지 `status`·`propose`·`apply` 는 「이 프로젝트는 아직 옛 배치」 라며 멈춥니다(종료 코드 2).

1. 프로젝트를 함께 쓰는 모든 사람의 CLI 와 서버를 올리세요(`npm install -g guideline-manage`).
2. 작업을 커밋하세요. 옮기면 추적 파일을 다시 쓰므로, 그 디렉터리의 추적 파일에 커밋 안 된 변경이 있으면 「먼저 커밋하거나 stash 하라」 며 멈춥니다. 추적하지 않는 파일은 막지 않습니다.
3. 프로젝트에서 `guideline update` 를 한 번 실행하세요. 서버가 필요합니다. 옮기는 일은 이렇습니다.
   - 받은 사본을 `.guideline/` 에 쓰고, 프로젝트에서 고친 것은 그대로 살립니다(「프로젝트에서 고침」 으로 보입니다).
   - 바꿈을 `.ruler/<스택 경로>/` 에서 `.guideline/overrides/<스택 경로>/` 로 옮깁니다.
   - `.ruler/ruler.toml` 의 설정을 `.ruler/ruler.project.toml` 로 옮깁니다. 받은 그대로인 MCP 표는 뺍니다(고친 MCP 표는 남고 `mcp-conflict` 할 일이 나옵니다).
   - 생성물을 조합하고, `.gitignore` 블록을 쓰고, 옛 사본·색인·관리 지침·`docs/guideline/README.md`·`ruler.toml`·옮긴 바꿈을 git 인덱스에서 뺍니다(`git rm --cached`, 파일은 남습니다). 스택 폴더에 직접 둔 프로젝트 파일은 그 자리에 추적된 채로 남습니다.
   - `guideline.json` 을 버전 3 으로 다시 써서 고른 스택의 나머지 파일이 더해집니다(`manifest-v3` 할 일).
   - `guideline-manage` 가 의존성에 있고 `ruler apply` 에 인자가 없으면 `package.json` 의 `prepare` 를 `ruler apply` 에서 `guideline apply` 로 바꿉니다(인자가 있으면 `prepare-manual` 할 일이 나오고 손으로 바꿉니다).
4. `git status` 로 확인하고 한 번에 커밋하세요: `.guideline/`, `guideline.json`, `guideline-lock.json`, `.ruler/ruler.project.toml`, `.gitignore`, `package.json`, 인덱스에서 뺀 옛 사본.
5. `package.json` 이 있으면 CLI 를 프로젝트에 넣어 클론한 뒤 `prepare` 가 생성물을 조합하게 하세요.

   ```bash
   pnpm add -D guideline-manage    # 또는: npm install -D, yarn add -D, bun add -d
   guideline apply                 # prepare 를 ruler apply 에서 guideline apply 로 바꿉니다
   ```

   `guideline-manage` 가 의존성에 없으면 CLI 는 `prepare` 를 그대로 두고 명령을 담은 `dev-dependency` 할 일을 남기며, 추가할 때까지 `status`·`update` 가 다시 냅니다. 그 전까지 클론이나 새 워크트리의 `prepare` 는 ruler 만 돌아 지침 없는 `AGENTS.md` 를 만듭니다. `package.json` 이 없으면 `apply-hook` 할 일이 나옵니다. 세팅 단계에서 `guideline apply` 를 부르세요(Orca: `orca.yaml` 의 `scripts.setup`).
6. 팀원은 pull 하고 CLI 를 올린 뒤 `guideline apply` 를 실행합니다(`prepare` 가 부르면 `pnpm install` 로 됩니다). 생성물은 git 에 없습니다.
   - 옮긴 커밋을 pull 하면 git 이 더는 추적하지 않는 옛 생성물(`.ruler/<스택>/`, `.ruler/ruler.toml`, `docs/guideline/`)이 작업 트리에서 지워집니다. 바로 `guideline apply` 를 실행하세요. 그 전에 `ruler apply` 만 돌리지 마세요: `.ruler/ruler.toml` 이 없으면 ruler 가 nested 를 끈 채 모든 에이전트 몫을 씁니다.
   - 옛 사본(`.ruler/<스택>/NN-*.md`, `docs/guideline/<스택>/…`)을 고친 미병합 브랜치는 옮긴 커밋을 병합할 때 modify/delete 충돌이 납니다. 그 수정을 `.guideline/<id>` 의 사본(예: 원본 frontmatter 를 담은 `.guideline/rules/<스택>/NN-*.md` — 그 아래 본문을 고칩니다)으로 옮기고, 옛 경로를 지워 충돌을 풉니다.
   - 모노레포에서는 git 루트의 `guideline apply` 가 그 아래 커밋된 단위도 모두 조합합니다.

> [!WARNING]
> **원본의 `ruler` 스택을 고치세요.** 지침 원본에 ruler 를 가르치는 스택(예: `ruler`)이 있으면, `.ruler/` 가 소스이고 `ruler.toml` 이 설정이며 `prepare` 가 `ruler apply` 를 돈다고 적혀 있을 가능성이 큽니다. 그 글은 이 저장소가 아니라 서버에 있고, 새 배치에는 맞지 않습니다. `.guideline/` 에 받은 사본이 있고, `.ruler/<스택>/`·`.ruler/guideline.md`·`ruler.toml` 은 생성물이며, ruler 설정은 `.ruler/ruler.project.toml` 에 두고, `prepare` 는 `guideline apply` 를 돈다고 고치세요. 웹에서 고치거나 `guideline propose` 로 올리세요.

## 이미 돌고 있는 서버의 씨앗 고치기

`guideline-sync`·`guideline-export` 스킬과 작성 규칙(`docs/authoring.md`)은 씨앗입니다.
서버는 빈 DB 로 처음 띄울 때만 씨앗을 씁니다.
아래 버전보다 먼저 띄운 서버에는 옛 글이 남아 있으니 웹에서 직접 고치세요.
`llms.txt` 는 요청마다 새로 만들어서 바로 바뀝니다.

> [!WARNING]
> **0.19 전에 띄운 서버:** `guideline-sync` 스킬에 「추천해서 받기」 절을, 작성 규칙에 「필요한 블록」 절을 추가하세요. 언어팩 `templates/` 의 같은 파일에서 옮겨 오세요.

> [!WARNING]
> **0.20 전에 띄운 서버:** `guideline-export` 스킬의 2번 단계는 사용자가 검토 없이 반영하라고 했을 때만 `--apply` 를 쓰라고 합니다. 이 단계를 「admin 토큰이면 `guideline propose` 가 바로 반영하고, 검토를 받으려면 `--review`」 로 고치세요. 언어팩 `templates/skills/guideline-export/SKILL.md` 를 참고하세요. `guideline-sync` 의 「고친 사본을 원본에 올리기」 행도 같은 방식으로 고치세요.

> [!WARNING]
> **0.21 전에 띄운 서버:** `guideline-sync` 스킬이 `missing-requires` 할 일을 처리하지 못합니다. 그 스킬의 「할 일 처리」 절 첫 줄에 `status` 를 더하고 `missing-requires` 행을 추가하세요. 언어팩 `templates/skills/guideline-sync/SKILL.md` 에서 옮겨 오세요.

> [!WARNING]
> **0.24 전에 띄운 서버:** 작성 규칙에 「하위 스택」 절이 없고, `guideline-sync` 스킬이 하위 스택을 `when` 으로 고르라고 하지 않습니다. 웹에서 언어팩 `templates/` 의 같은 파일에서 옮겨 오세요.
>
> - 작성 규칙: 「하위 스택」 절, 「어디에 쓰는가」 표의 하위 스택 행, 「다른 스택을 바꿀 때」 의 `<스택 경로>/<파일>` 셀과 자손 경고. 또한 「어디에 쓰는가」·「세팅 문서」·「표시 이름」·「하위 스택」·「별칭」 에서 스택이 프로젝트에 놓이는 자리(`.guideline/rules/<스택>/`, 조합하면 `.ruler/<스택>/`·`docs/guideline/<스택>/`).
> - `guideline-sync`: 「추천해서 받기」 1·2 단계의 하위 스택 문장, 「할 일 처리」 에서 `new-file`·`removed-upstream` 행의 `new-file` 삭제(그 할 일은 없어졌습니다)와 `leftover` 행 보강.
> - `.guideline/` 배치를 위한 `guideline-sync`: 옛 배치 전제, 「무엇을 할지」 의 `guideline apply --json` 행, 「할 일 처리」 의 새 종류 `apply`·`root-apply`·`unit-update`·`unit-problem`·`root-ruler-toml`·`no-copy`·`override-unchosen`·`mcp-conflict`·`untracked`·`stray-ruler-output`·`migrated`·`manifest-v3`·`prepare`·`prepare-manual`·`dev-dependency`·`apply-hook`. `mcp-local` 은 지우고, `mcp-build`·`subagents-off`·`nested-off` 행은 `.ruler/ruler.project.toml` 을 가리키고, `alias` 행은 `.guideline/overrides/<새 이름>/` 을 가리키며, 「지킬 것」 은 `.guideline/` 사본과 생성물을 고치지 말라고 합니다.
> - 개인 범위를 위한 `guideline-sync`: 모노레포 하위 디렉터리의 개인 폼에 관한 전제 문장, 「무엇을 할지」 의 개인 행 둘, 「개인 범위」 절(`pick --local`, 작업자 자신의 도구로 `{"add": …, "remove": …}` 추천, 필수 블록), 「할 일 처리」 아래의 `scope: "personal"` 문단, `setup-personal`·`personal-ignored`·`personal-shadowed`·`personal-revision`·`personal-sync`·`local-bad`·`ruler-leftover`·`override-target`·`unit-write-failed` 행, 이제 git 루트의 `update`·`pick`·`pick --local` 도 말하는 `unit-update`·`unit-problem` 행, `removed-upstream` 행의 개인 문장, 개인 사본을 고치지 않는다는 규칙. 가장 중요한 것은 `setup-personal` 행입니다: 없으면 에이전트가 개인 스택을 다른 스택처럼 세팅해 커밋되는 파일을 바꿀 수 있습니다.
> - `guideline-export`: 1단계와 예시 표에서 받은 사본의 자리(`.guideline/…`), 바꿈의 자리(`.guideline/overrides/<스택 경로>/`), 프로젝트의 MCP 설정인 `.ruler/ruler.project.toml`.

> [!WARNING]
> **0.25 전에 띄운 서버:** `guideline-sync` 스킬이 개인 역할을 모릅니다. 웹에서 언어팩 `templates/skills/guideline-sync/SKILL.md` 에서 옮겨 오세요: 「무엇을 할지」 의 역할 행, 「개인 범위」 6단계(`pick --local --role`, `guideline role use`), 「할 일 처리」 의 `role-missing`·`role-bad` 행. 없으면 에이전트가 `role-missing`·`role-bad` 에 어떻게 답할지 모릅니다.

> [!WARNING]
> **0.26 전에 띄운 서버:** `guideline-sync` 스킬이 `pick --recommend … --yes`(폼 없이 추천 반영)와 프로젝트 폼의 빼라는 추천을 모릅니다. 웹에서 언어팩 `templates/skills/guideline-sync/SKILL.md` 에서 옮겨 오세요: 「무엇을 할지」 의 「폼 없이 추천대로 반영」 행, 「추천해서 받기」 3·5단계의 `{"add": …, "remove": …}` 문장과 6단계(사용자가 폼 없이 반영하라고 했을 때만 `--yes`), 「개인 범위」 3단계의 `--yes` 문장. 없으면 에이전트는 계속 폼을 열어 안전합니다. 일부만 옮기면 사용자가 요청하지 않았는데 폼을 건너뛸 수 있습니다.

> **0.27 전에 띄운 서버:** `guideline-sync` 스킬이 `guideline agents` 를 모릅니다. 웹에서 언어팩 `templates/skills/guideline-sync/SKILL.md` 에서 옮겨 오세요: 「무엇을 할지」 의 코딩 에이전트 행, 「할 일 처리」 의 `agents-mismatch`·`agents-unreadable` 행. 없으면 에이전트가 에이전트를 바꾸려고 폼을 띄울 수 있는데, 폼으로는 바꿀 수 없습니다.

## 다음 문서

- [서버 백업과 복구](back-up-and-restore.md)
- [문제 해결](../troubleshooting.md)
