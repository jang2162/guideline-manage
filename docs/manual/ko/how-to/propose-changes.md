<!-- source: docs/manual/en/how-to/propose-changes.md @ v0.21.0 -->
[English](../../en/how-to/propose-changes.md) | **한국어**

# 원본에 변경 제안하기

고친 사본이나 새 지침·스킬·MCP 서버를 지침 서버에 보내는 방법입니다.
공용 원본을 바꾸려는 CLI 사용자와 에이전트를 위한 문서입니다.

원본은 **제안**으로 바뀝니다.
관리자가 웹 **제안**에서 수락하면 리비전이 되고, 각 프로젝트는 `guideline update` 로 받습니다.
관리자는 웹에서 바로 고칠 수도 있습니다.

## 제안할 수 있는 토큰 받기

제안하려면 범위 `propose` 토큰이 필요합니다.
관리자에게 받아 저장하세요.

```bash
guideline login --server <URL> --token-stdin
```

범위 `admin` 토큰은 검토 없이 바로 반영합니다.
이 토큰으로 `guideline propose` 를 하면 제안이 대기하지 않고 바로 원본이 됩니다.
그래도 검토를 받으려면 `--review` 를 붙이세요.
저장된 토큰의 범위는 `guideline status` 가 보이고, `guideline propose --dry-run` 은 보내면 둘 중 어느 쪽인지 알립니다.

## 고친 사본을 원본에 올리기

프로젝트에서 실행하세요.

```bash
guideline propose --dry-run                     # the change turned back into source form, and its diff
guideline propose --title "base: tidy the commit rules"
```

## 새 지침·스킬·MCP 서버 올리기

원본 작업 사본에서 하세요.

1. 빈 폴더에 최신 원본을 푸세요.

   ```bash
   guideline source /tmp/gl-src
   ```

2. `/tmp/gl-src` 의 `rules/`·`skills/`·`agents/`·`mcp/` 를 원본 경로 그대로 고치세요. 규칙은 원본의 `docs/authoring.md` 에 있습니다.
3. 경고가 없는지 보세요.

   ```bash
   guideline list /tmp/gl-src
   ```

4. 미리 본 뒤 보내세요.

   ```bash
   guideline propose --from /tmp/gl-src --dry-run
   guideline propose --from /tmp/gl-src --title "rules: add deployment rules to the deploy stack"
   ```

에이전트에게 "이 프로젝트의 지침을 공용으로 올려줘" 라고 하면 `guideline-export` 스킬이 후보를 가려내고 이 흐름으로 제안합니다.

## 다음 문서

- [제안 검토하기](review-proposals.md)
- [명령 레퍼런스](../reference.md#프로젝트-명령)
