<!-- source: docs/manual/en/how-to/use-in-a-monorepo.md @ v0.21.0 -->
[English](../../en/how-to/use-in-a-monorepo.md) | **한국어**

# 모노레포 하위 디렉터리에서 받기

`packages/api` 처럼 모노레포의 하위 디렉터리에서 지침을 따로 받는 방법입니다.
저장소에 패키지가 여럿 있는 CLI 사용자를 위한 문서입니다.

자기 `.ruler/` 가 있는 하위 디렉터리에서 `guideline pick` 을 실행하세요.
그 디렉터리가 따로 단위가 됩니다. 매니페스트(`guideline.json`)·잠금(`guideline-lock.json`)·사본이 모두 그 안에 생깁니다.
루트의 지침은 다시 쓰지 않습니다.

- 스킬·서브에이전트·MCP 서버는 git 루트에서만 받습니다. 하위 디렉터리에서는 「반영 불가」 로 보입니다.
- 루트에 이미 받은 스택은 폼에 「루트에 이미 있음」 으로 보입니다. 같은 지침이 두 번 들어가지 않도록 다시 고르지 않는 것이 보통입니다.
- git 루트의 `.ruler/ruler.toml` 에 `nested = true` 가 없으면 `nested-off` 할 일이 나옵니다. 이 값을 켜야 ruler 가 그 디렉터리의 CLAUDE.md·AGENTS.md 를 만듭니다.
- 하위 디렉터리에 `.ruler/ruler.toml` 이 없으면 `pick` 이 에이전트 목록만 담아 만듭니다.

## 다음 문서

- [여러 서버에서 받기](receive-from-several-sources.md)
- [최신으로 유지하기](stay-up-to-date.md)
