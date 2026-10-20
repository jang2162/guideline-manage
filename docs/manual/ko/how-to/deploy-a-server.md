<!-- source: docs/manual/en/how-to/deploy-a-server.md @ v0.21.0 -->
[English](../../en/how-to/deploy-a-server.md) | **한국어**

# 지침 서버 배포하기

지침 서버(`guideline-server`)를 Docker Compose 로 배포하고 지침을 채우는 방법입니다.
팀을 위해 서버를 운영하는 사람을 위한 문서입니다.

## Docker Compose 로 배포하기

저장소 루트의 `compose.yaml` 이 `server/Dockerfile` 로 서버 이미지를 빌드합니다.
데이터는 `DATA_HOST_DIR` 에 둡니다.

```bash
git clone https://github.com/jang2162/guideline-manage.git
cd guideline-manage
cp .env.example .env
```

`.env` 는 [서버 환경 변수](../configuration.md#서버-환경-변수)대로 채우세요.

1. 서버에 `DATA_HOST_DIR` 을 만들고 uid 1000 에게 넘기세요.

   ```bash
   sudo chown 1000:1000 <DATA_HOST_DIR>
   ```

2. 관리자 토큰을 만들어 `.env` 의 `ADMIN_TOKEN` 에 넣으세요.

   ```bash
   openssl rand -base64 48
   ```

3. 서버를 빌드하고 띄우세요.

   ```bash
   docker compose up -d --build
   ```

   로그(`docker compose logs`)에 `guideline-server listening on port 3000` 이 나옵니다. 빈 DB 면 `seeded the empty server with <언어> guidelines (r1)` 도 나옵니다.
4. `PUBLIC_URL` 을 여세요. 지침·이력 보기와 내려받기는 로그인 없이 됩니다(`PUBLIC_READ=0` 이면 로그인해야 합니다). 편집·되돌리기·제안 검토·토큰 관리는 위쪽 **로그인**(`/login`)에서 관리자 토큰으로 로그인한 뒤 합니다.

TLS 와 리버스 프록시는 서버의 기존 구성에 맡기세요.
리버스 프록시 하나 뒤에 두면 `TRUST_PROXY=1` 로 두세요.

서버가 뜨지 않으면 로그의 첫 줄이 이유입니다. [문제 해결](../troubleshooting.md#서버가-뜨지-않음)을 보세요.

### Git 저장소에서 배포하기

Git 저장소에서 Compose 파일을 바로 배포하는 도구도 같은 방식으로 씁니다.
예를 들어 Komodo Git Repo Stack 이면 File Paths 에 `compose.yaml`, Environment 에 `.env.example` 의 변수를 넣습니다.
push 할 때 자동으로 다시 배포하는 기능은 끄세요. CLI 만 바꾼 커밋에도 서버가 다시 빌드되기 때문입니다.

## 지침 채우기

새 서버에는 씨앗만 있습니다. 작성 규칙 `docs/authoring.md` 와 씨앗 스킬 `guideline-sync`·`guideline-export` 입니다.
다음 중 한 가지로 지침을 채우세요.

- **웹에서:** 목록에서 블록을 추가하고(**+ 스택 추가** 등) 블록 상세의 **새 파일**로 채웁니다.
- **API 로:** 관리자 토큰으로 제안 API 에 `apply: true` 를 주어 한꺼번에 올립니다. 요청 하나에 변경 500개·20MB 까지입니다.

  ```bash
  curl -s -X POST http://localhost:3000/api/v1/proposals \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d '{"title":"first fill","apply":true,"changes":[{"path":"rules/base/00-agent.md","text":"---\nload: always\n---\n\n# Agent\n","base":null}]}'
  ```

- **옛 문서 저장소 클론에서:** 씨앗과 같은 경로가 충돌하지 않도록 먼저 `GUIDELINE_SEED=off` 로 빈 서버를 띄웁니다. 그다음 클론의 `rules/`·`skills/`·`agents/`·`mcp/`·`docs/authoring.md` 를 위처럼 API 로 올립니다.

원본이 따라야 할 작성 규칙은 서버의 `docs/authoring.md` 에 있습니다.

## Docker 로 로컬에서 띄우기

```bash
cp .env.example .env    # fill in ADMIN_TOKEN, PUBLIC_URL=http://localhost:3000, DATA_HOST_DIR
docker compose up --build
```

Docker 없이 띄우는 법은 [시작하기](../getting-started.md#2-지침-서버-띄우기)를 보세요.

## 다음 문서

- [서버와 CLI 올리기](upgrade.md)
- [서버 백업과 복구](back-up-and-restore.md)
- [서버 환경 변수](../configuration.md#서버-환경-변수)
