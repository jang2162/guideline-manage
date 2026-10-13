# 이용 가이드

[English](../guide.md) · 한국어

팀 공용 에이전트 지침을 **지침 서버**에 두고, 프로젝트에서 `guideline` CLI 로 골라 받는 방법을 처음부터 끝까지 정리한다. 명령의 모든 옵션은 [usage.md](usage.md), 서버 운영(배포·백업)은 [server.md](server.md) 에 있다.

에이전트에게는 서버의 `/llms.txt`(예: `http://localhost:3000/llms.txt`)를 읽히면 된다. 같은 내용을 에이전트용으로 줄인 것이다.

```
지침 원본(서버 DB) ── 관리자 웹: 보기·편집·이력·토큰
        │
        ▼  guideline pick / update (로그인한 CLI)
프로젝트: 사본 + guideline.json(고른 항목) + guideline-lock.json(반영 기록)
```

## 1. 준비 (머신마다 한 번)

**Node 24 이상**이 필요하다.

CLI 를 설치하고 확인한다.

```bash
npm install -g guideline-manage   # guideline 명령이 생긴다
guideline help
```

이 저장소의 클론에서 바로 쓰려면 `node <저장소>/cli/bin/guideline.js <명령>` 으로 부르거나, 저장소 루트에서 `pnpm link --global` 한다.

셸 설정에 둘 것:

```bash
export GUIDELINE_LANG=ko                    # CLI 메시지와 프로젝트에 쓰는 글을 한국어로(기본은 영어)
export GUIDELINE_PROJECTS_DIR=~/IdeaProjects   # 새 프로젝트를 폴더 이름만으로 만들 때의 상위 경로
```

## 2. 지침 서버 띄우기 (로컬)

이미 떠 있는 서버를 쓰면 건너뛴다. 저장소 루트에 `.env` 를 만든다(git 이 무시한다).

```bash
cat > .env <<EOF
ADMIN_TOKEN=$(openssl rand -base64 48)
PUBLIC_URL=http://localhost:3000
DATA_DIR=./.data
GUIDELINE_LANG=ko
EOF
node --env-file=.env server/bin/guideline-server.js
```

- `ADMIN_TOKEN` 은 32자 이상이어야 하고, 관리자 웹의 로그인 비밀번호 역할을 한다. 바꾸면 모든 로그인 세션이 끊긴다.
- **반드시 `PUBLIC_URL` 의 주소로 연다.** `127.0.0.1:3000` 처럼 다른 주소로 열면 로그인·저장이 거부된다.
- 데이터는 `.data/guideline.db` 하나이고, 시작할 때와 하루마다 `.data/backups/` 에 백업이 생긴다. 새 버전으로 다시 띄우면 DB 를 백업한 뒤 스키마를 올린다.
- `GUIDELINE_LANG` 은 관리자 웹과 빈 서버에 넣는 씨앗의 언어다(기본 영어).
- Docker Compose 로 띄우는 법은 [server.md](server.md).

처음 띄운 서버에는 **씨앗**이 리비전 1 로 들어간다: 작성 규칙 `docs/authoring.md` 와 씨앗 스킬 `guideline-sync`·`guideline-export`(서버 언어로). 지침은 목록의 「+ 스택 추가」 등으로 블록을 만들고 블록 상세의 「새 파일」 로 채우거나, 관리자 토큰으로 제안 API 에 `apply: true` 를 주어 한꺼번에 올린다(변경 500개·20MB 까지). 옛 문서 저장소 클론을 통째로 옮길 때는 `GUIDELINE_SEED=off` 로 빈 서버를 띄운 뒤 올린다 — 씨앗과 같은 경로가 충돌하지 않게.

```bash
curl -s -X POST http://localhost:3000/api/v1/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"처음 채움","apply":true,"changes":[{"path":"rules/base/00-agent.md","text":"---\nload: always\n---\n\n# 에이전트\n","base":null}]}'
```

`http://localhost:3000` 을 열면 로그인 없이(`PUBLIC_READ=0` 이면 로그인해야) 스택·스킬·서브에이전트·MCP 를 볼 수 있다. 편집·제안 검토·토큰 관리는 상단 「로그인」 에서 관리자 토큰으로 로그인한 뒤 한다. 상단의 「사용법」 이 `/llms.txt` 다.

## 3. 로그인 (머신마다 한 번)

```bash
guideline login --server http://localhost:3000
```

브라우저가 열린다. 관리자 웹에 로그인돼 있지 않으면 관리자 토큰으로 로그인한 뒤 「발급」 을 누른다. 터미널에 `로그인 성공: http://localhost:3000 (cli-<호스트>-…)` 가 나오면 끝이다.

- 읽기 토큰은 `~/.config/guideline/credentials.json`(권한 600)에 저장된다. 서버마다 따로 저장된다.
- 브라우저를 쓸 수 없는 곳(원격 셸)에서는 웹 「토큰」 화면에서 토큰을 발급해 `guideline login --server <URL> --token-stdin` 으로 넣는다.
- CI 에서는 환경 변수 `GUIDELINE_TOKEN` 을 쓴다.
- 그만 쓸 때는 `guideline logout --server <URL>`. 로컬 토큰을 지우고 서버에서도 폐기한다.

## 4. 프로젝트에 지침 받기

**ruler 를 쓰는 프로젝트만 받을 수 있다.** 그 디렉터리에 `.ruler/` 가 있어야 한다. 없으면 「ruler 프로젝트가 아님」 로 멈춘다 — 기존 CLAUDE.md·AGENTS.md 지침을 `.ruler/` 로 옮긴 뒤 받는다.

프로젝트 루트(git 저장소)에서 실행한다.

```bash
cd ~/IdeaProjects/my-app
guideline pick --server http://localhost:3000   # 두 번째부터는 --server 를 빼도 된다(guideline.json 에 남는다)
```

CLI 가 서버에서 원본을 받아 프로젝트와 비교하고, 그 결과로 서버에 폼을 만든 뒤 브라우저로 연다. **폼을 제출할 때까지 터미널은 기다린다.**

### 폼에서 고르기

도메인 스택(`<도구>__<도메인>`, 예: `deploy-package__gitlab.develma.com`)은 도구 이름 옆에 도메인 꼬리표로 보인다. 같은 도구라도 서버가 다르면 규칙이 다르니, 프로젝트가 쓰는 서버의 스택을 고른다. 블록에 표시 이름(`label`)이 있으면 그 이름이 제목으로 보이고 실제 이름은 옆에 작게 붙는다.

| 표시 | 뜻 | 체크하면 |
| --- | --- | --- |
| 같음 | 이미 원본대로 있다 | 그대로 둔다 |
| 다름 | 있는데 원본과 다르다 | 그대로 둔다. 「갱신」 을 켜면 원본으로 덮어쓴다. 「차이 보기」 로 확인한다 |
| 없음 | 아직 없다 | 추가한다 |
| 원본 새로 나옴 | 받은 뒤 원본이 바뀌었다 | 「갱신」 이 처음부터 켜져 있다 |
| 프로젝트에서 고침 | 받은 뒤 프로젝트에서 고쳤다 | 그대로 둔다. 「덮어쓰기」 를 켜면 원본으로 되돌린다 |

- **이미 있는 항목의 체크를 풀면 「제거」** 다. 빨갛게 바뀌고 제출 버튼에 「제거 N 포함」 이 붙는다.
- 폼은 **단계**로 고른다: 1. 지침 → 2. MCP → 3. 서브에이전트 → 4. 스킬 → 5. 확인. 위의 단계 탭을 눌러 아무 때나 오가고, 「확인」 에서 전체를 보고 제출한다. 고를 것이 없는 단계는 건너뛴다.
- 분류 버튼(`backend`, `browser` …)은 그 분류의 항목만 **걸러 보인다**. 체크는 바꾸지 않는다. 「전체」 로 되돌린다.
- 블록이 다른 블록을 필요로 하면(`requires`) 고를 때 함께 체크되고 「의존성」 이 붙는다. 풀 수는 있지만 「X 없음 — Y 가 필요로 함」 경고가 남는다.
- 에이전트에게 "맞는 지침 받아와" 라고 하면 에이전트가 블록을 골라 `guideline pick --recommend` 로 폼을 연다. 추천 항목에는 「에이전트 추천」 과 이유가 붙어 있다. 훑어보고 제출하면 된다.
- 작업 트리에 커밋하지 않은 변경이 있으면 경고가 뜬다. 「그래도 진행」 을 체크해야 제출된다. 먼저 커밋해 두면 반영 결과를 `git diff` 로 보기 쉽다.
- 원본에 경고가 있는 항목은 「반영 불가」 로 보이고 체크할 수 없다. 이유가 함께 보인다.

### 제출하면

터미널에 쓴 파일, 지운 파일, **할 일**이 나온다.

```
반영 완료(r3) — 쓴 파일 5, 지운 파일 1
  쓰기  .ruler/base/01-git.md
  쓰기  docs/guideline/mise/SETUP.md
  지우기  docs/guideline/tiergear/02-orca-spawn.md
할 일
  - mise: 세팅 문서대로 세팅 — docs/guideline/mise/SETUP.md
```

할 일은 CLI 가 혼자 못 하는 일이다(MCP 비밀값, 환경 변수, 세팅 문서, 이미 있는 것과의 충돌 등). 직접 하거나 에이전트에게 맡긴다(6절).

마지막으로 바뀐 파일을 확인하고 **직접 커밋한다.** `guideline.json`·`guideline-lock.json` 도 함께 커밋한다. CLI 는 커밋하지 않는다.

### 프로젝트에 생기는 것

| 무엇 | 자리 |
| --- | --- |
| 상시 지침 | `.ruler/<스택>/NN-*.md` |
| 참조 지침 | `docs/guideline/<스택>/` + 색인 `.ruler/<스택>/99-reference.md` |
| 세팅 문서 | `docs/guideline/<스택>/SETUP.md` |
| 스킬·서브에이전트 | `.ruler/skills/`, `.ruler/agents/`(`[agents] enabled = true` 일 때) |
| MCP | `.ruler/ruler.toml` |
| 관리 지침 | `.ruler/guideline.md` |

- 반영 뒤 git 루트에서 `ruler apply` 가 필요하다. 프로젝트에 ruler 가 설치돼 있으면 CLI 가 돌리고, 없으면 할 일로 알린다.

### 모노레포의 하위 디렉터리

`packages/api` 처럼 자기 `.ruler/` 가 있는 하위 디렉터리에서 `guideline pick` 하면 그 디렉터리가 따로 단위가 된다. 매니페스트·잠금·사본이 모두 그 안에 생기고, 루트의 지침을 다시 쓰지 않는다.

- 스킬·서브에이전트·MCP 는 git 루트에서만 받는다. 하위에서는 「반영 불가」 로 보인다.
- 루트에 이미 받은 스택은 폼에 「루트에 이미 있음」 으로 보인다. 같은 지침이 두 번 들어가지 않게 고르지 않는 것이 보통이다.
- git 루트의 `.ruler/ruler.toml` 에 `nested = true` 가 없으면 할 일(`nested-off`)로 알린다. 켜야 ruler 가 그 디렉터리의 CLAUDE.md·AGENTS.md 를 만든다.
- 하위 디렉터리에 `.ruler/ruler.toml` 이 없으면 `pick` 이 에이전트 목록만 담아 만든다.

### 여러 출처에서 받기

한 프로젝트가 여러 지침 서버(출처)에서 받을 수 있다. 예를 들어 개인 서버에서 도구 스택을, 사내 서버에서 사내 스택을 받는다.

1. **출처를 추가한다.** 서버마다 한 번씩 `guideline login --server <URL>` 를 한 뒤, `guideline pick --source <이름> --server <URL>` 로 그 서버의 폼을 열어 고른다. 이름은 영문 소문자로 시작하고 소문자·숫자·`-` 로 32자까지다.
2. **이름이 겹치면 별칭을 준다.** 두 출처가 같은 이름의 스택(스킬·서브에이전트·MCP)을 주면 폼에서 「다른 출처가 이미 쓰는 이름」 로 막히고, 매니페스트로 억지로 고르면 `pick` 이 「이름 충돌」 로 멈춘다. 그 출처의 `guideline.json` 칸에 별칭을 적는다:

   ```json
   "company": { "server": "https://guideline.example.com", "items": [], "aliases": { "rules/base": "company-base" } }
   ```

   그러면 사내 `base` 는 `.ruler/company-base/` 로 들어오고, 바꿈 첫 줄도 `company-base/<파일>` 로 쓴다. 별칭을 바꾸면 예전 자리 사본은 지워지고, 그 자리의 바꿈 파일은 할 일(`alias`)로 알린다.
3. **최신으로 유지한다.** `guideline status`·`guideline update` 는 모든 출처를 본다(`--source` 로 하나만). 한 서버가 안 되면 그 출처만 그대로 두고 나머지를 반영한다.
4. **제안은 출처마다 따로 간다.** `guideline propose` 는 고친 사본을 출처별로 나눠 각 서버에 제안 하나씩 올린다.

관리 지침(`.ruler/guideline.md`)에는 각 원본의 `docs/management.md` 가 `## <출처> 추가 지침` 으로 붙는다. 사내 원본 관리자가 모든 사내 프로젝트에 퍼뜨릴 운영 규칙을 여기에 쓴다.

## 5. 새 프로젝트 만들기

```bash
guideline pick --new my-new-app    # GUIDELINE_PROJECTS_DIR/my-new-app
guideline pick --new ~/work/x      # 경로도 된다(절대경로나 ~)
```

폼 맨 위에서 에이전트(claude, codex, opencode)를 고른다. 형태는 늘 ruler 다. 제출하면 폴더를 만들고 `git init` 한 뒤 반영한다. **취소하면 폴더가 생기지 않는다.**

## 6. 에이전트에게 맡기기

지침을 받은 프로젝트에는 `guideline-sync` 스킬이 함께 들어간다(스킬 항목을 골랐다면). 에이전트에게 "지침 최신으로 맞춰줘", "지침 내보내줘" 라고 하면 스킬이 `status`·`update`·`pick` 을 부르고 할 일을 처리한다.

스킬이 없는 프로젝트나 다른 에이전트에게는 "`http://localhost:3000/llms.txt` 를 읽고 지침을 받아줘" 라고 하면 된다. llms.txt 에 할 일 종류마다 처리 방법이 있다.

## 7. 최신으로 유지하기

```bash
guideline status            # 무엇이 바뀌었나
guideline update            # 고른 그대로 최신으로
guideline update --force    # 프로젝트에서 고친 파일까지 원본으로
guideline pick              # 고른 항목 자체를 바꿀 때
```

`status` 의 상태:

| 상태 | 뜻 | 할 것 |
| --- | --- | --- |
| 최신 | 원본·프로젝트 모두 그대로 | 없음 |
| 원본 새로 나옴 | 원본이 바뀌었다 | `update` |
| 프로젝트에서 고침 | 사본을 프로젝트에서 고쳤다 | `guideline propose` 로 원본에 올리거나, 바꿈으로 옮기거나, `update --force` |
| 둘 다 바뀜 | 둘 다 바뀌었다 | 차이를 보고 정한다 |
| 없어짐 | 사본이 지워졌다 | `update` 가 다시 쓴다 |
| 반영 안 됨(충돌) | 처음 받을 때 이미 있던 것과 달라 쓰지 않았다 | `pick` 에서 「차이 보기」 후 「갱신」 |
| 원본에서 사라짐 | 원본에서 지워졌다 | `pick` 에서 지운다 |

`update` 는 **프로젝트에서 고친 파일을 건너뛰고** 할 일(`skipped`)로 알린다. 고친 내용을 잃지 않게 하려는 것이다.

## 8. 이 프로젝트에만 다르게 하기 (바꿈)

사본을 고치지 말고 **바꿈**을 쓴다. 바꿈은 프로젝트 소유라 `update` 가 건드리지 않는다.

- 자리: `.ruler/<스택>/override.md` 나 `.ruler/<스택>/override.d/*.md`

바꿈마다 첫 줄에 무엇을 바꾸는지 쓴다.

```markdown
## base 프로젝트 바꿈

### 커밋 메시지는 영어로

바꾸는 절: `base/01-git.md` 「커밋 메시지」

이 프로젝트는 외부 기여자가 있어 커밋 메시지를 영어로 쓴다.
```

파일 전체를 바꾸면 「」 를 뺀다. 원본에서 그 파일이나 절이 사라지면 할 일(`override`)로 알린다.

## 9. 스택 세팅 문서

세팅이 필요한 스택(예: `mise`)에는 `docs/guideline/<스택>/SETUP.md` 가 함께 온다. 새로 받았거나 원본이 바뀌면 할 일(`setup`)이 나온다. 문서의 `## 확인` 으로 이미 됐는지 보고, 안 됐으면 `## 세팅` 을 따른다. 프로젝트를 새로 클론한 사람도 이 문서를 따른다.

## 10. 지침 원본 고치기

원본은 **제안**으로 바뀐다. 관리자가 웹 「제안」 에서 수락하면 리비전이 되고, 각 프로젝트는 `guideline update` 로 받는다. 관리자는 웹에서 바로 고칠 수도 있다.

제안하려면 범위 `propose` 토큰이 필요하다. 관리자에게 받아 `guideline login --server <URL> --token-stdin` 으로 넣는다.

범위 `admin` 토큰은 검토 없이 바로 반영한다. 이 토큰으로 `guideline propose` 를 하면 제안이 대기하지 않고 바로 원본이 된다. 그래도 검토를 받으려면 `--review` 를 붙인다. 저장된 토큰의 범위는 `guideline status` 가 보이고, `guideline propose --dry-run` 은 보내면 둘 중 어느 쪽인지 알린다. 에이전트는 `POST /api/v1/proposals/<번호>/accept`·`/reject` 로 다른 제안을 수락·거절할 수 있다. admin 토큰은 웹 로그인과 토큰 관리에는 쓸 수 없다.

**받은 사본을 고쳤으면** 프로젝트에서:

```bash
guideline propose --dry-run                     # 원본 모양으로 되돌린 변경과 차이
guideline propose --title "base: 커밋 규칙 다듬기"
```

**새 지침·스킬·MCP 를 올리려면** 원본 작업 사본에서:

```bash
guideline source /tmp/gl-src                    # 빈 폴더에 최신 원본을 푼다
# /tmp/gl-src 의 rules/ skills/ agents/ mcp/ 를 원본 경로로 고친다 (규칙은 docs/authoring.md)
guideline list /tmp/gl-src                      # 경고가 없는지 본다
guideline propose --from /tmp/gl-src --dry-run
guideline propose --from /tmp/gl-src --title "rules: 배포 규칙을 deploy 스택으로 올림"
```

에이전트에게는 「이 프로젝트의 지침을 공용으로 올려줘」 라고 하면 `guideline-export` 스킬이 후보를 가려내고 위 흐름으로 제안한다.

**제안 검토(관리자).** 웹 「제안」 에서 파일마다 차이를 본다. 원본이 그사이 바뀌었으면 겹치지 않는 변경은 합친 결과가, 같은 곳을 고쳤으면 충돌(Outdated)이 보인다. 충돌은 「고치기」 로 풀거나 그 파일을 빼거나, 제안을 거절한다.

## 11. 문제 해결

| 증상 | 원인과 할 것 |
| --- | --- |
| `서버 주소 없음` | `--server <URL>` 을 주거나 `GUIDELINE_SERVER` 를 설정한다 |
| `로그인 필요: guideline login --server …` | 토큰이 없거나 폐기됐다. 안내된 명령을 실행한다 |
| 메시지가 영어로 나온다 | 기본 언어는 영어다. `GUIDELINE_LANG=ko` 를 둔다(서버는 서버 환경에) |
| `CLI 버전이 낮음 — guideline-manage 업데이트 필요` | 서버가 0.12.0 보다 낮은 CLI 를 거부했다. `npm install -g guideline-manage` 로 올린다 |
| `제출되지 않음: 만료됨` (코드 3) | 폼을 10분 안에 열지 않았거나, 탭을 닫고 90초가 지났다. 아무것도 쓰지 않았다. `pick` 을 다시 한다 |
| 폼에 「이미 끝난 폼」 | 제출·취소·만료된 폼이다. 터미널에서 `pick` 을 다시 한다 |
| `서버에서 폼이 사라짐` | 기다리는 동안 서버 데이터가 바뀌었다. `pick` 을 다시 한다 |
| 관리자 웹 로그인·저장이 403 | `PUBLIC_URL` 과 다른 주소로 열었다. `PUBLIC_URL` 주소로 연다 |
| 할 일 `conflict` | 같은 이름이 이미 있고 원본과 다르다. `pick` 의 「차이 보기」 로 보고 「갱신」 을 켜거나 그대로 둔다 |
| `ruler 프로젝트가 아님` | 그 디렉터리에 `.ruler/` 가 없다. 기존 지침을 `.ruler/` 로 옮긴 뒤 다시 한다 |
| `CLAUDE.md 형은 더 이상 지원하지 않음` | 0.12 의 CLAUDE.md 형으로 받은 프로젝트다. ruler 로 옮기고 `guideline pick` 을 다시 한다 |
| `제안 권한이 없는 토큰` | 읽기 토큰이다. 관리자에게 범위 propose 토큰을 받아 `--token-stdin` 으로 넣는다 |
| 웹 「제안」 에서 수락 버튼이 막힘 | 원본과 같은 곳을 고쳐 충돌했다(Outdated). 「고치기」 로 풀거나 거절한다 |
