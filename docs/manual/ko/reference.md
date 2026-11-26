<!-- source: docs/manual/en/reference.md @ v0.27.0 -->
[English](../en/reference.md) | **한국어**

# 레퍼런스

`guideline` 명령, 종료 코드, 고르기 폼, 토큰 범위, 관리자 웹, 서버 API 를 정리합니다.
정확한 동작을 확인해야 하는 CLI 사용자, 에이전트, 서버 운영자를 위한 문서입니다. 설정은 [설정](configuration.md)에 있습니다.

## 프로젝트 명령

모두 단위 디렉터리(`.ruler/` 가 있는 곳)에서 실행합니다. 읽고 쓰는 파일은 [파일 자리](#파일-자리)에 있습니다.
공통 옵션: `--project <경로>`(기본: 현재 디렉터리), `--server <URL>`, `--source <이름>`(출처가 여럿일 때 하나만), `--json`.

| 명령 | 하는 일 |
| --- | --- |
| `guideline pick` | 서버 폼을 열고, 제출하면 고른 항목을 반영합니다. `--new <이름\|경로>` 는 새 프로젝트를 만들고(`git init`) 반영합니다. `--no-browser` 는 주소만 냅니다. `--recommend <파일\|->` 는 에이전트가 고른 블록(JSON `{"블록 키": "이유"}`, 빼기도 하려면 `{"add": {…}, "remove": {…}}`)을 미리 체크한 폼을 엽니다 — 출처 하나일 때만(여럿이면 `--source`). 0.19 이상 서버가 필요하고, 옛 서버는 추천 없이 폼을 엽니다. 빼라는 추천은 0.26 이상 서버가 미리 체크를 풀어 보이고, 옛 서버는 더함만 보입니다. `--yes`(`--recommend` 와 함께만)는 폼 없이 추천을 반영합니다. [폼 없이 반영하기](#폼-없이-반영하기)를 보세요. 스택을 고르려면 0.24 이상 서버가 필요합니다([종료 코드](#종료-코드) 참고) |
| `guideline pick --local` | 개인 폼을 열고, 이 단위에서 내가 받는 것만 바꿉니다: 프로젝트 선택에 더하거나 거기서 뺄 블록입니다([개인 범위](#개인-범위)). 커밋되는 것은 아무것도 쓰지 않습니다. `--recommend <파일\|->` 는 `{"add": {"블록 키": "이유"}, "remove": {"블록 키": "이유"}}` 를 받습니다(그냥 `{"블록 키": "이유"}` 는 더함). `--yes` 는 폼이 처음 체크해 보였을 것을 폼 없이 저장합니다(`--role` 과도 됩니다. 머신 기본값으로는 저장하지 않습니다). git 2.31 이상의 git 저장소와, 개인 폼을 아는 서버가 필요합니다. `--new` 와 함께 쓸 수 없습니다 |
| `guideline pick --local --role <이름>` | 개인 역할의 개인 폼을 열고, 결과를 이 단위 `local.json` 에 그 역할의 겹으로 저장합니다([개인 역할](#개인-역할)). 폼의 프로젝트 열은 프로젝트 선택에 내 공통 개인 선택을 입힌 것을 보입니다. 역할이 없으면 만듭니다. 이 워크트리를 그 역할로 바꾸지는 않습니다. 이름 규칙에 맞지 않는 이름이나 `--local` 없는 `--role` 은 종료 코드 2 입니다 |
| `guideline update` | 고른 항목 그대로 서버 최신으로 다시 반영합니다. 프로젝트에서 고친 파일은 건너뛰고, `--force` 면 덮어씁니다. 0.24 이상 CLI 의 첫 `pick`·`update` 는 옛 배치로 받은 프로젝트를 옮깁니다([서버와 CLI 올리기](how-to/upgrade.md#guideline-배치로-프로젝트-옮기기)) |
| `guideline apply` | 서버에 묻지 않고 `.guideline/` 과 `.ruler/ruler.project.toml` 에서 생성물을 조합하고, `.gitignore` 블록을 다시 쓰고, git 루트에서 `ruler apply` 를 돕니다. 클론한 뒤, 새 워크트리에서, `prepare` 에서 쓰세요. `pick`·`pick --local`·`update` 도 끝에 같은 방식으로 조합하지만(git 루트에서는 그 아래 단위도) ruler 는 쓴 것이 있을 때만 돕니다. `apply` 는 바뀐 것이 없어도 ruler 를 돕니다. 옵션: `--project <경로>`, `--json`. 종료 코드 0 완료, 1 쓰기 실패, 2 아직 받은 것이 없거나 옛 배치입니다. 클론 직후라면 ruler 가 모든 에이전트 몫으로 쓴 `CLAUDE.md` 도 지웁니다([문제 해결](troubleshooting.md#cli)). 모노레포의 git 루트에서는 그 아래에서 git 이 추적하는 단위도 모두 조합한 뒤 ruler 를 한 번 돕니다. 루트가 guideline 프로젝트가 아니어도 됩니다([모노레포](how-to/use-in-a-monorepo.md)) |
| `guideline agents` | 프로젝트의 코딩 에이전트를 보입니다: `guideline.json` 의 `agents` 와 `.ruler/ruler.project.toml` 의 `default_agents`, 둘이 다르면 그것도 알립니다(`--json`: `{ agents, rulerAgents, mismatch }`). `add <이름>…` / `remove <이름>…`(claude·codex·opencode)는 둘을 함께 바꾼 뒤 `guideline apply` 처럼 반영합니다. 서버와 폼이 필요 없고, `ruler.project.toml` 에서는 `default_agents` 줄만 바뀌고, 그 안의 claude·codex·opencode 밖 이름은 남깁니다. `agents` 가 올바르지 않은 `guideline.json`(다른 명령은 여기서 멈춥니다)도 읽으므로 `add` 로 고칠 수 있습니다. 두 파일을 쓴 뒤 반영이 실패하면 그렇다고 알립니다: 원인을 고친 뒤 `guideline apply` 를 실행하세요. `guideline agents` 를 다시 치면 바꿀 것이 없다고 끝납니다. 모르는 이름, 마지막 에이전트 빼기, `default_agents` 가 없거나 한 줄 배열이 아닐 때는 아무것도 쓰지 않고 종료 코드 2 입니다. 바꿀 것이 없으면 「바뀐 것 없음」 을 내고 0 입니다. `ruler.project.toml` 이 없는 프로젝트는 `guideline.json` 만 바뀝니다. 자기 `ruler.project.toml` 이 없는 모노레포 단위에서는 ruler 가 git 루트의 `default_agents` 를 따르므로(`pick` 과 같은 규칙) `guideline agents` 는 루트의 목록을 보이고, `add`/`remove` 는 그 단위의 `guideline.json` 만 바꾸고 그렇다고 알립니다. ruler 가 쓰는 에이전트를 바꾸려면 git 루트에서 실행하세요. 옵션: `--project <경로>`, `--json` |
| `guideline status` | 반영한 지침이 최신인지, 프로젝트에서 고친 것이 있는지 보이고, 저장된 토큰의 이름과 범위를 보입니다(`--json` 은 `token`. 토큰이 없거나 0.20 보다 옛 서버면 보이지 않습니다). 개인 범위가 있으면 「개인 범위 — 더함 …」·「개인 범위 — 뺌 …」 줄과 최신이 아닌 개인 사본을 더합니다(`--json` 은 `personal`, [개인 범위](#개인-범위) 참고). 역할이 있으면 「역할 — …」 과 「역할 <이름> — 더함 …」·「뺌 …」 줄을 더합니다 |
| `guideline role` | 이 워크트리의 개인 역할과 단위마다 정의된 역할을 보입니다. `--json`: `{ role, bad, units: [{ unit, roles }] }`(git 루트 단위는 `.`, 역할이 없으면 `role` 은 `null`, 역할 파일이 깨졌으면 `bad` 는 `true`). [개인 역할](#개인-역할) 참고 |
| `guideline role use <이름>` / `use --none` | 이 워크트리의 역할을 정하거나 지우고, git 루트에서 `guideline apply` 처럼 반영합니다. 그 역할이 단위 하나 이상에 정의돼 있어야 합니다(아니면 종료 코드 2) |
| `guideline role remove <이름>` | 이 단위 `local.json` 에서 그 역할의 정의를 지우고 반영하지 않습니다. `--json`: `{ removed, todos }`. 이 단위가 정의하지 않았거나 `local.json` 을 읽을 수 없거나 폴더가 guideline 단위가 아니면 종료 코드 2 |
| `guideline propose` | 고친 사본을 원본 모양으로 되돌려 제안합니다. 범위 `admin` 토큰이면 제안 대신 바로 반영합니다(검토 없음). `--review` 는 그래도 제안으로 보내고, `--apply` 는 명시해서 바로 반영합니다(admin 토큰이 아니면 오류). 둘을 같이 주면 사용법 오류(종료 코드 2)입니다. `--dry-run`(보내면 둘 중 어느 쪽인지도 알립니다), `--title`, `--message`, `--only <항목,…>`, `--from <폴더>`. `--json` 에는 `mode`: `apply` 또는 `proposal` 이 추가됩니다(보낼 것이 없으면 없습니다). 방식은 dry-run 으로 보는 것이 정확합니다 — 실제로 보낼 때와 같은 토큰·서버로 묻지만, `status` 는 다른 토큰을 쓸 수 있습니다(출처가 여럿일 때, `GUIDELINE_TOKEN`) |
| `guideline login` / `logout` | 서버에 로그인해 토큰을 저장하거나 지웁니다. `--token-stdin` 은 브라우저 없이 토큰을 넣습니다. `login` 은 저장한 뒤 토큰의 범위(`read`·`propose`·`admin`)를 알립니다 |

### 폼 없이 반영하기

`guideline pick --recommend <파일|-> --yes` 는 폼을 만들지 않고 브라우저도 열지 않고 추천을 반영합니다. 누구도 선택을 확인할 필요가 없을 때만 쓰세요.

- 폼이 처음 체크해 보였을 것을 반영합니다: `guideline.json` 의 그 출처 블록에, 추천한 더함과 그것이 필요로 하는 블록(`requires`)과 조상 스택을 더하고, 추천한 뺌을 뺀 것입니다. 스택을 빼면 골라진 하위 스택도, 그 스택 때문에만 체크됐던 조상과 의존 블록도 함께 빠집니다. 폼에서 그 칸을 끈 것과 같습니다.
- 고정 블록은 그대로 고정입니다. 고정 블록이나 그것을 품은 스택을 빼라고 추천하면 종료 코드 2 입니다. 더하고 빼는 같은 키, 빼라고 추천한 스택 안의 더함(`rules/a` 를 빼면서 `rules/a/b` 를 더함), 원본에 없는 키도 2 입니다. 이 검사는 무엇이든 쓰기 전에, 옛 배치 프로젝트를 옮기기 전에도 하며, `--yes` 없는 폼과 `--local` 에도 똑같이 적용됩니다.
- 에이전트는 그대로입니다.
- 프로젝트에서 고친 파일은 덮어쓰지 않습니다: `--force` 없는 `guideline update` 처럼 건너뛰고 `skipped` 할 일을 냅니다. 뺀 블록의 사본을 고쳤으면 그 사본은 남기고 `leftover` 할 일을 냅니다. 원본에 없는 `.guideline/` 의 파일은 그대로 둡니다. 반영 불가 항목은 그대로 반영 불가입니다.
- 작업 트리에 커밋하지 않은 변경이 있거나 프로젝트가 git 저장소 안에 있지 않으면, 아무것도 쓰지 않고 종료 코드 2 로 거절합니다(그때 폼은 **그래도 진행**을 묻습니다). 먼저 커밋하세요.
- 제출한 pick 과 같은 보고(`--json` 도)를 내고, 같은 종료 코드로 끝납니다. 서버를 올리지 않아도 됩니다.
- `--recommend` 없는 `--yes`, `--new` 와 함께 쓴 `--yes` 는 종료 코드 2 입니다.
- `--local`(과 `--role`)에서는 개인 폼이 처음 체크해 보였을 것을 저장합니다: 지금 개인 선택(없으면 그 서버의 머신 기본값)에 추천을 얹은 것입니다. 머신 기본값은 저장하지 않고, 커밋되는 것을 쓰지 않으므로 깨끗한 작업 트리가 필요 없습니다.

### 출력과 할 일

`pick`·`update` 는 쓴 파일, 지운 파일, **할 일**을 냅니다. `status` 도 할 일을 냅니다.
할 일 종류는 서버의 `/llms.txt` 「에이전트가 할 일」 표에 있습니다.
`.guideline/` 배치가 더한 종류는 다음과 같습니다. `apply`·`pick`·`update` 가 냅니다. `status` 는 `apply`·`dev-dependency`·`prepare-manual`·`no-copy`·`override-unchosen`·`mcp-conflict`·`blocked` 를 내서, 고칠 때까지 계속 보입니다.

| 종류 | 뜻 |
| --- | --- |
| `apply` | 생성물이 낡았거나(`status` 에서), 옮긴 뒤 쓰지 못했습니다. 커밋하기 전에 `guideline apply` 를 실행하세요 |
| `agents-mismatch` | `guideline.json` 의 `agents` 와 `.ruler/ruler.project.toml` 의 `default_agents` 가 다르고, ruler 는 `default_agents` 를 따릅니다. `guideline agents add <이름>` 이나 `guideline agents remove <이름>` 으로 맞추세요(단위에 자기 `ruler.project.toml` 이 없어 루트를 따르면 git 루트에서). `default_agents` 의 claude·codex·opencode 밖 이름은 비교에서 뺍니다. `status` 는 서버 없이도 이것을 냅니다 |
| `agents-unreadable` | `.ruler/ruler.project.toml` 의 `default_agents` 가 여러 줄 배열이라 `status` 가 비교하지 못하고 `guideline agents add`·`remove` 가 바꾸지 못합니다. 한 줄 배열로 고치세요. `default_agents` 줄이 없는 것은 알리지 않습니다: 그때 ruler 는 아는 에이전트를 모두 씁니다 |
| `root-apply` | git 루트에 `.ruler/ruler.toml` 이 없어 모노레포 단위의 `apply` 가 ruler 를 돌지 않았습니다. git 루트에서 `guideline apply` 를 먼저 실행하거나, 거기에 `nested = true` 인 `.ruler/ruler.toml` 을 직접 두세요 |
| `unit-update` | git 루트의 `guideline apply`·`update`·`pick`·`pick --local` 이 아직 옛 배치인 아래 단위를 건너뛰었습니다. 그 단위에서 `guideline update` 를 실행하세요 |
| `unit-problem` | git 루트의 `guideline apply`·`update`·`pick`·`pick --local` 이 아래 단위를 열지 못했습니다. 이유가 뒤따릅니다 |
| `unit-write-failed` | git 루트의 `guideline apply`·`update`·`pick`·`pick --local` 이 아래 단위의 생성물을 다 쓰지 못했습니다(오류에 단위 경로가 붙습니다). ruler 는 돌았으므로 그 단위의 `AGENTS.md` 등 에이전트 파일을 믿지 마세요. 원인을 고친 뒤 git 루트에서 `guideline apply` 를 다시 실행하세요. 종료 코드 1 |
| `root-ruler-toml` | git 루트가 guideline 프로젝트가 아니고 `.ruler/ruler.toml` 도 없어 `apply` 가 단위만 조합하고 ruler 는 돌지 않았습니다. 거기에 `nested = true` 인 `.ruler/ruler.toml` 을 두고 커밋하세요 |
| `no-copy` | 고른 항목인데 `.guideline/` 에 사본이 없어(막힘, 또는 만들어야 하는 MCP 항목) 조합하지 않았습니다. `guideline update` 가 이유를 보입니다 |
| `override-unchosen` | `.guideline/overrides/<스택>/` 의 바꿈이 고르지 않은 스택의 것입니다. 스택을 고르거나 바꿈을 지우세요 |
| `override-target` | 바꿈이 조합한 사본(프로젝트 사본, 개인 사본이 있으면 그 위에 얹은 것)에 없는 파일·절을 가리킵니다. 바꿈의 첫 줄을 고치거나, 리비전이 어긋났으면 `guideline update` 를 실행하세요. 개인 범위가 없는 프로젝트에서도 나옵니다 |
| `subagents-off` | 서브에이전트 사본은 있지만 `.ruler/ruler.project.toml` 에 `[agents] enabled = true` 가 없어 조합하지 않았습니다 |
| `mcp-conflict` | `ruler.project.toml` 에 같은 이름의 표가 이미 있거나(프로젝트 것을 둡니다) TOML 모양이 겹쳐 받은 MCP 표를 `.ruler/ruler.toml` 에 넣지 않았습니다. 프로젝트에서 고친 받은 MCP 표는 `ruler.project.toml` 에 남고, `status` 에는 MCP 가 current 로 보이지만 이 할 일을 다시 냅니다. 그 수정을 공용으로 하려면 `.guideline/mcp/<이름>/server.json` 을 고쳐 `guideline propose` 로 올리세요 |
| `untracked` | 이제 생성물인 파일을 git 인덱스에서 뺐거나(`git rm --cached`, 파일은 남음), 못 해서 명령을 알려 줍니다 |
| `stray-ruler-output` | ruler 가 `.ruler/ruler.toml` 없이 돌아 모든 에이전트 몫을 썼습니다. ruler 표시가 있는 `CLAUDE.md` 는 지웠고, 표시가 없는 것과 설정으로 판정할 수 없는 것(여러 줄 `default_agents`)은 두었습니다. 다른 에이전트의 파일은 검사하지 않습니다 |
| `migrated` | 프로젝트를 `.guideline/` 배치로 옮겼습니다. `git status` 로 확인하고 커밋하세요 |
| `manifest-v3` | `guideline.json` 을 버전 3(스택 단위)으로 다시 써서 고른 스택의 나머지 파일이 더해졌습니다 |
| `prepare` | `package.json` 의 `prepare` 가 `ruler apply` 대신 `guideline apply` 를 돕니다 |
| `dev-dependency` | `guideline-manage` 가 의존성에 없어 `prepare` 를 바꾸지 않았습니다. 그 전까지 클론의 `prepare` 는 ruler 만 돌아 지침 없는 `AGENTS.md` 를 만듭니다. 안내한 명령으로 추가하고 `guideline apply` 를 실행하세요 |
| `prepare-manual` | `prepare` 가 인자를 붙여 `ruler apply` 를 불러, 그 인자를 받지 않는 `guideline apply` 로 바꾸지 않았습니다. 손으로 `guideline apply` 로 바꾸고 ruler 설정은 `.ruler/ruler.project.toml` 로 옮기세요 |
| `apply-hook` | `package.json` 이 없습니다. 세팅 단계에서 `guideline apply` 를 부르세요(Orca: `orca.yaml` 의 `scripts.setup`) |

개인 범위가 더한 종류는 다음과 같습니다. `status` 는 `personal-ignored`·`personal-shadowed`·`override-target`·`personal-revision`·`local-bad`·`role-missing`·`role-bad` 도 냅니다.

| 종류 | 뜻 |
| --- | --- |
| `setup-personal` | 개인 범위로만 받은 스택에 세팅 문서가 있습니다. 커밋되는 파일을 바꾸지 않고 `docs/guideline/<스택>/SETUP.md` 를 따르고, 바꿔야 하는 단계는 사용자에게 알리세요. `setup` 대신 나옵니다 |
| `personal-ignored` | 개인으로 뺀 블록을 프로젝트가 **고정**으로 정해 그 뺌을 무시했습니다. `guideline pick --local` 에서 정리하세요 |
| `personal-shadowed` | 개인으로 더한 블록이 프로젝트가 다른 출처에서 고른 블록과 최종 이름(별칭 뒤)이 같아 그것과 그 아래에 더한 블록을 쓰지 않습니다. `pick --local` 은 그 더함들을 저장하지 않습니다. 다른 명령에서 나왔으면 `guideline pick --local` 에서 정리하세요 |
| `personal-revision` | 개인 사본과 프로젝트 사본이 한 출처의 다른 리비전입니다. 예: 다른 워크트리에서 `update` 한 뒤. `guideline update` 를 실행하세요(`apply`·`status` 가 냅니다) |
| `personal-sync` | 개인 사본을 받지 못했습니다: 쓰기 오류, 또는 읽을 수 없는 개인 잠금(문구에 나온 파일을 지우세요). 프로젝트 반영은 끝났습니다. `guideline update` 를 다시 실행하세요 |
| `local-bad` | `local.json` 을 읽을 수 없어 프로젝트 선택만으로 조합했습니다. 그 파일을 고치거나 지우세요. 0.24.0 CLI 는 버전 2 의 `local.json` 에도 이것을 냅니다 |
| `role-missing` | 이 워크트리의 역할이 어느 단위에도 정의돼 있지 않아 공통 개인 선택만 썼습니다. `guideline pick --local --role <이름>` 으로 정의하거나 `guideline role use --none` 을 실행하세요. 일부 단위에만 없으면 할 일 대신 `status` 줄로 보입니다 |
| `role-bad` | 역할 파일(`<git 디렉터리>/guideline/role`)에 올바른 역할 이름이 없어 역할 없이 조합했습니다. `guideline role use <이름>` 이나 `guideline role use --none` 을 실행하세요 |
| `ruler-leftover` | 개인 선택 때문에만 ruler 가 만들거나 바꾼 것을 그대로 두었습니다: 손으로 둔 것이 남았거나 추적되거나 claude·codex·opencode 밖 에이전트의 것이거나 그런 다른 에이전트의 설정 또는 손으로 둔 설정의 백업인 설정 파일·폴더(`.mcp.json`, `.claude/skills`, `.cursor/mcp.json`, `.mcp.json.bak` …), 또는 이번 조합에서 빠졌지만 그런 다른 에이전트의 설정에 남은 MCP 서버. 확인하고 필요 없으면 직접 지우세요 |

`role-missing`·`role-bad` 와 `guideline role remove` 의 `apply` 할 일에도 `scope: "personal"` 이 붙습니다.
개인 사본에서 나온 할 일에는 `--json` 에 `scope: "personal"` 이 붙습니다: `setup-personal`, `removed-upstream`(`guideline pick --local` 에서 해제), 그리고 문구가 「개인 사본 —」 으로 시작하는 다른 종류입니다. `scope: "personal"` 인 `no-copy` 는 더한 블록에 개인 사본이 없어 조합하지 않았다는 뜻입니다. `guideline update` 를 실행하세요.

없어진 종류도 있습니다: `mcp-local`(MCP 사본도 다른 사본처럼 `.guideline/mcp/<이름>/server.json` 으로 제안합니다), `moved`(사본의 자리가 하나입니다), `new-file`.
조합하지 못하는 파일의 `blocked` 할 일은 `.guideline/` 안의 경로를 보입니다.

`update`·`status` 는 받은 블록이 필요로 하는(`requires`) 블록을 프로젝트가 받지 않았으면, 요구하는 블록마다 `missing-requires` 할 일을 냅니다.
예를 들어 블록을 받은 뒤 원본에 새 `requires` 가 생긴 경우입니다.
`data.missing` 에 빠진 블록 키가 있고, `guideline pick` 으로 추가합니다.
출처가 여럿이면 출처마다 그 출처의 `requires` 와 그 출처에서 받은 블록(별칭 전 이름)으로 판정합니다.

원본이 고른 스택에서 파일을 빼면 `status` 는 그 파일을 `upstream`(프로젝트에서도 고쳤으면 `both`)으로 보이고 `update` 는 그 파일을 지웁니다.
고친 사본은 지우지 않습니다. 그대로 남고, 확인한 뒤 지우거나 원본에 올리라는 `leftover` 할 일이 생깁니다.
고르기 폼에서, `.guideline/` 안의 파일(지침 파일, 스킬·서브에이전트·MCP 폴더)이 원본에 없으면 「원본에서 사라짐」 으로 보입니다. 프로젝트 고유 규칙은 `.guideline/overrides/`([이 프로젝트에만 다르게 하기](how-to/override-guidelines.md))나 `.ruler/*.md` 에 두세요.
비교하는 것은 `.guideline/` 뿐입니다. `.ruler/` 와 `docs/guideline/` 아래 생성물과, 직접 만든 `.claude/skills/<이름>`·`.mcp.json` 항목은 비교하지 않습니다.

### 파일 자리

| 자리 | 내용 | git |
| --- | --- | --- |
| `.guideline/rules/<스택 경로>/`, `.guideline/skills/<이름>/`, `.guideline/agents/<이름>.md`, `.guideline/mcp/<이름>/` | 받은 사본(원본 그대로) | 커밋 |
| `.guideline/overrides/<스택 경로>/override.md`, `override.d/*.md` | 프로젝트의 바꿈(하위 스택은 `<부모>/<자식>`) | 커밋 |
| `.guideline/management/<출처>.md` | 출처의 관리 지침 더함 | 커밋 |
| `.ruler/ruler.project.toml` | 프로젝트의 ruler 설정과 직접 쓴 MCP 서버 | 커밋 |
| `.ruler/<스택 경로>/NN-*.md`, `99-reference.md`, `.ruler/guideline.md`, `.ruler/skills/`, `.ruler/agents/`, `.ruler/ruler.toml`, `docs/guideline/` | `apply`·`pick`·`update` 가 만든 생성물 | 커밋 안 함: `.gitignore` 블록에 적힘 |

[개인 범위](#개인-범위)는 파일을 작업 트리 밖, git 공용 디렉터리에 두어 커밋되지 않습니다.

`.guideline/` 의 사본을 고치고 `guideline propose` 로 원본에 올리세요. 생성물을 고친 것은 다음 `apply` 때 덮입니다.
`propose` 는 프로젝트에서 고친 `.guideline/` 사본을 그대로 올립니다. 사본이 이미 원본의 모양이기 때문입니다.

### `guideline.json`

각 출처의 `items` 는 **블록 키**입니다: `rules/<스택 경로>`, `skills/<이름>`, `agents/<이름>.md`, `mcp/<이름>`(`"version": 3`).
하위 스택은 조상 스택과 함께 적힙니다. 예: `["rules/browser", "rules/browser/browseros-neo"]`.
옛 파일(파일 경로를 쓴 `"version": 1` 이나 `2`)은 그대로 읽고, 다음에 `pick` 이나 `update` 가 쓸 때 버전 3 으로 다시 씁니다(`manifest-v3` 할 일로 알립니다).
출처의 `required` 는 고르기 폼에서 **고정**으로 표시한 블록입니다. 예: `"required": ["rules/browser"]`. 각각 `items` 에 있어야 합니다. 누구도 개인 선택으로 그 블록과 그 위의 스택을 뺄 수 없습니다. `pick` 에서 체크를 푼 블록은 고정에서도 빠집니다.

## 개인 범위

`guideline pick --local` 은 작업자 한 사람이 커밋되는 파일을 바꾸지 않고 프로젝트 선택에 블록을 더하거나 거기서 빼게 합니다.
쓰는 법: [내 머신에서만 지침 쓰기](how-to/use-guidelines-only-on-your-machine.md).

받는 것은 프로젝트 선택에 내 더함과 그 조상 스택을 더하고, 내 뺌과 그 아래 스택을 뺀 것입니다.
**고정** 블록과 그 위의 스택은 뺄 수 없습니다. 그런 뺌은 무시하고 `personal-ignored` 할 일을 냅니다.
더할 수 있는 것은 `guideline.json` 에 있는 출처의 블록뿐입니다.

| 자리 | 내용 |
| --- | --- |
| `<git 공용 디렉터리>/guideline/units/<단위 키>/local.json` | 개인 선택: `{ "version": 2, "sources": { "<출처>": { "add": [블록 키], "remove": [블록 키] } }, "roles": { "<역할>": { "sources": { … } } } }`, 별칭 전 실제 이름. `roles` 에는 개인 역할마다 그 겹이 `sources` 와 같은 모양으로 있습니다. 버전 1(`roles` 없음) 파일도 그대로 읽습니다. 단위 키는 git 루트 단위면 `%root`, 그 밖은 단위 경로를 URL 인코딩한 것(`packages%2Fapi`)입니다 |
| `<git 공용 디렉터리>/guideline/units/<단위 키>/.guideline/`, `guideline-lock.json` | 내가 더한 블록의 개인 사본과 그 잠금. `pick --local` 과 `update` 가 씁니다. 고치지 마세요 |
| `<git 디렉터리>/guideline/role` | 이 워크트리의 역할 이름(첫 줄). `<git 디렉터리>` 는 그 워크트리 자신의 git 디렉터리(메인 워크트리는 `.git/`, 링크 워크트리는 `.git/worktrees/<이름>/`)라 워크트리마다 따로입니다 |
| `<git 공용 디렉터리>/info/exclude` | 단위와 워크트리마다 한 블록(`# START guideline personal files <단위 경로> @<워크트리>` … `# END …`)에 개인 범위에서만 나온 생성물과 ruler 가 쓰는 에이전트 설정 파일(`.mcp.json` 등)을 적습니다. `.` 은 git 루트 단위와 메인 워크트리입니다. git 이 더는 모르는 워크트리의 블록은 다음에 쓸 때 지웁니다 |

한 클론의 모든 워크트리가 git 공용 디렉터리를 함께 쓰므로, 개인 선택과 개인 사본도 함께 씁니다.
`guideline.json`·`guideline-lock.json`·`.guideline/`·`.gitignore` 블록은 개인 범위가 없을 때와 같습니다.
관리 지침(`.ruler/guideline.md`)에 「이 작업자의 개인 범위」 절이 붙고, 개인으로 받은 스택은 세팅 표에서 「개인」 으로 표시됩니다.

- `pick --local` 은 출처마다 개인 폼을 하나씩 엽니다. 원본은 프로젝트 잠금의 리비전으로 보이고, 개인 사본도 그 리비전으로 받습니다. `guideline update` 가 프로젝트와 개인 사본을 함께 최신 리비전으로 올립니다.
- `apply` 는 서버 없이, 어느 워크트리에서든 git 공용 디렉터리에서 개인 범위를 조합합니다.
- `propose` 는 개인 사본을 보내지 않습니다.
- `--recommend` 는 폼에 더함과 뺌을 미리 체크합니다. 원본에 없는 키, 고정 블록이나 그것을 품은 스택의 뺌은 폼을 열기 전에 종료 코드 2 로 멈춥니다.
- 프로젝트가 다른 출처에서 같은 최종 이름의 블록을 골라 가려지는 개인 더함은 저장하지 않습니다(`personal-shadowed`). 그 아래 블록도 저장하지 않습니다.
- `local.json` 이나 `defaults.json` 을 읽을 수 없으면 `pick --local` 은 종료 코드 1 로 멈추고, 그 파일을 덮어쓰지 않습니다.

`status --json` 에는 `personal` 이 붙습니다.

| 필드 | 뜻 |
| --- | --- |
| `added` | 공통 개인 선택이 더해서 받는 블록(출처가 여럿이면 `<출처>:<키>`). `removed`·`ignored` 도 공통 겹의 것이고, 역할의 것은 `role` 에 있습니다 |
| `removed` | 프로젝트 선택 중 내가 받지 않는 블록. 뺀 스택 아래의 스택도 들어갑니다 |
| `ignored` | 고정이라서 무시된 뺌 |
| `shadowed` | `[{ id, by }]`: 출처 `by` 의 블록에 가려진 더함. 워크트리가 최종으로 받는 것으로 판정합니다 |
| `role` | 이 워크트리 역할의 `{ name, defined, added, removed, ignored }`, 역할이 없으면 `null`. 역할 이름은 있지만 이 단위가 정의하지 않았으면 `defined` 는 `false` 이고 목록은 빕니다 |
| `items` | `[{ id, state }]`: 개인 사본과 그 상태(프로젝트 사본과 같은 상태 값) |

단위가 git 저장소가 아니거나 `local.json` 을 읽을 수 없으면(`local-bad` 할 일로 알립니다) `personal` 은 `null` 입니다.

### 개인 역할

워크트리는 개인 역할을 쓸 수 있습니다: 공통 개인 선택 위에 얹는, 이름 붙은 더함·뺌 겹입니다.
쓰는 방법: [워크트리마다 역할 쓰기](how-to/use-guidelines-only-on-your-machine.md#워크트리마다-역할-쓰기).

`apply`·`update`·`pick`·`pick --local`·`status` 는 세 겹을 조합합니다: 프로젝트 선택, 공통 개인 선택, 그리고 `local.json` 의 `roles.<이름>` 에 있는 역할 겹입니다.

- 역할 겹은 공통 겹의 결과 위에 얹힙니다. 내 더함 위로 채운 조상 스택도 그 결과에 들어갑니다. 역할이 그런 스택 아래 블록만 빼면 스택은 남습니다. 그 스택도 빼려면 스택 자체를 빼세요.
- 고정 블록과 그 위 스택은 역할 겹에서도 뺄 수 없습니다(`personal-ignored`).
- 워크트리의 역할을 정의하지 않은 단위는 공통 겹만으로 조합하고 `status` 가 그것을 알립니다. 워크트리의 어느 단위도 정의하지 않으면 모노레포에서도 워크트리에 `role-missing` 할 일 하나를 냅니다.
- 개인 사본은 어느 워크트리에서 `update` 를 실행하든 모든 역할의 더함을 담습니다.
- 이 단위가 역할을 정의하면 관리 지침의 개인 절에 「역할: `<이름>`」 과 역할의 더함·뺌이 보입니다.
- 역할을 정의하거나 바꾸거나 지워도 커밋되는 파일은 바뀌지 않습니다.

`guideline role use <이름>` 은 이름과 그 역할을 정의한 단위가 있는지 확인하고, 역할 파일을 쓴 뒤 git 루트에서 반영합니다.
아무것도 쓰기 전에 반영이 실패하면 역할 파일을 원래 내용으로 되돌리고, 메시지가 그 전 역할을 알립니다.
파일을 쓴 뒤 반영 일부가 실패하면 역할은 그대로이고, 메시지가 고친 뒤 `guideline apply` 를 실행하라고 알립니다.

### 머신 기본값

개인 폼의 **이 선택을 내 기본값으로** 는 더함과 뺌을 CLI 설정 폴더의 `defaults.json`([설정](configuration.md#cli-파일))에 서버 주소(origin)마다 저장합니다.
그 출처에 개인 선택이 아직 없는 프로젝트에서만 개인 폼을 미리 체크합니다. 원본에 없는 블록은 빼고 체크합니다.
`update`·`apply` 는 읽지 않습니다.
마지막으로 기본값을 저장한 실행이 그 서버의 기본값을 정합니다. 한 실행 안에서 같은 서버의 출처 여럿은 합칩니다. 어떤 블록을 출처마다 다르게 골랐으면 이름 순으로 뒤 출처의 것을 남기고 경고합니다.
역할 폼(`pick --local --role <이름>`)에서는 그 서버의 `roles.<이름>` 에 역할 기본값으로 저장하고, 공통 기본값과 다른 역할은 그대로 둡니다.

## 원본 명령

| 명령 | 하는 일 |
| --- | --- |
| `guideline source <폴더>` | 서버 최신 원본을 빈 폴더에 풉니다. 원본 경로로 고친 뒤 `propose --from <폴더>` 로 올립니다 |
| `guideline list [폴더]` | 원본 목록과 검사 결과. 폴더를 주면 그 폴더(`source` 로 받은 원본)를, 아니면 서버를 읽습니다 |
| `guideline proposals [번호]` | 번호가 없으면 서버의 제안 목록(번호, 상태, 제목, 올린 이, 프로젝트, 날짜, 파일 수)을 보입니다. `--status pending\|accepted\|rejected` 로 목록을 거릅니다. 번호를 주면 그 제안의 내용, Outdated 여부와 충돌 경로, 파일마다 종류와 기준 대비 차이를 보입니다. `--json` 은 서버 응답을 그대로 출력합니다. `--server`, `--source` 도 씁니다. 발급 토큰은 자기 제안만, 관리자 토큰과 범위 `admin` 토큰은 모두 봅니다. 수락·거절은 웹이나 API 로 합니다 |

`list` 는 스택(지침 파일과 칸, 스택 사이 바꿈), 스킬, 서브에이전트, MCP 서버를 보입니다.
하위 스택은 부모 아래에 들여 써서 경로 전체(`browser/browseros-neo`)로 보이고, 이름 뒤에 README frontmatter 의 `when` 이 붙습니다.
규칙에 맞지 않아 빠지는 파일(무시됨)과 고칠 것(경고)도 이유와 함께 보입니다.
경고가 있어도 종료 코드는 0 입니다.
쓰는 규칙은 원본의 `docs/authoring.md` 입니다.

`proposals` 의 번호가 양의 정수가 아니거나, `--status` 값을 모르거나, `--status` 와 번호를 함께 주면 사용 오류(종료 코드 2)입니다.
토큰이 볼 수 없는 제안은 「제안 없음」(종료 코드 1)입니다.
옛 서버는 차이를 보내지 않습니다. 그러면 `proposals <번호>` 가 그렇다고 알리고 파일 목록만 보입니다.

## 언어팩 명령

| 명령 | 하는 일 |
| --- | --- |
| `guideline locale list` | 쓸 수 있는 언어(패키지·사용자 폴더)와 지금 설정 |
| `guideline locale check <폴더>` | 언어팩 폴더를 정본(`en`)과 비교합니다. 빠진 키·남는 키·자리 표시가 다른 키·빠진 템플릿·`pack.json` 문제 |

언어팩 만드는 법은 [언어팩 더하기](how-to/add-a-language-pack.md)에 있습니다.

## 종료 코드

| 코드 | 뜻 |
| --- | --- |
| 0 | 성공 |
| 1 | 실행 실패(서버에 닿지 못함, 권한 없음, 쓰기 실패, 언어팩 문제 등). 출처 하나가 실패하고 나머지는 반영됐을 때도 1. 서버가 0.24 보다 옛날인 출처도 실패한 출처로 셉니다(아래 참고) |
| 2 | 잘못된 사용, ruler 프로젝트가 아님, 이름 겹침. 옛 배치 프로젝트의 `apply`·`status`·`propose`, 아직 받은 것이 없을 때의 `apply` 도 2 |
| 3 | `pick`: 제출하지 않음(취소, 탭 닫힘, 아무도 열지 않음). 아무것도 쓰지 않음 |

`pick --local` 은 폴더가 git 저장소가 아니거나(또는 git 이 2.31 보다 옛날), 아직 받은 것이 없거나, 옛 배치 프로젝트이거나, `--new` 와 함께 쓰면 2 로 끝납니다.
`local.json` 이나 `defaults.json` 을 읽을 수 없거나, 서버가 개인 폼을 모르면(「이 서버는 개인 폼을 모름」) 1 로 끝납니다.
`pick --yes` 는 `--recommend` 없이, `--new` 와 함께, 작업 트리에 커밋하지 않은 변경이 있거나 git 저장소 밖일 때(프로젝트 모드), 고정 블록의 뺌을 추천할 때 2 로 끝납니다. `pick --recommend`(`--yes`·`--local` 과 상관없이)는 원본에 없는 키, 더하고 빼는 같은 키, 빼라고 추천한 스택 안의 더함에 2 로 끝납니다. 그때는 아무것도 쓰지 않고, 옛 배치 프로젝트도 옮기지 않습니다.
`pick --local --role` 은 이름 규칙에 맞지 않는 역할 이름에도 2 로, `--local` 없는 `pick --role` 도 2 로 끝납니다.
`guideline role` 은 git 저장소 밖, 잘못된 이름이나 인자, 어느 단위도 정의하지 않은 역할을 `use` 로 고르면 2 로 끝납니다. `role use` 는 `guideline apply` 와 같은 코드로 끝납니다(1 쓰기 실패, 2 받은 것 없음·옛 배치).
`guideline agents` 는 모르는 동작이나 에이전트 이름, 이름 없음, 마지막 에이전트 빼기, 읽을 수 없는 `default_agents` 줄, 아직 받은 것 없음, 옛 배치에서 아무것도 쓰지 않고 2 로 끝납니다. 그 밖의 `add`·`remove` 는 `guideline apply` 와 같은 코드로 끝납니다.

서버가 0.24 보다 옛날이면 스택 선택을 받지 못합니다.
그러면 `pick` 은 그 출처의 폼을 취소하고 「서버가 CLI 보다 옛날」 이라고 알린 뒤 그 출처를 그대로 둡니다.
나머지 출처는 그대로 고르고, 실패한 출처가 있으니 종료 코드는 1 입니다. 고른 출처가 하나도 없을 때도 1 입니다.
서버를 올리거나 옛 CLI 를 쓰세요.
0.24 서버는 스택 폼의 `formVersion` 을 보내지 않는 CLI 를 426 으로 거절합니다(서버 언어에 따라 「guideline CLI 를 0.24.0 이상으로 업데이트 필요」 또는 「update the guideline CLI to 0.24.0 or newer」).

## 고르기 폼

`guideline pick` 이 여는 폼으로, 제목은 「프로젝트 지침 설정」 입니다. 항목마다 상태가 보입니다.

| 표시 | 뜻 | 체크하면 |
| --- | --- | --- |
| 같음 | 이미 원본대로 있음 | 그대로 둡니다 |
| 다름 | 있는데 원본과 다름 | 그대로 둡니다. **갱신**을 켜면 원본으로 덮어씁니다. **차이 보기**로 확인하세요 |
| 없음 | 아직 없음 | 추가합니다 |
| 원본 새로 나옴 | 받은 뒤 원본이 바뀜 | **갱신**이 처음부터 켜져 있습니다 |
| 프로젝트에서 고침 | 받은 뒤 프로젝트에서 고침 | 그대로 둡니다. **덮어쓰기**를 켜면 원본으로 되돌립니다 |

- **블록마다 세 칸 중 하나를 고릅니다: 사용 안 함 · 기본 · 고정.** 폼 맨 위 한 줄이 세 칸을 설명합니다.
  - **고정**: 모두 받고, 누구도 개인 선택에서 끌 수 없습니다(`guideline.json` 의 `required`).
  - **기본**: 모두 받고, 각자 `guideline pick --local` 에서 끌 수 있습니다.
  - **사용 안 함**: 프로젝트는 받지 않습니다. 각자 로컬에서 켤 수는 있습니다.
- **폼은 파일이 아니라 스택 단위로 고릅니다.** 스택 행의 칸 하나가 그 스택의 모든 파일을 가리키고, 그 아래 파일에는 따로 칸이 없습니다.
- **하위 스택은 나무로 보입니다.** 하위 스택은 부모 아래에 들여 쓰이고, 그것이 필요한 작업인 `when` 이 붙습니다. 하위 스택만 가진 부모(묶음 스택)도 한 행입니다.
  - 하위 스택을 기본이나 고정으로 두면 조상도 최소 기본으로 켜지고 **조상**이 붙습니다.
  - 부모를 골라도 하위는 골라지지 않습니다.
  - 조상을 사용 안 함으로 두면 그 자손이 모두 사용 안 함이 됩니다.
  - 하위 스택을 사용 안 함으로 두면 그 때문에 켜졌던 조상도 풀립니다. 단 직접 고른 조상, 아래에 다른 고른 하위 스택이 남은 조상, 다른 고른 블록이 `requires` 로 필요로 하는 조상은 남습니다.
- **이미 있는 블록을 사용 안 함으로 두면 「제거」 입니다.** 빨갛게 바뀌고 제출 버튼에 「제거 N 포함」 이 붙습니다. 원본에서 사라진 항목은 칸 대신 체크박스가 남습니다. 체크를 풀면 제거합니다.
- 단계 탭은 블록 수를 「고정 n · 기본 n」 으로 셉니다.
- 폼은 단계로 고릅니다: 1. 지침 → 2. MCP → 3. 서브에이전트 → 4. 스킬 → 5. 확인. 단계 탭을 눌러 아무 때나 오가고, **확인**에서 전체를 보고 제출합니다. 고를 것이 없는 단계는 건너뜁니다.
- 분류 버튼(`backend`, `browser` …)은 그 분류의 항목만 걸러 보입니다. 체크는 바꾸지 않습니다. **전체**로 되돌립니다.
- 블록이 다른 블록을 필요로 하면(`requires`) 고를 때 함께 체크되고 **의존성**이 붙습니다. 풀 수는 있지만 「X 없음 — Y 가 필요로 함」 경고가 남습니다.
- 도메인 스택(`<도구>__<도메인>`, 예: `deploy-package__gitlab.example.com`)은 도구 이름 옆에 도메인 꼬리표로 보입니다. 같은 도구라도 서버가 다르면 규칙이 다르니, 프로젝트가 쓰는 서버의 스택을 고르세요.
- 블록에 표시 이름(`label`)이 있으면 그 이름이 제목으로 보이고 실제 이름은 옆에 작게 붙습니다.
- `--recommend` 로 추천한 항목에는 **에이전트 추천**과 이유가 붙습니다. 빼라고 추천한 블록(`"remove"`)은 체크가 풀린 채로 시작하고 **에이전트 제거 추천**과 이유가 붙습니다(0.26 이상 서버).
- 작업 트리에 커밋하지 않은 변경이 있으면 경고가 뜨고, **그래도 진행**을 체크해야 제출됩니다. 먼저 커밋해 두면 반영 결과를 `git diff` 로 보기 쉽습니다.
- 원본에 경고가 있는 항목은 「반영 불가」 로 보이고 체크할 수 없습니다. 이유가 함께 보입니다.
- **확인**은 고른 블록을 **고정**·**기본** 으로 묶어 단계별로 보이고, 그 아래 갱신·제거 목록을 보입니다. 0.24 보다 옛 CLI 가 만든 폼은 고정을 다루지 못해 고정 칸이 꺼져 있습니다.
- 폼은 10분 안에 열지 않거나, 연 뒤 90초 동안 화면 신호가 없으면 만료됩니다.

### 개인 폼

`guideline pick --local` 은 같은 폼을 개인 모드로 엽니다. 제목은 「로컬에서 사용할 지침」 이고, 부제 끝에 「이 기계에만 저장 · 커밋되는 파일은 바뀌지 않음」 이 붙습니다.

- 맨 위 **고정** 묶음은 잠겨 있습니다. 고정 블록은 「고정 — 끌 수 없음」, 그 위의 스택은 「고정 블록을 품음 — 끌 수 없음」 으로 보입니다.
- 그 아래 **켜고 끄기** 묶음에 고정이 아닌 블록이 모두 있고, 블록마다 **켬**/**끔** 스위치가 있습니다. 프로젝트가 받는 블록은 **기본** 이 붙고 켜진 채로, 나머지는 꺼진 채로 시작합니다. 바꾼 블록에는 **내가 켬**·**내가 끔** 이 붙습니다.
- 저장되는 것은 여전히 프로젝트 선택과의 차이입니다. 기본 블록을 끄면 뺌, 사용 안 함 블록을 켜면 더함입니다(`local.json` 의 `add`/`remove`).
- 하위 스택을 켜면 조상도 켭니다. 스택을 끄면 그 아래 스택도 끕니다.
- 맨 위 줄이 무엇으로 미리 체크했는지 알립니다: 「내 이 프로젝트 선택」 또는 「내 기본값」.
- **확인**에 받는 블록 수(고정 · 기본 · 내가 켬), 켠 것·끈 것 목록과 **이 선택을 내 기본값으로** 칸이 있습니다. 커밋되는 것을 쓰지 않으므로 커밋 안 된 변경 경고는 없습니다.
- `--role <이름>` 이면 폼은 그 역할의 겹을 고칩니다. 제목은 「로컬에서 사용할 지침 — 역할 <이름>」 이고, 내 공통 선택이 더한 블록에는 **기본** 대신 **내 공통 선택** 이 붙습니다(이 표시는 0.28 CLI 가 필요합니다). 0.24 서버는 보통의 개인 폼을 보입니다.
- 모노레포 하위 디렉터리에서 개인 폼은 git 루트에서만 받는 스킬·서브에이전트·MCP 서버를 막지 않습니다. 그것들은 git 루트의 개인 선택에서 더하세요.

## 토큰 범위

| 토큰 | 할 수 있는 것 |
| --- | --- |
| 관리자 토큰(`ADMIN_TOKEN`) | 웹 로그인과 토큰 관리를 포함한 모든 것 |
| `read` | 지침 보기(`PUBLIC_READ=0` 일 때만 필요). `guideline login` 이 이 범위로 발급합니다 |
| `propose` | 제안 보내기, 자기 제안을 차이·내용과 함께 보기 |
| `admin` | 바로 반영(`apply: true`, `guideline propose`), 모든 제안을 차이·내용과 함께 보기(`guideline proposals`), API 로 수락·거절. 웹 로그인과 토큰 관리는 못 합니다 |

폐기한 토큰은 **토큰** 목록에서 지울 수 있습니다.
리비전이 가리키므로 DB 행은 숨겨 두고, 이름은 다시 쓸 수 있습니다.

## 관리자 웹

- **목록**은 스택·스킬·서브에이전트·MCP 서버를 보입니다. 목록에서는 블록만 추가합니다. 홈 카드는 최상위 스택만 보이고, 하위 스택은 부모 아래에 있습니다.
- **하위 스택**: 스택 페이지에 하위 스택 목록이 보이고(관리자에게는 **+ 하위 스택 추가** 버튼도), 하위 스택은 `/s/<부모>/<하위>` 에 `when` 이 보이는 자기 블록 페이지를 갖습니다.
- **블록 상세**: 왼쪽에 블록 목록, 그 오른쪽에 그 블록의 파일 트리(상시 ● · 참조 ○), 그다음에 고른 문서가 있습니다. 새 파일·올리기·이름 바꾸기·삭제·내려받기는 블록 상세에 있고, **블록 내려받기(.tar.gz)** 는 위쪽 버튼 줄에 있습니다.
- **블록 설정**(`/settings/<종류>/<이름>`, 관리자): 표시 이름·분류 저장, **필요한 블록** 고치기, **필요한 때**(`when`, 스택만) 정하기, 파일 추가·올리기, 블록 이름 바꾸기·삭제. 이름을 바꾸면 서브에이전트·스킬의 `name:` 줄과 다른 블록의 `requires` 도 함께 고칩니다. 스택 이름은 마지막 조각만 바뀌고, 그 하위 스택과 그 안을 가리키는 `requires` 키가 함께 바뀝니다. 스택을 다른 부모 아래로 옮기는 일은 웹에서 하지 않습니다. `guideline source` 와 `propose --from` 을 쓰세요.
- **파일 편집**은 저장 전에 경고를 미리 보입니다. **새 파일**은 언어팩의 `new-file/` 틀을 씁니다.
- **문서**(`/docs`)는 종류 탭 맨 앞에 있고, `docs/<이름>.md` 문서를 보고 만듭니다. 작성 규칙(`authoring.md`)과 관리 지침 추가분(`management.md`)은 「에이전트도 읽는 문서」 로 묶이고 웹에서 이름을 바꾸거나 지울 수 없습니다. 새 문서는 프로젝트로 보내지 않습니다.
- **사용법**은 `/llms.txt` 를 렌더링해 보이고 **링크 복사** 버튼이 있습니다. `PUBLIC_READ=0` 이어도 열립니다.
- **이력**과 **제안**은 30개씩 나눠 보입니다(`?page=`). 리비전·제안 상세는 왼쪽에 바뀐 파일 트리(종류 → 블록 → 파일), 가운데에 고른 파일 하나(`?file=`)를 보입니다. 80줄이 넘는 차이는 접힙니다. 이력에서 되돌리기도 합니다.
- **토큰**: 토큰을 발급·폐기·삭제합니다.
- **표시 이름**: 블록 frontmatter 의 `label`. 웹, 고르기 폼, `guideline list` 에 보입니다.
- **필요한 블록**: 블록 frontmatter 의 `requires: [rules/x]`.
- 로그인하지 않은 방문자에게는 편집·제안·토큰 버튼이 보이지 않고 위쪽에 **로그인**이 있습니다.

## 서버 API

토큰은 `Authorization: Bearer <토큰>` 으로 보냅니다.
공개 서버여도 틀린·폐기한 토큰을 보내면 401 입니다.

### 읽기 API

| 엔드포인트 | 돌려주는 것 |
| --- | --- |
| `GET /api/v1/health` | 인증 없음. 서버 버전, 스키마, API 수준(`api: 2`), 최신 리비전, `publicRead` |
| `GET /api/v1/whoami` | 보낸 토큰을 `{ kind, name, scope }` 로. 관리자 토큰은 `{ kind: "admin", name: null, scope: "admin" }`, 발급 토큰은 `{ kind: "token", name, scope }`. 토큰이 없거나 틀리거나 폐기됐으면 `PUBLIC_READ=1` 이어도 401 |
| `GET /api/v1/catalog` | 스택·스킬·서브에이전트·MCP 서버와 그 분류, 표시 이름(`labels`), 필요한 블록(`requires`) |
| `GET /api/v1/tree` | 원본 파일 트리 |
| `GET /api/v1/files/<경로>?rev=` | 원본 파일 하나 |
| `GET /api/v1/archive?rev=` | 원본 전체(tar.gz). CLI 가 씁니다 |
| `GET /api/v1/revisions`, `GET /api/v1/revisions/<번호>` | 리비전 |

### 제안

| 엔드포인트 | 하는 일 |
| --- | --- |
| `POST /api/v1/proposals` | 제안을 만듭니다(범위 `propose` 토큰). 본문 `{ title, description?, project?, changes: [{ path, text \| base64 \| delete: true, base: <sha256> \| null }] }`. 관리자 토큰이나 범위 `admin` 토큰은 `apply: true` 를 더해 바로 반영할 수 있습니다. 변경 500개·20MB 까지 |
| `GET /api/v1/proposals?status=` | 제안 목록(`pending`·`accepted`·`rejected`, `status` 가 없으면 전부), 최신순. 발급 토큰은 자기 제안만, 관리자 토큰과 범위 `admin` 토큰은 모두 봅니다 |
| `GET /api/v1/proposals/<번호>` | 제안 하나. 상태 확인과 검토에 씁니다: 내용, `outdated`, `conflicts`, `changes: [{ path, kind, base }]`. 발급 토큰은 자기 제안만(남의 것은 404), 관리자 토큰과 범위 `admin` 토큰은 모두 봅니다. `?diff=1` 은 change 마다 `diff` 를 붙입니다: 기준 내용에서 제안 내용으로의 unified diff(라벨 `base`·`proposal`), 어느 쪽이든 텍스트가 아니면 `null`. `?content=1` 은 올릴 때와 같은 형식의 내용을 붙입니다: `text`(NUL 없는 UTF-8), 아니면 `base64`, 지움이면 `delete: true`. 둘은 함께 쓸 수 있고, 없으면 응답은 그대로입니다 |
| `POST /api/v1/proposals/<번호>/accept`, `POST /api/v1/proposals/<번호>/reject` | 수락·거절(관리자 토큰이나 범위 `admin` 토큰). 거절만 본문 `{ note }` 를 받을 수 있음. 충돌이면 `conflicts` 와 함께 409 |

제안은 파일마다 새 내용(또는 삭제)과 올린 쪽이 본 원본 해시(`base`)를 담습니다.
수락할 때 원본이 그대로면 제안대로, 바뀌었으면 줄 단위 3-way merge 로 합칩니다.
한 파일이라도 겹치면 수락할 수 없습니다(Outdated).
수락은 리비전 하나입니다(생성 경로 `proposal`, 작성자 = 토큰 이름, 메시지 「제안 #<번호>: <제목>」).

### CLI 로그인과 폼

- **CLI 로그인**: `guideline login` 이 `/cli/login` 을 엽니다. 관리자 세션에서 **발급**을 누르면 2분짜리 한 번 쓰는 코드가 CLI 의 `127.0.0.1` 콜백으로 갑니다. CLI 는 그 코드를 `POST /api/v1/cli/token` 에서 읽기 토큰(이름 `cli-<호스트>-<6자>`)으로 바꿉니다. `DELETE /api/v1/tokens/self` 는 보낸 토큰을 폐기합니다(`guideline logout`).
- **폼**: `POST /api/v1/forms`(본문 2MB)가 폼을 만들고 `/forms/<id>?k=<링크 토큰>` 을 돌려줍니다. 비공개 서버는 읽기 토큰이 필요하고, 공개 서버는 누구나 폼을 만들 수 있습니다. 그 링크는 그 폼 하나만 다루고, 처음 열 때 쿠키로 바뀌어 주소에서 빠집니다. `GET /api/v1/forms/<id>/result?wait=` 는 결과를 기다립니다. 요청 본문에는 스택 선택을 뜻하는 `formVersion: 2` 가 들어가고, 없으면 426 으로 거절합니다. 응답에는 `modes: ["project", "personal"]` 이 있습니다. 본문이 `mode: "personal"` 이면 개인 폼을 열고, 결과는 `{ mode: "personal", add, remove, saveDefault, rejected: [] }`(별칭을 입힌 블록 키)입니다. 고정 블록의 뺌은 400 으로 거절합니다. 토큰으로 만든 폼은 그 토큰에게만, 토큰 없이 만든 폼은 관리자나 링크 토큰을 `X-Form-Link` 헤더로 보낸 요청에게만 결과를 줍니다. 끝난 지 하루가 지난 폼은 새 폼을 만들 때 지웁니다.
- **`/llms.txt`**: 에이전트를 위한 사용·세팅 안내입니다. 로그인 없이 열립니다. 언어팩의 `templates/llms.txt` 에 `{{SERVER}}` 를 `PUBLIC_URL` 로 채운 것이고, 요청마다 새로 만듭니다.

## 지침의 표지 문구

도구는 사람이 쓴 지침에서 정해진 문구를 찾아 해석합니다.
이 표지는 언어팩이 아니라 코드에 고정돼 있고, **언어 설정과 상관없이 영어·한국어를 둘 다 읽습니다.**
영어가 정본입니다.

| 쓰는 곳 | 영어(정본) | 한국어 |
| --- | --- | --- |
| 스택 README 의 다른 스택 바꿈 표 절 | `## Overrides of other stacks` | `## 다른 스택을 바꾸는 것` |
| 바꿈 표 셀 | `` `<file>` "<section title>" `` | `` `<파일>` 「<절 제목>」 `` |
| 바꿈 절의 첫 줄 | ``Overrides: `<stack>/<file>` "<section title>"`` | ``바꾸는 절: `<스택>/<파일>` 「<절 제목>」`` |
| MCP README 의 항목 만들기 절 | `## Build on apply` | `## 반영할 때 항목 만들기` |

## 다음 문서

- [설정](configuration.md)
- [문제 해결](troubleshooting.md)
