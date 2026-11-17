<!-- source: docs/manual/en/how-to/use-in-a-monorepo.md @ v0.23.0 -->
[English](../../en/how-to/use-in-a-monorepo.md) | **한국어**

# 모노레포 하위 디렉터리에서 받기

`packages/api` 처럼 모노레포의 하위 디렉터리에서 지침을 따로 받는 방법입니다.
저장소에 패키지가 여럿 있는 CLI 사용자를 위한 문서입니다.

자기 `.ruler/` 가 있는 하위 디렉터리에서 `guideline pick` 을 실행하세요.
그 디렉터리가 따로 단위가 됩니다. 매니페스트(`guideline.json`)·잠금(`guideline-lock.json`)·`.guideline/` 사본·바꿈·생성물이 모두 그 안에 생기고, 단위의 `.gitignore` 에도 그 단위의 블록이 생깁니다.
루트의 지침은 다시 쓰지 않습니다.

- 스킬·서브에이전트·MCP 서버는 git 루트에서만 받습니다. 하위 디렉터리에서는 「반영 불가」 로 보입니다.
- 루트에 이미 받은 스택은 폼에 「루트에 이미 있음」 으로 보입니다. 같은 지침이 두 번 들어가지 않도록 다시 고르지 않는 것이 보통입니다.
- git 루트의 ruler 설정(`.ruler/ruler.project.toml`)에 `nested = true` 가 없으면 `nested-off` 할 일이 나옵니다. 이 값을 켜야 ruler 가 그 디렉터리의 CLAUDE.md·AGENTS.md 를 만듭니다.
- 단위에서 `guideline apply` 를 하기 전에 git 루트에서 먼저 하세요. git 루트에 `.ruler/ruler.toml` 이 없는 동안 단위의 `apply` 는 자기 생성물은 조합하지만 ruler 는 돌지 않고 `root-apply` 할 일을 남깁니다. 그것 없이 ruler 를 돌리면 모든 에이전트 몫을 쓰기 때문입니다. git 루트에서 `guideline apply` 를 먼저 하거나, 거기에 `nested = true` 인 `.ruler/ruler.toml` 을 직접 두세요.
- 클론한 뒤에는 git 루트에서 `guideline apply` 를 한 번 실행하세요(루트의 `prepare` 가 `guideline apply` 를 부르면 그것이 합니다). 루트와, 그 아래에서 git 이 추적하는 단위(커밋된 `guideline-lock.json` 이 있는 디렉터리)를 모두 조합한 뒤 ruler 를 한 번 돌아 모든 단위의 CLAUDE.md·AGENTS.md 가 채워집니다. 아직 옛 배치인 단위는 `unit-update` 할 일과 함께 건너뜁니다. 그 단위에서 `guideline update` 를 실행하세요.
- git 루트가 직접 지침을 받지 않아도 됩니다. `guideline.json` 이 없는 루트에서도 `guideline apply` 는 단위를 조합하고, 루트가 둔 `.ruler/ruler.toml`(`nested = true` 로 커밋)로 ruler 를 돕니다. 그것이 없으면 `root-ruler-toml` 할 일이 나오고 ruler 는 돌지 않습니다.
- 하위 디렉터리에 ruler 설정이 없으면 `pick` 이 거기에 에이전트 목록만 담은 `.ruler/ruler.project.toml` 을 만듭니다.

## 다음 문서

- [여러 서버에서 받기](receive-from-several-sources.md)
- [최신으로 유지하기](stay-up-to-date.md)
