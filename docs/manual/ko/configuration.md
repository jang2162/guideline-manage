<!-- source: docs/manual/en/configuration.md @ v0.21.0 -->
[English](../en/configuration.md) | **한국어**

# 설정

`guideline` CLI 와 지침 서버의 설정을 모두 모았습니다.
설정값을 찾아보는 CLI 사용자와 서버 운영자를 위한 문서입니다.

## CLI 환경 변수

| 이름 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `GUIDELINE_SERVER` | URL | 없음 | 지침 서버 주소. `--server` 와 프로젝트의 `guideline.json` 이 없을 때 씁니다 |
| `GUIDELINE_TOKEN` | 문자열 | 없음 | 저장한 토큰 대신 쓸 토큰(CI 등). 출처가 하나일 때만 씁니다 |
| `GUIDELINE_LANG` | 언어 코드 | `en` | CLI 메시지와 프로젝트에 쓰는 글(관리 지침, 색인)의 언어. 한국어는 `ko`. 없으면 CLI 는 `~/.config/guideline/config.json` 의 `lang` 을 읽습니다 |
| `GUIDELINE_LOCALES_DIR` | 경로 | `$XDG_CONFIG_HOME/guideline/locales`, 없으면 `~/.config/guideline/locales` | 사용자 언어팩 폴더 |
| `GUIDELINE_PROJECTS_DIR` | 경로 | 없음 | `pick --new <이름>` 이 프로젝트를 만들 상위 폴더 |

## CLI 파일

| 파일 | 내용 |
| --- | --- |
| `~/.config/guideline/config.json` | CLI 설정. `GUIDELINE_LANG` 이 없을 때 `{ "lang": "ko" }` 로 언어를 정합니다 |
| `~/.config/guideline/credentials.json` | 서버마다 저장한 토큰(권한 600) |

## 서버 환경 변수

저장소 루트의 `.env.example` 에 같은 키가 있습니다.
Docker Compose 는 `.env` 에서 읽습니다.

| 키 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `ADMIN_TOKEN` | 문자열, 필수, 비밀 | 없음 | 관리자 토큰. 32자 이상. 관리자 웹의 로그인 비밀번호 역할을 합니다. `.env` 나 배포 도구의 비밀 저장소에 두고 Git 에는 넣지 마세요. `openssl rand -base64 48` 로 만듭니다 |
| `PUBLIC_URL` | URL, 필수 | 없음 | 사용자가 여는 주소(예: `https://guideline.example.com`). 이 주소가 아닌 곳(서버 IP:포트 등)에서 열면 로그인·저장이 403 입니다 |
| `DATA_HOST_DIR` | 경로, Docker 에서 필수 | 없음 | DB(`guideline.db`)와 백업(`backups/`)을 둘 호스트 경로(예: `/data/guideline`). uid 1000 이 쓸 수 있어야 합니다 |
| `HOST_PORT` | 정수 | `3000` | 호스트에 여는 포트(Docker) |
| `PUBLIC_READ` | `0` 또는 `1` | `1` | `1` 이면 지침 보기(웹 화면, 읽기 API, CLI 의 `pick`·`update`·`list`)를 로그인·토큰 없이 엽니다. `0` 이면 웹은 관리자 로그인, API·CLI 는 읽기 토큰이 있어야 합니다. 지침 바꾸기·제안 검토·토큰 관리는 언제나 관리자만 합니다 |
| `BACKUP_KEEP` | 정수 | `14` | 남길 자동 백업 수(예: `30`) |
| `TRUST_PROXY` | `0` 또는 `1` | `0` | 리버스 프록시 하나 뒤면 `1`. 프록시가 덧붙인 `X-Forwarded-For` 의 마지막 값으로 로그인 제한을 겁니다 |
| `GUIDELINE_LANG` | 언어 코드 | `en` | 관리자 웹·API 오류·`/llms.txt`·빈 서버 씨앗의 언어. 한국어는 `ko`. 모르는 코드면 시작 로그에 경고하고 영어로 뜹니다 |
| `GUIDELINE_SEED` | `on` 또는 `off` | `on` | `off` 면 빈 서버에 씨앗을 넣지 않습니다. 옛 문서 저장소 클론을 통째로 옮길 때 씁니다 |
| `GUIDELINE_LOCALES_DIR` | 경로 | 데이터 폴더의 `locales/`(Docker 는 `DATA_HOST_DIR/locales/`) | 사용자 언어팩 폴더 |
| `DATA_DIR` | 경로 | `/data` | Docker 없이 띄울 때의 데이터 폴더(예: `./.data`) |
| `PORT` | 정수 | `3000` | Docker 없이 띄울 때 서버가 듣는 포트 |

운영 로그와 설정 오류는 언어 설정과 상관없이 영어입니다.

## 언어

- `GUIDELINE_LANG` 으로 정합니다. 없으면 CLI 는 `~/.config/guideline/config.json` 의 `lang`(예: `{ "lang": "ko" }`)을 읽습니다. 둘 다 없으면 `en` 입니다. 서버는 환경 변수만 봅니다.
- `ko-KR`·`KO` 처럼 써도 `ko` 로 받습니다.
- CLI 는 자기 프로세스의 값을, 서버는 서버 프로세스의 값을 씁니다. 각각 따로 두세요. 두 언어가 다르면 섞여 보일 수 있습니다. 서버가 보낸 오류 문장과 폼은 서버 언어입니다.
- 서버는 프로세스 하나에 언어 하나로 뜹니다. 화면 안에서 언어를 바꾸는 메뉴는 없습니다.
- 모르는 언어 코드면 경고하고 영어로 동작합니다.
- 다른 언어는 언어팩으로 더합니다. [언어팩 더하기](how-to/add-a-language-pack.md)를 보세요.

## 다음 문서

- [레퍼런스](reference.md)
- [문제 해결](troubleshooting.md)
