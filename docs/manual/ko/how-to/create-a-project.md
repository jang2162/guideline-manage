<!-- source: docs/manual/en/how-to/create-a-project.md @ v0.21.0 -->
[English](../../en/how-to/create-a-project.md) | **한국어**

# 지침을 받는 새 프로젝트 만들기

새 프로젝트 폴더를 만들면서 지침까지 한 번에 반영하는 방법입니다.
프로젝트를 처음부터 시작하는 CLI 사용자를 위한 문서입니다.

1. `pick` 에 `--new` 와 이름이나 경로를 주세요.

   ```bash
   guideline pick --new my-new-app    # GUIDELINE_PROJECTS_DIR/my-new-app
   guideline pick --new ~/work/x      # a path works too (absolute or ~)
   ```

2. 폼 맨 위에서 에이전트(claude, codex, opencode)를 고르세요. 형태는 늘 ruler 입니다.
3. [시작하기](../getting-started.md#4-프로젝트에-받을-지침-고르기)처럼 지침을 고르고 제출하세요.

제출하면 폴더를 만들고 `git init` 한 뒤 고른 것을 반영합니다.
취소하면 폴더가 생기지 않습니다.

## 다음 문서

- [최신으로 유지하기](stay-up-to-date.md)
- [에이전트에게 맡기기](hand-off-to-an-agent.md)
