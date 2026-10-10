# guideline-manage

[English](README.md) · 한국어

팀 공용 코딩 에이전트 지침(스택별 규칙, 스킬, 서브에이전트, MCP 설정)을 **지침 서버**에 두고, 프로젝트에서 `guideline` CLI 로 골라 받는 도구다. 프로젝트에는 [ruler](https://github.com/intellectronica/ruler) 소스(`.ruler/`)로 반영된다.

```
지침 서버(원본 DB) ── 관리자 웹: 보기·편집·이력·제안 검토·토큰
        │  ▲
        │  │ guideline propose (제안 → 관리자가 수락)
        ▼  │
프로젝트: guideline pick / status / update → .ruler/ 사본 + guideline.json + guideline-lock.json
```

## 설치

Node 24 이상이 필요하다.

```bash
npm install -g guideline-manage   # guideline 명령이 생긴다
```

서버는 이 저장소에서 Docker Compose 로 띄운다([docs/ko/server.md](docs/ko/server.md)).

## 쓰기

```bash
guideline login --server <URL>   # 머신마다 한 번
guideline pick                   # 서버 폼에서 고르고 제출하면 바로 반영
guideline status                 # 최신인지 확인
guideline update                 # 고른 그대로 최신으로
guideline propose --dry-run      # 고친 사본을 원본에 제안(보내지 않고 보기)
```

- **처음이면 [docs/ko/guide.md](docs/ko/guide.md)** — 설치, 서버 띄우기, 받기, 바꿈, 문제 해결까지 순서대로.
- 에이전트에게는 서버의 `/llms.txt` 를 읽힌다(관리자 웹 상단 「사용법」).
- 명령 레퍼런스는 [docs/ko/usage.md](docs/ko/usage.md), 서버 운영은 [docs/ko/server.md](docs/ko/server.md), 언어팩은 [docs/ko/locales.md](docs/ko/locales.md).
- 프로젝트는 ruler 를 써야 한다(`.ruler/`). 모노레포의 하위 디렉터리는 따로 받는다.
- 여러 지침 서버에서 함께 받을 수 있다(`--source`). 이름이 겹치면 `guideline.json` 의 별칭으로 구분한다.
- 원본은 제안으로 바뀐다: 고친 사본은 `guideline propose`, 새 지침은 `guideline source` + `guideline propose --from`. 관리자가 웹 「제안」 에서 수락한다.

## 언어

기본 언어는 영어다. **`GUIDELINE_LANG=ko`** 를 두면 CLI 메시지, 관리자 웹, 프로젝트에 쓰는 관리 지침·색인, 빈 서버의 씨앗이 한국어가 된다. CLI 와 서버에 각각 둔다. CLI 는 환경 변수 대신 `~/.config/guideline/config.json` 에 `{ "lang": "ko" }` 를 둬도 된다(환경 변수가 먼저). 다른 언어는 언어팩 폴더를 받아 넣는다([docs/ko/locales.md](docs/ko/locales.md)).

**0.14 이하에서 올 때:** 기본값이 영어로 바뀌었다. 한국어를 계속 쓰려면 셸과 서버 환경에 `GUIDELINE_LANG=ko` 를 둔다. 두지 않으면 다음 `update` 에서 관리 지침과 색인이 영어로 다시 써진다. 0.10 의 문서 저장소 명령(`init`, 문서 저장소의 `pick`·`update`, 관리 스킬)은 없어졌다 — [docs/ko/usage.md](docs/ko/usage.md) 「0.15 로 옮기기」.

## 개발

```bash
pnpm test                                # node --test. 테스트는 GUIDELINE_LANG=ko 로 돈다
node cli/bin/guideline.js help
ADMIN_TOKEN=$(openssl rand -base64 48) PUBLIC_URL=http://localhost:3000 DATA_DIR=./.data node server/bin/guideline-server.js   # 서버
```

## 릴리스

npm 게시는 GitHub Actions 가 한다. 로컬에서 `pnpm publish` 를 돌리지 않는다.

```bash
pnpm version minor            # 또는 patch, major. 커밋과 v<버전> 태그를 만든다
git push --follow-tags        # 태그가 릴리스 워크플로를 띄운다
```

`v<SemVer>` 태그에서 `.github/workflows/release.yml` 이 돈다. 태그와 `package.json` 버전이 같은지 보고, `pnpm test` 를 돌린 뒤 provenance 와 함께 게시한다. npm Trusted Publishing 을 쓰므로 토큰을 두지 않는다. npm 패키지가 `jang2162/guideline-manage` 의 `release.yml` 을 신뢰하도록 등록돼 있어야 한다. PR 과 main push 에서는 테스트(`ci.yml`)만 돈다.

## 버전

- 명령 동작이나 스킬 절차가 바뀜: minor
- 그 밖의 수정: patch

`1.0.0` 전까지는 호환을 깨는 변경도 minor 로 올린다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `cli/` | `guideline` 명령. `cli/src/i18n.js` 가 언어 설정과 언어팩을 읽는다 |
| `locales/` | 언어팩. `en`(정본)과 `ko`. `messages.json` 문구와 `templates/` 긴 글(관리 지침, 작성 규칙, 씨앗 스킬, llms.txt, 새 파일 틀) |
| `server/` | 지침 서버. `server/src/` 서버 코드(`web/` 관리자 화면), `server/static/` 화면의 CSS·JS, `server/Dockerfile`. npm 패키지에는 들어가지 않는다 |
| `compose.yaml` | Docker Compose 로 지침 서버 배포. 환경 변수는 `.env.example` |
| `.github/workflows/` | CI(테스트)와 릴리스(npm 게시) |
| `docs/` | 사람용 문서(영어). 한국어판은 `docs/ko/` |

## 라이선스

[MIT](LICENSE)
