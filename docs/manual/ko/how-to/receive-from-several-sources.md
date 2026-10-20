<!-- source: docs/manual/en/how-to/receive-from-several-sources.md @ v0.21.0 -->
[English](../../en/how-to/receive-from-several-sources.md) | **한국어**

# 여러 서버에서 받기

한 프로젝트가 여러 지침 서버(출처)에서 지침을 받는 방법입니다.
예를 들어 개인 서버의 도구 스택과 사내 서버의 사내 스택을 함께 쓰는 팀을 위한 문서입니다.

1. **출처를 추가하세요.** 서버마다 한 번씩 `guideline login --server <URL>` 을 실행하세요. 그다음 `guideline pick --source <이름> --server <URL>` 로 그 서버의 폼을 엽니다. 이름은 영문 소문자로 시작하고 소문자·숫자·`-` 로 32자까지입니다.
2. **이름이 겹치면 별칭을 주세요.** 두 출처가 같은 이름의 스택·스킬·서브에이전트·MCP 서버를 줄 수 있습니다. 그러면 폼에서 「다른 출처가 이미 쓰는 이름」 으로 막히고, 매니페스트로 억지로 고르면 `pick` 이 「이름 충돌」 로 멈춥니다. 그 출처의 `guideline.json` 칸에 별칭을 적으세요.

   ```json
   "company": { "server": "https://guideline.example.com", "items": [], "aliases": { "rules/base": "company-base" } }
   ```

   그러면 사내 `base` 는 `.ruler/company-base/` 로 들어오고, 바꿈 첫 줄도 `company-base/<파일>` 로 씁니다. 별칭을 바꾸면 예전 자리의 사본은 지워지고, 그 자리의 바꿈 파일은 `alias` 할 일로 알립니다.
3. **최신으로 유지하세요.** `guideline status`·`guideline update` 는 모든 출처를 봅니다. 하나만 보려면 `--source` 를 주세요. 한 서버에 닿지 못하면 그 출처만 그대로 두고 나머지를 반영합니다.
4. **제안은 출처마다 따로 갑니다.** `guideline propose` 는 고친 사본을 출처별로 나눠 각 서버에 제안 하나씩 보냅니다.

관리 지침(`.ruler/guideline.md`)에는 각 출처의 `docs/management.md` 가 `## <출처> 추가 지침` 으로 붙습니다.
사내 출처의 관리자는 모든 사내 프로젝트에 퍼뜨릴 운영 규칙을 여기에 씁니다.

## 다음 문서

- [최신으로 유지하기](stay-up-to-date.md)
- [원본에 변경 제안하기](propose-changes.md)
