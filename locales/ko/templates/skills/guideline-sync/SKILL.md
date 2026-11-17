---
name: guideline-sync
description: 지침 서버의 지침 중 이 프로젝트에 맞는 것을 골라 반영하고, 최신으로 맞추고, CLI 가 남긴 할 일을 처리한다. "지침 받아와", "지침 내보내", "공용 지침 적용", "guideline 동기화", "지침 최신으로" 같은 요청에 쓴다.
---

<!-- 이 파일은 지침 서버가 처음 시작할 때 씨앗으로 넣는다. 이후로는 원본으로 관리한다(웹 편집·제안). 팀 사정에 맞게 고쳐도 된다. -->

# guideline-sync

**이 스킬은 지침을 받을 프로젝트에서 실행한다.** 파일을 쓰는 것은 `guideline` CLI 다. 받은 지침은 `.guideline/` 의 사본이고, `guideline apply` 가 그 사본으로 에이전트 파일(생성물: `.ruler/<스택>/`, `.ruler/guideline.md`, `docs/guideline/`, `.ruler/ruler.toml` 등, `.gitignore` 에 적힌다)을 조합한다. 이 스킬은 CLI 를 부르고, CLI 가 혼자 하지 못한 일(할 일 목록)을 처리한다.

## 전제 확인

1. `guideline help` 가 되는지 본다. 안 되면 `npm install -g guideline-manage` 로 설치하자고 안내하고 멈춘다.
2. 서버 주소: 이 프로젝트의 `guideline.json` 의 `server`, 없으면 환경 변수 `GUIDELINE_SERVER`. 둘 다 없으면 사용자에게 묻고 명령마다 `--server <URL>` 을 붙인다.
3. 「로그인 필요」 가 나오면 사용자에게 `! guideline login --server <URL>` 을 실행하게 한다. 브라우저에서 「발급」 을 누르면 토큰이 저장된다.
4. 이 디렉터리에 `.ruler/` 가 없으면 명령이 「ruler 프로젝트가 아님」 로 멈춘다. 그대로 알리고 멈춘다 — 기존 지침을 ruler 로 옮기는 일은 사용자가 한다.
5. 모노레포의 하위 디렉터리(자기 `.ruler/` 가 있는 곳)에서 실행하면 그 디렉터리만 다룬다. 스킬·서브에이전트·MCP 는 git 루트에서 받는다(하위에서는 「반영 불가」 로 보인다).
6. **출처가 여럿일 수 있다.** `guideline.json` 의 `sources` 에 출처(지침 서버)마다 `server`·`items`·`aliases` 가 있다. 명령은 모든 출처를 다루고, 한 출처만 다룰 때는 `--source <이름>` 을 붙인다. 새 출처는 `guideline pick --source <이름> --server <URL>` 로 추가한다.
7. **프로젝트가 옛 배치(사본이 `.ruler/<스택>/`)로 받은 것이면** `status`·`propose`·`apply` 가 「이 프로젝트는 아직 옛 배치」 라며 코드 2 로 멈춘다. `guideline update --json` 을 한 번 돌린다: 프로젝트를 `.guideline/` 로 옮긴다(서버가 필요하고, 디렉터리 안의 추적 파일에 커밋 안 된 변경이 있으면 「먼저 커밋하거나 stash 하라」 며 멈추니 사용자에게 먼저 커밋하게 한다). 그 뒤 사용자가 `git status` 를 확인하고 커밋한다.
8. **「이름 충돌」 로 멈추면**(코드 2) 두 출처가 같은 이름의 스택·스킬·서브에이전트·MCP 를 준 것이다. 내용은 서로 다르다. 안내에 나온 별칭(예: `"rules/base": "company-base"`)을 사용자에게 보여 주고, 고른 이름을 `guideline.json` 의 `sources.<출처>.aliases` 에 써서 다시 `guideline pick --source <출처>` 를 한다.

## 무엇을 할지

먼저 `guideline status --json` 으로 상태를 보고 한 줄로 알린다(뒤처진 항목 수, 프로젝트에서 고친 파일).

| 요청 | 명령 |
| --- | --- |
| 처음 받기, 항목 추가·빼기("지침 내보내", "이 스택 추가") | `guideline pick --json` |
| 프로젝트에 맞는 지침을 골라 달라("맞는 지침 받아와", "알아서 골라") | 아래 「추천해서 받기」 |
| 고른 그대로 최신으로("지침 최신으로") | `guideline update --json` |
| 새로 클론한 뒤나 새 워크트리, 또는 `status` 가 생성물이 낡았다고 할 때 | `guideline apply --json`(서버가 필요 없다). 그 전에 `ruler apply` 만 돌리지 않는다 |
| 새 프로젝트("새 프로젝트에 지침") | `guideline pick --new <이름 또는 경로> --json` |
| 고친 사본을 원본에 올리기("이 수정 공용으로") | `guideline propose --dry-run` 으로 보여 주고, 맞으면 `guideline propose --title "<제목>"`. 보내면 어떻게 되는지는 dry-run 이 알린다(`--json` 이면 `mode`). `apply`(「보내면 바로 반영됨」)면 보내기 전에 사용자에게 검토 없이 바로 반영된다고 알리고, 사용자가 검토를 원하면 `--review` 를 붙인다 |

## pick

1. `guideline pick --json` 을 **시간 제한 없이 백그라운드로** 실행한다. stderr 의 `폼: <주소>` 를 사용자에게 알린다 — 브라우저가 열리지 않았으면 그 주소를 열게 한다.
2. **폼 제출이 사용자의 확인이다.** 반영하기 전에 다시 묻지 않는다.
3. 종료 코드: 0 이면 반영이 끝났다(stdout 의 JSON 에 쓴 파일과 할 일이 있다). 3 이면 사용자가 취소했거나 폼이 만료됐다 — 아무것도 쓰지 않았다. 멈추고 알린다. 1·2 면 stderr 를 그대로 보고한다.

## 추천해서 받기

1. `guideline list --json` 으로 원본 목록을 읽는다. 블록 키는 `categories`·`labels`·`requires` 맵의 키와 같다: `rules/<스택>`, `skills/<이름>`, `agents/<이름>.md`, `mcp/<이름>`. 지침 파일의 `when` 은 그 파일을 언제 읽는지, 하위 스택의 `when`(JSON 의 `stacks[].when`, 부모 스택은 `stacks[].parent`)은 어떤 작업에 필요한지다. 스택은 중첩된다: `rules/browser/browseros-neo` 는 `rules/browser` 의 하위 스택이다.
2. 프로젝트의 설정 파일·패키지·쓰는 도구를 보고 블록을 고른다. **하위 스택의 `when` 을 읽고 이 프로젝트에 맞는 하위 스택을 고른다.** 폼이 고른 하위 스택의 조상 스택도 함께 체크하므로 조상은 적지 않아도 된다. 이유는 프로젝트에서 찾은 근거로 쓴다(예: 「`lefthook.yml` 이 있음」). 근거가 없는 블록은 넣지 않는다.
3. 추천을 JSON 파일로 쓴다 — `{"rules/base": "모든 프로젝트 공통", "rules/lefthook": "lefthook.yml 이 있음"}`. 필요한 블록(`requires`)은 폼이 함께 체크하므로 따로 넣지 않아도 된다.
4. `guideline pick --recommend <파일> --json` 을 「pick」 절처럼 백그라운드로 돌린다. 폼은 추천이 미리 체크된 채로 열린다. 사용자에게 폼에서 훑어보고 제출하라고 알린다 — **폼 제출이 확인이다.** 폼에 「에이전트 추천」 표시가 없으면 서버가 0.19 보다 옛 버전이다 — 사용자에게 알리고 폼에서 직접 고르게 한다.
5. 출처가 여럿이면 `--source <이름>` 을 붙여 출처마다 한다(코드 2 로 멈추면 이것이다). 원본에 없는 키면 코드 2 로 멈추고 그 키를 알린다 — 목록을 다시 읽고 고친다.

## 할 일 처리

`pick`·`update`·`status`·`apply` 의 JSON 에 있는 `todos` 를 하나씩 처리한다.

| kind | 처리 |
| --- | --- |
| `mcp-build` | `data.text` 는 원본 `mcp/<이름>/README.md` 다. 그 `## 반영할 때 항목 만들기` 절대로(`guideline list` 에서는 「반영할 때 README 로 만듦」 로 보인다) 이 프로젝트의 값을 읽어 항목을 만든다. 쓰기 전에 만든 항목과 값마다 어디서 읽었는지 보여 주고 확인받는다. 읽은 원문에 사용자 정보·토큰(`https://<사용자>:<토큰>@…`)이 있으면 원문을 옮기지 않고 뽑은 값만 적는다. 자리는 `.ruler/ruler.project.toml` 의 `[mcp_servers.<이름>]` 이다(서버가 에이전트마다 다르면 `[agents.<에이전트>.mcp_servers.<이름>]`). `.ruler/ruler.toml` 은 `guideline apply` 가 다시 만든다. 다른 서버·키·서식은 건드리지 않는다 |
| `env` | 설정할 환경 변수(`data.vars`)와 README 의 발급 방법을 알린다 |
| `setup` | `docs/guideline/<스택>/SETUP.md` 를 읽고 `## 확인` 으로 이미 됐는지 본 뒤, 안 됐으면 `## 세팅` 을 사용자와 함께 한다. 프로젝트가 아직 그 기술을 쓰지 않아도 건너뛰지 않는다 — 스택을 고른 것이 그 기술을 들이기로 한 결정이고, 세팅이 들이는 단계다. 할 수 없는 단계는 건너뛰지 말고 사용자에게 알린다 |
| `conflict` | 같은 이름의 파일·항목이 이미 있고 원본과 다르다. 차이를 보여 주고 고르게 한다 |
| `skipped` | 프로젝트에서 고친 파일이라 건너뛰었다. 원본에 올릴지(`guideline propose`), 덮어쓸지(`guideline update --force`) 묻는다 |
| `override` | 바꿈 절이 원본에 없는 파일·절을 가리킨다. 바꿈 절의 첫 줄을 고친다 |
| `subagents-off` | 서브에이전트 사본은 `.guideline/` 에 있지만 조합하지 않았다. `.ruler/ruler.project.toml` 에 `[agents] enabled = true` 를 켤지 묻고(켜면 `.gitignore` 에 생성물이 추가된다), 켜면 `guideline apply` 를 돌린다 |
| `ruler-apply` | 안내한 명령을 실행해도 되는지 묻는다 |
| `apply` | 에이전트 파일(생성물)이 낡았다(`status` 에서, 또는 쓰지 못한 채 끝난 이전 뒤). `guideline apply` 를 돌린다. 커밋하기 전에 돌린다. 안 그러면 `git add -A` 가 옛 사본을 다시 넣는다 |
| `root-apply` | git 루트에 아직 `.ruler/ruler.toml` 이 없어 모노레포 단위의 `apply` 가 ruler 를 돌지 않았다. git 루트에서 `guideline apply` 를 먼저 돌리고(또는 거기에 `nested = true` 인 `.ruler/ruler.toml` 을 직접 두고) 단위에서 다시 돌린다 |
| `removed-upstream` | 알리고, 지우려면 `guideline pick` 을 하자고 한다 |
| `missing-requires` | 받은 블록(`item`)이 필요로 하는 블록(`data.missing`, 원본 키)을 받지 않았다. 빠진 블록을 알리고, 그 블록을 담은 추천 파일(`{"<빠진 블록>": "<item> 이 필요로 함"}`)을 써서 `guideline pick --recommend <파일> --json` 을 「추천해서 받기」 처럼 띄운다 — 폼 제출이 확인이다. 출처가 여럿이면(`item` 이 `<출처>:` 로 시작) `--source <출처>` 를 붙인다 |
| `blocked` | 원본 경고로 반영하지 못했거나, `.guideline/` 의 파일을 조합하지 못했다(문구에 그 경로가 있다). 사본은 그대로 있다. 원본(또는 그 파일)을 고치자고 보고한다 |
| `no-copy` | 고른 항목인데 `.guideline/` 에 사본이 없어(막힘, 또는 만들어야 하는 MCP 항목) 조합하지 않았다. `guideline update` 로 이유를 본다 |
| `override-unchosen` | `.guideline/overrides/<스택>/` 이 고르지 않은 스택의 것이라 조합하지 않았다. 스택을 고를지, 바꿈을 지울지 묻는다 |
| `leftover` | 폼에서 체크를 풀었거나 원본이 고른 스택에서 뺐지만 사본이 원본과 달라 지우지 않았다. 차이를 보여 주고 지울지 묻는다 |
| `nested-off` | git 루트의 `.ruler/ruler.project.toml` 에 `nested = true` 를 켤지 묻는다. 켜지 않으면 ruler 가 이 디렉터리의 지침을 만들지 않는다 |
| `mcp-conflict` | 받은 MCP 표를 `.ruler/ruler.toml` 에 넣지 못했다: 프로젝트의 `ruler.project.toml` 에 같은 이름의 표가 이미 있거나(프로젝트 것을 둔다) TOML 모양이 겹친다. 표를 보여 주고 정리하게 한다. 받은 MCP 표를 프로젝트에서 고쳤다면 `.guideline/mcp/<이름>/server.json` 을 고쳐 `guideline propose`(`guideline-export` 스킬)로 올린다. 고친 표는 `ruler.project.toml` 에 남고 `status` 에는 MCP 가 current 로 보인다 |
| `untracked` | 이제 생성물인데 git 이 아직 추적 중이거나, CLI 가 git 인덱스에서 뺐거나(`git rm --cached`, 파일은 디스크에 남는다), git 에 물어보지 못해 명령을 알려 준다. 명령을 보여 주고 사용자가 허락할 때만 실행한다. `git status` 를 확인하고 커밋하라고 알린다 |
| `stray-ruler-output` | ruler 가 `.ruler/ruler.toml` 없이 돌아(보통 클론 직후의 `ruler apply`) 모든 에이전트 몫을 썼다. CLI 는 ruler 표시가 있는 `CLAUDE.md` 를 지웠거나, 표시가 없어 두었다. 사용자에게 알린다. 두었다면 `AGENTS.md` 를 Claude Code 에게서 가리는지 보고 지우기 전에 묻는다. 검사는 `CLAUDE.md` 만 하므로 ruler 가 쓴 다른 에이전트의 파일은 남아 있을 수 있다 |
| `migrated` | 프로젝트를 새 배치로 옮겼다. 무엇이 옮겨졌는지, `git status` 로 확인하고 커밋해야 함을 알린다. 나머지 할 일을 처리한다 |
| `manifest-v3` | `guideline.json` 을 버전 3(스택 단위)으로 다시 썼고, 고른 스택의 나머지 파일이 더해졌다. 알리고, `guideline.json` 을 함께 커밋하게 한다 |
| `prepare` | `package.json` 의 `prepare` 가 `ruler apply` 대신 `guideline apply` 를 돌게 바뀌었다. 바뀐 것을 보여 주고 사용자가 확인해 커밋한다 |
| `dev-dependency` | `guideline-manage` 가 이 프로젝트의 의존성에 없어 `prepare` 를 바꾸지 않았다. 안내한 명령(개발 의존성으로 추가)을 실행하고 `guideline apply` 를 돌리면 `prepare` 가 바뀐다 |
| `apply-hook` | `package.json` 이 없어 클론 뒤에 에이전트 파일을 만들어 줄 곳이 없다. 프로젝트의 세팅 단계에 `guideline apply` 를 더한다(Orca 면 `orca.yaml` 의 `scripts.setup`) |
| `adopted` | `propose` 가 뺀 사본이다. 처음 받을 때 이미 원본과 달랐다 — 옛 판이면 올리는 순간 원본 변경을 되돌린다. 차이를 보여 주고, 프로젝트에서 고친 것이 맞을 때만 `guideline propose --only <항목>` 으로 올린다. 옛 판이면 `guideline update --force` 로 맞추자고 한다 |
| `alias` | 별칭 문제다. 「스택 자리가 바뀜」 면 그 자리의 바꿈 파일을 새 자리(`.guideline/overrides/<새 이름>/`)로 옮기자고 한다. 「원본에 해당 단위 없음」·「같은 별칭을 두 단위에 지정함」 면 `guideline.json` 의 `aliases` 를 고친다 |

## 멈추는 곳

커밋하지 않는다. 바뀐 파일 목록과 처리한 할 일, 남은 할 일을 보고한다. 생성물은 `.gitignore` 에 적혀 커밋되지 않고, `.guideline/`·`guideline.json`·`guideline-lock.json`·`.ruler/ruler.project.toml` 은 커밋한다고 알린다. MCP 를 반영했으면 Codex 는 신뢰한 프로젝트에서만 `.codex/config.toml` 을 읽는다는 것도 알린다.

## 지킬 것

- **`.guideline/` 의 사본(`overrides/` 만 빼고 모두)은 직접 고치지 않고, 생성물(`.ruler/<스택>/`, `.ruler/guideline.md`, `docs/guideline/`, `.ruler/ruler.toml`)도 고치지 않는다.** CLI 가 쓰고, 생성물은 다음 `guideline apply` 가 덮어쓴다. ruler 설정은 `.ruler/ruler.project.toml` 에 둔다.
- 이 프로젝트에만 다르게 할 것은 바꿈에 쓴다(관리 지침이 자리와 형식을 말한다). 받은 스택 폴더(`.guideline/rules/<스택>/`, 하위 폴더 포함) 안에 프로젝트 파일을 두지 않는다. 「원본에서 사라짐」 으로 보인다.
- **비밀값을 프로젝트 파일에 쓰지 않는다.** 사용자가 값을 알려 줘도 환경 변수로 두라고 안내한다.
