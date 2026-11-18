<!-- source: docs/manual/en/how-to/override-guidelines.md @ v0.23.0 -->
[English](../../en/how-to/override-guidelines.md) | **한국어**

# 이 프로젝트에만 다르게 하기

받은 사본을 고치지 않고, 한 프로젝트에서만 지침을 다르게 따르는 방법입니다.
공용 규칙과 다른 규칙이 필요한 프로젝트의 CLI 사용자를 위한 문서입니다.

받은 사본은 고치지 마세요. 대신 **바꿈**을 쓰세요.
바꿈은 프로젝트 소유라서 `update` 가 건드리지 않습니다.

1. 다음 자리 중 하나에 바꿈 파일을 만드세요.
   - `.guideline/overrides/<스택 경로>/override.md`
   - `.guideline/overrides/<스택 경로>/override.d/*.md`
2. 바꿈 절마다 첫 줄에 무엇을 바꾸는지 쓰세요.

   ```markdown
   ## base 프로젝트 바꿈

   ### 커밋 메시지는 영어로

   바꾸는 절: `base/01-git.md` 「커밋 메시지」

   이 프로젝트는 외부 기여자가 있어 커밋 메시지를 영어로 쓴다.
   ```

3. 파일 전체를 바꾸려면 그 줄에서 「」 로 감싼 절 제목을 빼세요.

하위 스택은 자기 폴더를 쓰세요: `.guideline/overrides/<부모>/<하위>/override.md`.
`guideline apply` 가 고른 스택의 바꿈을 생성물인 `.ruler/<스택>/` 폴더로 복사하고, ruler 가 거기서 읽습니다.
고르지 않은 스택의 바꿈은 조합하지 않고 `override-unchosen` 할 일을 남깁니다.

받은 스택 폴더(`.guideline/rules/<스택>/`)와 생성물인 `.ruler/<스택>/` 폴더 안에는 하위 폴더를 포함해 프로젝트 파일을 두지 마세요.
`.guideline/rules/<스택>/` 는 원본의 것이라서, 원본에 없는 파일이나 하위 폴더는 원본에서 사라진 사본으로 보이고, 생성물 폴더는 `guideline apply` 가 덮어씁니다.
프로젝트 고유 규칙은 바꿈이나 `.ruler/*.md`(예: `.ruler/50-project.md`)에 두세요.

바꾼 파일이나 절이 원본에서 사라지면 `override` 할 일이 나옵니다.

## 다음 문서

- [원본에 변경 제안하기](propose-changes.md)
- [지침의 표지 문구](../reference.md#지침의-표지-문구)
