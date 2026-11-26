# 공용 지침 관리

이 프로젝트의 지침 일부는 지침 서버에서 받은 사본이다.

- 받은 사본은 `.guideline/` 에 있다(`.guideline/rules/<스택>/NN-*.md` 등). 사본과 `guideline.json`·`guideline-lock.json`, 이 파일은 직접 고치지 않는다. 사본을 고쳐 원본에 올릴 것은 {{propose}}, 새 지침은 `guideline-export` 스킬로 제안한다.
- `.ruler/` 의 지침 파일(`.ruler/<스택>/`, `.ruler/guideline.md`, `.ruler/skills/`)과 `docs/guideline/`, `.ruler/ruler.toml` 은 `guideline apply` 가 `.guideline/` 에서 만든 생성물이라 `.gitignore` 에 들어 있다. 거기서 고친 것은 다음 `guideline apply` 때 덮이므로 그 폴더에 프로젝트 파일을 두지 않는다. 프로젝트에만 쓰는 규칙은 `.ruler/*.md`(예: `.ruler/50-project.md`)나 바꿈에 둔다.
- 이 프로젝트에만 다르게 할 것은 바꿈에 쓴다. 자리는 `.guideline/overrides/<스택 경로>/override.md`(하위 스택은 `.guideline/overrides/<부모>/<자식>/override.md`), 파일이 여럿이면 `.guideline/overrides/<스택 경로>/override.d/*.md` 다. 바꿈 절마다 제목 바로 아래 첫 줄에 ``바꾸는 절: `<스택>/<파일>` 「<절 제목>」`` 을 쓰고(파일 전체를 바꾸면 「」 를 뺀다. 절 제목은 원본의 `## ` 뒤를 글자 그대로 옮긴다), 그 아래에 이 프로젝트의 규칙을 쓴다. 바꿈이 사본보다 우선한다.
- 이 프로젝트의 ruler 설정(에이전트, 출력 경로, 프로젝트가 직접 쓴 MCP 서버)은 `.ruler/ruler.project.toml` 에 둔다. `guideline apply` 가 그 파일과 받은 MCP 서버로 `.ruler/ruler.toml` 을 만든다.
- 새로 클론했거나 새 워크트리를 만든 직후에는 `guideline apply` 를 돌려(서버가 필요 없다) 생성물을 만든다.
- 지침을 최신으로 맞출 때는 `guideline status` 로 보고 `guideline update` 를 쓴다(에이전트는 `guideline-sync` 스킬).{{setup}}
