<!-- source: docs/manual/en/how-to/back-up-and-restore.md @ v0.21.0 -->
[English](../../en/how-to/back-up-and-restore.md) | **한국어**

# 서버 백업과 복구

서버의 자동 백업과 백업으로 복구하는 방법입니다.
지침 서버를 운영하는 사람을 위한 문서입니다.

## 자동 백업

- 서버는 시작할 때와 그 뒤 24시간마다 데이터 폴더에 `backups/guideline-<YYYYMMDD-HHmmss>.db`(UTC)를 만듭니다.
- `BACKUP_KEEP`(기본 14)개를 넘는 자동 백업은 지웁니다.
- 스키마를 올리기 직전에는 `backups/guideline-pre-v<버전>-<시각>.db` 도 만듭니다. 이 파일은 자동으로 지우지 않습니다.

## 지침 내려받기

- 블록 상세의 **블록 내려받기(.tar.gz)** 는 그 블록을 원본 구조로 줍니다.
- `GET /api/v1/archive` 는 원본 전체를 줍니다. CLI 가 쓰는 것입니다.

## 백업으로 복구하기

1. 서버를 멈추세요.

   ```bash
   docker compose stop
   ```

2. 서버에서 백업을 DB 위에 복사하고 `guideline.db-wal`, `guideline.db-shm` 을 지우세요.

   ```bash
   cp <DATA_HOST_DIR>/backups/<backup>.db <DATA_HOST_DIR>/guideline.db
   rm -f <DATA_HOST_DIR>/guideline.db-wal <DATA_HOST_DIR>/guideline.db-shm
   ```

3. 서버를 띄우세요.

   ```bash
   docker compose start
   ```

## 다음 문서

- [서버와 CLI 올리기](upgrade.md)
- [서버 환경 변수](../configuration.md#서버-환경-변수)
