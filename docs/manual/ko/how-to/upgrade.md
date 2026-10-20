<!-- source: docs/manual/en/how-to/upgrade.md @ v0.21.0 -->
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
- 0.20 이상 CLI 는 옛 서버에서도 동작합니다. 옛 서버는 `whoami` 가 404 라서 `guideline propose` 는 예전처럼 제안으로 보내고, `status`·`login` 은 토큰 범위를 보이지 않습니다. 옛 CLI 는 0.20 서버에서 예전과 같습니다.

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

## 0.14 이하에서 옮기기

- **기본 언어가 영어가 됐습니다.** 한국어를 계속 쓰려면 셸과 서버 환경에 `GUIDELINE_LANG=ko` 를 두세요. 두지 않으면 다음 `update` 에서 관리 지침(`.ruler/guideline.md`)과 색인(`99-reference.md`)이 영어로 다시 써집니다.
- **0.10 의 문서 저장소 명령이 없어졌습니다.** `init`, 문서 저장소 안에서의 `pick`·`update`, 문서 저장소용 관리 스킬이 사라졌습니다. 원본은 지침 서버에만 있습니다. 옛 문서 저장소 클론을 서버로 옮기려면 [지침 채우기](deploy-a-server.md#지침-채우기)를 따르세요.
- **원본 폴더 검사**는 `guideline list <폴더>` 입니다. 현재 폴더를 저절로 원본으로 보지 않습니다.
- 사람이 쓴 지침의 표지 문구는 영어와 예전 한국어를 둘 다 읽으므로 기존 지침은 고치지 않아도 됩니다. [지침의 표지 문구](../reference.md#지침의-표지-문구)를 보세요.
- 0.12 의 CLAUDE.md 형으로 받은 프로젝트는 「CLAUDE.md 형은 더 이상 지원하지 않음」 으로 멈춥니다. ruler 로 옮기고 `guideline pick` 을 다시 실행하세요.

## 다음 문서

- [서버 백업과 복구](back-up-and-restore.md)
- [문제 해결](../troubleshooting.md)
