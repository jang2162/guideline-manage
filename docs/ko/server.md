# 지침 서버 운영

[English](../server.md) · 한국어

지침 원본을 두는 서버(`guideline-server`)를 띄우고 관리하는 법이다.

## 무엇이 있나

- 관리자 웹: 목록, 파일 보기·편집(저장 전 경고 보기), 새 파일, 삭제, 이름 바꾸기, 올리기, 이력·차이·되돌리기, 토큰 발급·폐기, 내보내기(tar.gz), 제안 검토(차이·충돌·고치기·수락·거절)
- 읽기 API `/api/v1`: `health`, `catalog`, `tree`, `files/<경로>`, `revisions`, `revisions/<번호>`. 토큰은 `Authorization: Bearer <토큰>`
- 제안 API `/api/v1/proposals`: 범위 propose 토큰은 제안, 관리자 토큰은 `apply: true` 로 바로 반영. 웹 「제안」 에서 검토·수락한다

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
5. 지침을 채운다: 관리 웹의 「새 파일」, 또는 관리자 토큰으로 `POST /api/v1/proposals` 에 `apply: true`(→ [guide.md](guide.md) 「지침 서버 띄우기」).

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
- 웹의 「내보내기」 는 최신 지침을 옛 저장소와 같은 구조의 tar.gz 로 준다. 사람이 받는 백업이다.

복구:

1. `docker compose stop` 한다.
2. 서버에서 `cp <DATA_HOST_DIR>/backups/<백업>.db <DATA_HOST_DIR>/guideline.db` 하고 `guideline.db-wal`, `guideline.db-shm` 을 지운다.
3. `docker compose start` 한다.

## 프로젝트 반영 (0.12)

- **CLI 로그인**: `guideline login` 이 `/cli/login` 을 연다. 관리자 세션으로 「발급」 하면 2분짜리 한 번 쓰는 코드가 CLI 의 `127.0.0.1` 콜백으로 가고, CLI 가 `POST /api/v1/cli/token` 으로 읽기 토큰(이름 `cli-<호스트>-<6자>`)으로 바꾼다. 발급한 토큰은 「토큰」 화면에서 폐기한다.
- **폼**: `POST /api/v1/forms`(읽기 토큰, 본문 2MB)가 폼을 만들고 `/forms/<id>?k=<링크 토큰>` 을 돌려준다. 그 링크는 그 폼 하나만 다루고, 처음 열 때 쿠키로 바뀌어 주소에서 빠진다. 10분 안에 안 열면, 연 뒤 90초 동안 화면 신호가 없으면 만료된다. 끝난 지 하루가 지난 폼은 새 폼을 만들 때 지운다.
- **새 API**: `GET /api/v1/archive?rev=`(tar.gz), `GET /api/v1/forms/<id>/result?wait=`, `POST /api/v1/cli/token`, `DELETE /api/v1/tokens/self`. `/api/v1/health` 는 `api: 2` 를 낸다.
- **스키마 2**: `forms` 표가 더해진다. 0.11 서버의 DB 는 시작할 때 백업한 뒤 올린다.
- **`/llms.txt`**: 로그인 없이 여는 사용·세팅 안내(언어팩의 `templates/llms.txt`, `{{SERVER}}` 를 `PUBLIC_URL` 로 채운다). 관리자 웹 상단 「사용법」 과 로그인 화면에서 연결된다.

## 제안 (0.13)

- **스키마 3**: `proposals`, `proposal_changes`. 0.12 서버의 DB 는 시작할 때 백업한 뒤 올린다.
- 제안은 파일마다 새 내용(또는 삭제)과 올린 쪽이 본 원본 해시(base)를 담는다. 수락할 때 원본이 그대로면 제안대로, 바뀌었으면 줄 단위 3-way merge 로 합친다. 한 파일이라도 겹치면 수락할 수 없다(Outdated).
- 수락은 리비전 하나다(출처 `proposal`, 작성자 = 토큰 이름, 메시지 「제안 #<번호>: <제목>」).
- 발급 토큰은 자기 제안만 본다. `apply: true` 는 관리자 토큰만 된다.

## 언어와 씨앗 (0.15)

- **언어**: 서버 프로세스 하나에 언어 하나다(`GUIDELINE_LANG`). 화면 안에서 언어를 바꾸는 메뉴는 없다. 사용자 언어팩은 `GUIDELINE_LOCALES_DIR` 이나 데이터 폴더의 `locales/<코드>/` 에 두고 서버를 다시 띄운다(→ [locales.md](locales.md)).
- **씨앗**: 리비전이 하나도 없는 서버가 시작하면 서버 언어의 `docs/authoring.md`, `skills/guideline-sync/SKILL.md`, `skills/guideline-export/SKILL.md` 를 리비전 1(작성자 `system`, 출처 `seed`)로 넣는다.
- **스키마 4**: 리비전 출처에 `seed` 가 더해진다. 0.14 서버의 DB 는 시작할 때 백업한 뒤 올린다.

## 공개 읽기 (0.16)

- **`PUBLIC_READ`**(기본 1): 지침 보기(웹 화면, 읽기 API, CLI 의 pick·update·list)를 로그인·토큰 없이 연다. 0 이면 0.15 처럼 웹은 관리자 로그인, API·CLI 는 읽기 토큰이 있어야 한다.
- 바꾸기(편집·되돌리기·업로드), 제안 화면·API, 토큰 관리, CLI 로그인 승인은 설정과 상관없이 관리자(제안 API 는 토큰)만 한다. 로그인하지 않은 화면에는 그 버튼이 보이지 않고 상단에 「로그인」 이 있다.
- 공개여도 틀린·폐기한 토큰을 보내면 401 이다.
- 공개 서버는 토큰 없이 폼(`POST /api/v1/forms`)을 만든다. 그 결과는 폼 주소의 링크 토큰을 `X-Form-Link` 헤더로 보내야 본다.
- `/api/v1/health` 가 `publicRead` 를 낸다. 토큰 없이 받으려면 CLI 0.16 이상이어야 한다(0.15 CLI 는 토큰이 없으면 서버에 묻기 전에 멈춘다).

## 로컬에서 띄우기

```bash
cp .env.example .env    # ADMIN_TOKEN, PUBLIC_URL=http://localhost:3000, DATA_HOST_DIR 을 채운다
docker compose up --build
```

Docker 없이: `ADMIN_TOKEN=… PUBLIC_URL=http://localhost:3000 DATA_DIR=./.data node server/bin/guideline-server.js`
