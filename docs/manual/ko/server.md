# 지침 서버 운영

[English](../server.md) · 한국어

지침 원본을 두는 서버(`guideline-server`)를 띄우고 관리하는 법이다.

## 무엇이 있나

- 웹: 블록 목록(스택·스킬·서브에이전트·MCP)과 블록 상세(블록 목록·문서·그 블록의 파일), 블록 추가, 블록 설정(표시 이름·분류·파일 추가·이름 바꾸기·삭제), 파일 편집(저장 전 경고 보기), 새 파일, 블록 내려받기(tar.gz), 문서(`docs/<이름>.md`), 사용법(llms.txt 렌더링), 이력·차이·되돌리기, 토큰 발급·폐기·삭제, 제안 검토(차이·충돌·고치기·수락·거절)
- 읽기 API `/api/v1`: `health`, `catalog`, `tree`, `files/<경로>`, `revisions`, `revisions/<번호>`, `whoami`(보낸 토큰의 종류·이름·범위). 토큰은 `Authorization: Bearer <토큰>`
- 제안 API `/api/v1/proposals`: 범위 propose 토큰은 제안, 관리자 토큰이나 범위 admin 토큰은 `apply: true` 로 바로 반영하고 `POST /api/v1/proposals/<번호>/accept|reject` 로 수락·거절한다. 사람은 웹 「제안」 에서 검토한다

## Docker Compose 로 띄우기

저장소 루트의 `compose.yaml` 이 `server/Dockerfile` 로 서버 이미지를 빌드하고, 데이터는 `DATA_HOST_DIR` 에 둔다.

```bash
git clone https://github.com/jang2162/guideline-manage.git
cd guideline-manage
cp .env.example .env          # 아래 표대로 채운다
docker compose up -d --build
```

Git 저장소에서 Compose 파일을 바로 배포하는 도구도 같은 방식으로 쓴다. 예를 들어 Komodo Git Repo Stack 이면 File Paths 에 `compose.yaml`, Environment 에 아래 변수를 넣는다. push 할 때 자동으로 다시 배포하는 기능은 끈다. CLI 만 바꾼 커밋에도 서버가 다시 빌드되기 때문이다.

## 환경 변수

| 키 | 필수 | 설명 | 예시 |
| --- | --- | --- | --- |
| `ADMIN_TOKEN` | 필수(비밀) | 관리자 토큰. 32자 이상. `.env` 나 배포 도구의 비밀 저장소에 두고 Git 에는 넣지 않는다 | |
| `PUBLIC_URL` | 필수 | 사용자가 여는 주소. 이 주소가 아닌 곳(서버 IP:포트 등)에서 열면 로그인·저장이 403 이다 | `https://guideline.example.com` |
| `DATA_HOST_DIR` | 필수 | DB(`guideline.db`)와 백업(`backups/`)을 둘 호스트 경로. uid 1000 이 쓸 수 있어야 한다 | `/data/guideline` |
| `HOST_PORT` | 선택(3000) | 호스트에 여는 포트 | `3000` |
| `PUBLIC_READ` | 선택(1) | 1 이면 지침 보기(웹 화면, 읽기 API, CLI 의 pick·update·list)를 로그인·토큰 없이 연다. 0 이면 웹은 관리자 로그인, API·CLI 는 읽기 토큰이 있어야 한다. 바꾸기·제안 검토·토큰 관리는 언제나 관리자만 | `0` |
| `BACKUP_KEEP` | 선택(14) | 남길 자동 백업 수 | `30` |
| `TRUST_PROXY` | 선택(0) | 리버스 프록시(하나) 뒤면 1. 프록시가 덧붙인 `X-Forwarded-For` 의 마지막 값으로 로그인 제한을 건다 | `1` |
| `GUIDELINE_LANG` | 선택(en) | 관리자 웹·API 오류·`/llms.txt`·빈 서버 씨앗의 언어. 한국어는 `ko`. 모르는 코드면 시작 로그에 경고하고 영어로 뜬다 | `ko` |
| `GUIDELINE_SEED` | 선택(on) | `off` 면 빈 서버에 씨앗을 넣지 않는다. 옛 문서 저장소 클론을 통째로 옮길 때 쓴다 | `off` |
| `GUIDELINE_LOCALES_DIR` | 선택 | 사용자 언어팩 폴더. 없으면 데이터 폴더의 `locales/`(Docker 는 `DATA_HOST_DIR/locales/`) | |

TLS 와 리버스 프록시는 서버의 기존 구성에 맡긴다.

## 처음 띄우기

1. 서버에 `DATA_HOST_DIR` 을 만들고 `sudo chown 1000:1000 <경로>` 한다.
2. `openssl rand -base64 48` 로 관리자 토큰을 만들어 `.env` 의 `ADMIN_TOKEN` 에 넣는다.
3. `docker compose up -d --build` 한다. 로그(`docker compose logs`)에 `guideline-server listening on port 3000` 이 나온다. 빈 DB 면 `seeded the empty server with <언어> guidelines (r1)` 도 나온다.
4. `PUBLIC_URL` 을 연다. 지침·이력 보기와 내려받기는 로그인 없이 된다(`PUBLIC_READ=0` 이면 로그인해야 한다). 편집·되돌리기·제안 검토·토큰 관리는 상단 「로그인」(`/login`)에서 관리자 토큰으로 로그인한 뒤 한다.
5. 지침을 채운다: 목록에서 블록을 추가하고 블록 상세의 「새 파일」, 또는 관리자 토큰으로 `POST /api/v1/proposals` 에 `apply: true`(→ [guide.md](guide.md) 「지침 서버 띄우기」).

## 업그레이드

새 릴리스를 받고(`git pull` 이나 `git checkout v<버전>`) `docker compose up -d --build` 한다. 서버가 다시 빌드되고, 시작할 때 DB 스키마를 올린다. 올리기 직전에 `backups/guideline-pre-v<버전>-<시각>.db` 를 만든다(자동으로 지우지 않는다).

시작하지 않으면 로그의 첫 줄이 이유다.

| 로그 | 조치 |
| --- | --- |
| `… is not set`, `… must be at least 32 characters` | `.env` 를 고치고 다시 띄운다 |
| `cannot write to … (chown 1000:1000)` | `DATA_HOST_DIR` 을 `chown 1000:1000` |
| `DB schema vN is newer than this server (vM) …` | 더 새 이미지로 배포했다가 되돌린 것이다. 새 버전으로 다시 배포하거나, 업그레이드 전 백업으로 복구 |

운영 로그와 설정 오류는 언어 설정과 상관없이 영어다.

## 백업과 복구

- 시작할 때와 그 뒤 24시간마다 `backups/guideline-<YYYYMMDD-HHmmss>.db`(UTC)를 만들고, `BACKUP_KEEP` 개보다 오래된 것은 지운다.
- 블록 상세의 「내려받기(.tar.gz)」 는 그 블록을 원본 구조로 준다. 원본 전체는 `GET /api/v1/archive`(CLI 가 쓰는 것)다.

복구:

1. `docker compose stop` 한다.
2. 서버에서 `cp <DATA_HOST_DIR>/backups/<백업>.db <DATA_HOST_DIR>/guideline.db` 하고 `guideline.db-wal`, `guideline.db-shm` 을 지운다.
3. `docker compose start` 한다.

## 프로젝트 반영 (0.12)

- **CLI 로그인**: `guideline login` 이 `/cli/login` 을 연다. 관리자 세션으로 「발급」 하면 2분짜리 한 번 쓰는 코드가 CLI 의 `127.0.0.1` 콜백으로 가고, CLI 가 `POST /api/v1/cli/token` 으로 읽기 토큰(이름 `cli-<호스트>-<6자>`)으로 바꾼다. 발급한 토큰은 「토큰」 화면에서 폐기한다.
- **폼**: `POST /api/v1/forms`(읽기 토큰, 본문 2MB)가 폼을 만들고 `/forms/<id>?k=<링크 토큰>` 을 돌려준다. 그 링크는 그 폼 하나만 다루고, 처음 열 때 쿠키로 바뀌어 주소에서 빠진다. 10분 안에 안 열면, 연 뒤 90초 동안 화면 신호가 없으면 만료된다. 끝난 지 하루가 지난 폼은 새 폼을 만들 때 지운다.
- **새 API**: `GET /api/v1/archive?rev=`(tar.gz), `GET /api/v1/forms/<id>/result?wait=`, `POST /api/v1/cli/token`, `DELETE /api/v1/tokens/self`. `/api/v1/health` 는 `api: 2` 를 낸다.
- **스키마 2**: `forms` 표가 추가된다. 0.11 서버의 DB 는 시작할 때 백업한 뒤 올린다.
- **`/llms.txt`**: 로그인 없이 여는 사용·세팅 안내(언어팩의 `templates/llms.txt`, `{{SERVER}}` 를 `PUBLIC_URL` 로 채운다). 관리자 웹 상단 「사용법」 과 로그인 화면에서 연결된다.

## 제안 (0.13)

- **스키마 3**: `proposals`, `proposal_changes`. 0.12 서버의 DB 는 시작할 때 백업한 뒤 올린다.
- 제안은 파일마다 새 내용(또는 삭제)과 올린 쪽이 본 원본 해시(base)를 담는다. 수락할 때 원본이 그대로면 제안대로, 바뀌었으면 줄 단위 3-way merge 로 합친다. 한 파일이라도 겹치면 수락할 수 없다(Outdated).
- 수락은 리비전 하나다(출처 `proposal`, 작성자 = 토큰 이름, 메시지 「제안 #<번호>: <제목>」).
- 발급 토큰은 자기 제안만 본다. `apply: true` 는 관리자 토큰만 된다.

## 언어와 씨앗 (0.15)

- **언어**: 서버 프로세스 하나에 언어 하나다(`GUIDELINE_LANG`). 화면 안에서 언어를 바꾸는 메뉴는 없다. 사용자 언어팩은 `GUIDELINE_LOCALES_DIR` 이나 데이터 폴더의 `locales/<코드>/` 에 두고 서버를 다시 띄운다(→ [locales.md](locales.md)).
- **씨앗**: 리비전이 하나도 없는 서버가 시작하면 서버 언어의 `docs/authoring.md`, `skills/guideline-sync/SKILL.md`, `skills/guideline-export/SKILL.md` 를 리비전 1(작성자 `system`, 출처 `seed`)로 넣는다.
- **스키마 4**: 리비전 출처에 `seed` 가 추가된다. 0.14 서버의 DB 는 시작할 때 백업한 뒤 올린다.

## 공개 읽기 (0.16)

- **`PUBLIC_READ`**(기본 1): 지침 보기(웹 화면, 읽기 API, CLI 의 pick·update·list)를 로그인·토큰 없이 연다. 0 이면 0.15 처럼 웹은 관리자 로그인, API·CLI 는 읽기 토큰이 있어야 한다.
- 바꾸기(편집·되돌리기·업로드), 제안 화면·API, 토큰 관리, CLI 로그인 승인은 설정과 상관없이 관리자(제안 API 는 토큰)만 한다. 로그인하지 않은 화면에는 그 버튼이 보이지 않고 상단에 「로그인」 이 있다.
- 공개여도 틀린·폐기한 토큰을 보내면 401 이다.
- 공개 서버는 토큰 없이 폼(`POST /api/v1/forms`)을 만든다. 그 결과는 폼 주소의 링크 토큰을 `X-Form-Link` 헤더로 보내야 본다.
- `/api/v1/health` 가 `publicRead` 를 낸다. 토큰 없이 받으려면 CLI 0.16 이상이어야 한다(0.15 CLI 는 토큰이 없으면 서버에 묻기 전에 멈춘다).

## 블록과 admin 토큰 (0.17)

- **웹은 블록 중심이다.** 목록은 스택·스킬·서브에이전트·MCP 를 보이고, 블록 상세는 왼쪽에 블록 목록, 가운데에 고른 문서, 오른쪽에 그 블록의 파일을 둔다. 새 파일·올리기·이름 바꾸기·삭제·내려받기는 블록 상세에 있고, 목록에서는 블록만 추가한다. 옛 파일 탐색(`/f/…`, `/d/…`)과 전체 내보내기(`/export.tar.gz`)는 없어졌다.
- **설정**은 블록에 속하지 않는 것(작성 규칙, 뼈대 스택, 목록에서 빠진 항목, 경고)을 둔다. **사용법**은 llms.txt 를 렌더링해 보이고 「링크 복사」 버튼이 있다. `PUBLIC_READ=0` 이어도 열린다.
- **도메인 스택**: `<도구>__<도메인>` 이름의 스택은 도구 이름 옆에 도메인 꼬리표로 보인다. 경로와 API 의 이름은 그대로다.
- **토큰 범위 `admin`**: 바로 반영(`apply: true`, `guideline propose --apply`. 0.20 부터는 `guideline propose` 의 기본), 모든 제안 보기, API 로 수락·거절. 웹 로그인과 토큰 관리는 못 한다.
- **토큰 삭제**: 폐기한 토큰은 목록에서 지울 수 있다. 리비전이 가리키므로 DB 행은 숨겨 두고, 이름은 다시 쓸 수 있다.
- **스키마 5**: 토큰에 `admin` 범위와 삭제 표시가 추가된다. 0.16 서버의 DB 는 시작할 때 백업한 뒤 올린다.

## 웹 정리 (0.18)

- **문서 화면**(`/docs`)이 0.17 의 「설정」(`/settings`)을 대신한다. 종류 탭 맨 앞에 있고, `docs/<이름>.md` 문서를 보고 만든다. 작성 규칙(`authoring.md`)과 관리 지침 추가분(`management.md`)은 「에이전트도 읽는 문서」로 묶이고 웹에서 이름을 바꾸거나 지울 수 없다. 새 문서는 프로젝트로 보내지 않는다.
- 블록 밖 파일, 목록에서 빠진 항목, 경고를 보이는 화면은 없어졌다. 웹은 이 서비스로 만든 블록과 문서만 다룬다.
- **블록 설정**(`/settings/<종류>/<이름>`, 관리자): 표시 이름·분류 저장, 새 파일·올리기, 블록 이름 바꾸기(서브에이전트·스킬의 `name:` 줄도 고침)·삭제. 블록 상세 오른쪽에는 파일 트리(상시 ● · 참조 ○)와 이 페이지로 가는 버튼만 남고, 「블록 내려받기」는 위쪽 버튼 줄로 옮겼다.
- **표시 이름**: 블록 frontmatter 의 `label`. 웹, 내보내기 폼, `guideline list` 에 보이고 `/api/v1/catalog` 에 `labels` 맵으로 추가된다.
- **이력·제안**: 목록은 30개씩 나누고(`?page=`, 옛 `?before=` 는 무시), 리비전·제안 상세는 왼쪽에 바뀐 파일 트리(종류 → 블록 → 파일), 가운데에 고른 파일 하나(`?file=`)를 보인다. 80줄이 넘는 차이는 접힌다.
- 스키마는 그대로다.

## 고르기 흐름 (0.19)

- **필요한 블록**: 블록 frontmatter 의 `requires: [rules/x]`. 내보내기 폼에서 함께 체크되고, `/api/v1/catalog` 에 `requires` 맵으로 추가된다. 웹 블록 설정의 「필요한 블록」 에서 고치고, 블록 이름을 바꾸면 다른 블록의 `requires` 도 함께 고친다.
- **에이전트 추천**: `guideline pick --recommend <파일>` 로 연 폼은 추천 블록이 미리 체크돼 있고 이유가 보인다. 폼은 단계(지침 → MCP → 서브에이전트 → 스킬 → 확인)로 고르고, 분류 버튼은 거르기만 한다.
- **⚠️ 이미 돌고 있는 서버**: `guideline-sync` 스킬과 작성 규칙(`docs/authoring.md`)은 서버를 처음 띄울 때만 들어가는 씨앗이다. 기존 서버는 웹에서 그 스킬에 「추천해서 받기」 절을, 작성 규칙에 「필요한 블록」 절을 직접 추가한다(언어팩 `templates/` 의 같은 파일을 참고). `llms.txt` 는 요청마다 새로 만들어 바로 바뀐다.
- 스키마는 그대로다.

## admin 토큰은 바로 반영 (0.20)

- **`GET /api/v1/whoami`**: 보낸 토큰을 `{ kind, name, scope }` 로 돌려준다 — 관리자 토큰은 `{ kind: "admin", name: null, scope: "admin" }`, 발급 토큰은 `{ kind: "token", name, scope }`. 토큰이 없거나 틀리거나 폐기됐으면 `PUBLIC_READ=1` 이어도 401 이다.
- **범위 `admin` 토큰이면 `guideline propose` 가 바로 반영한다.** 먼저 `whoami` 로 범위를 보고, `admin` 이면 `apply: true` 로, 아니면 예전처럼 제안으로 보낸다. `--review` 는 늘 제안으로 보내고, `--apply` 는 예전처럼 명시해서 바로 반영하며, 둘을 같이 주면 사용법 오류(종료 코드 2)다. 결과에 admin 토큰이라 바로 반영했다는 줄이 붙고, `--dry-run` 은 보내면 둘 중 어느 쪽인지 알리며, `--json` 에는 `mode`(`apply` 또는 `proposal`)가 추가된다.
- **`guideline status` 와 `guideline login` 이 토큰 범위를 보인다**(`status --json` 은 `token`).
- **버전이 섞일 때**: 0.20 CLI 가 옛 서버에 붙으면 `whoami` 가 404 라 예전처럼 제안으로 보내고, status·login 은 범위를 보이지 않는다. 옛 CLI 는 0.20 서버에서 예전과 같다.
- **⚠️ 이미 돌고 있는 서버**: `guideline-export` 스킬은 서버를 처음 띄울 때만 들어가는 씨앗이다. 그 2번 단계는 사용자가 검토 없이 반영하라고 했을 때만 `--apply` 를 쓰라고 했다. 기존 서버는 웹에서 그 단계를 「admin 토큰이면 `guideline propose` 가 바로 반영하고, 검토를 받으려면 `--review`」 로 고친다(언어팩 `templates/skills/guideline-export/SKILL.md` 참고). `guideline-sync` 의 「고친 사본을 원본에 올리기」 행도 같다. `llms.txt` 는 요청마다 새로 만들어 바로 바뀐다.
- 스키마는 그대로다.

## 로컬에서 띄우기

```bash
cp .env.example .env    # ADMIN_TOKEN, PUBLIC_URL=http://localhost:3000, DATA_HOST_DIR 을 채운다
docker compose up --build
```

Docker 없이: `ADMIN_TOKEN=… PUBLIC_URL=http://localhost:3000 DATA_DIR=./.data node server/bin/guideline-server.js`
