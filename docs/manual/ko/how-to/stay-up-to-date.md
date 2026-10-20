<!-- source: docs/manual/en/how-to/stay-up-to-date.md @ v0.21.0 -->
[English](../../en/how-to/stay-up-to-date.md) | **한국어**

# 최신으로 유지하기

프로젝트의 지침이 최신인지 보고 최신으로 맞추는 방법입니다.
이미 지침을 받은 CLI 사용자를 위한 문서입니다.

## 확인하고 맞추기

```bash
guideline status            # what changed?
guideline update            # same choices, latest version
guideline update --force    # also revert files edited in the project to the source
guideline pick              # to change what you chose
```

`update` 는 프로젝트에서 고친 파일을 건너뛰고 `skipped` 할 일로 알립니다. 그래서 고친 내용을 잃지 않습니다.

## 상태 읽기

| 상태 | 뜻 | 할 것 |
| --- | --- | --- |
| 최신 | 원본·프로젝트 모두 그대로임 | 없음 |
| 원본 새로 나옴 | 원본이 바뀜 | `update` |
| 프로젝트에서 고침 | 사본을 프로젝트에서 고침 | `guideline propose` 로 원본에 올리거나, [바꿈](override-guidelines.md)으로 옮기거나, `update --force` |
| 둘 다 바뀜 | 둘 다 바뀜 | 차이를 보고 정하세요 |
| 없어짐 | 사본이 지워짐 | `update` 가 다시 씁니다 |
| 반영 안 됨(충돌) | 처음 받을 때 이미 있던 것과 달라 쓰지 않음 | `pick` 에서 **차이 보기** 후 **갱신** |
| 원본에서 사라짐 | 원본에서 지워짐 | `pick` 에서 지우세요 |

받은 블록이 필요로 하는(`requires`) 블록을 프로젝트가 받지 않았으면 `update`·`status` 가 `missing-requires` 할 일을 냅니다. 빠진 블록은 `guideline pick` 으로 추가하세요.

## 스택 세팅 문서 따르기

`mise` 처럼 세팅이 필요한 스택에는 `docs/guideline/<스택>/SETUP.md` 가 함께 옵니다.
새로 받았거나 원본이 바뀌면 `setup` 할 일이 나옵니다.

1. 세팅 문서의 `## 확인` 으로 이미 됐는지 보세요.
2. 안 됐으면 `## 세팅` 을 따르세요.

프로젝트를 새로 클론한 사람도 이 문서를 따릅니다.

## 다음 문서

- [이 프로젝트에만 다르게 하기](override-guidelines.md)
- [원본에 변경 제안하기](propose-changes.md)
