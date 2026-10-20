<!-- source: docs/manual/en/how-to/review-proposals.md @ v0.21.0 -->
[English](../../en/how-to/review-proposals.md) | **한국어**

# 제안 검토하기

지침 서버에 들어온 제안을 수락하거나 거절하는 방법입니다.
서버 관리자와 범위 `admin` 토큰을 가진 에이전트를 위한 문서입니다.

## 웹에서 검토하기

1. 관리자 토큰으로 로그인하고 **제안**을 여세요.
2. 파일마다 차이를 보세요.
   - 그사이 원본이 바뀌었어도 겹치지 않는 변경이면 합친 결과가 보입니다.
   - 같은 곳을 고쳤으면 충돌(Outdated)이 보이고 **수락** 버튼이 막힙니다.
3. 충돌은 **고치기**로 풀거나, 그 파일을 제안에서 빼거나, 제안을 거절하세요.
4. **수락**하거나 **거절**하세요.

수락하면 리비전 하나가 생깁니다. 생성 경로는 `proposal`, 작성자는 토큰 이름, 메시지는 「제안 #<번호>: <제목>」 입니다.

## API 로 검토하기

관리자 토큰이나 범위 `admin` 토큰을 가진 에이전트는 다른 제안을 수락·거절할 수 있습니다.

- `POST /api/v1/proposals/<number>/accept`
- `POST /api/v1/proposals/<number>/reject`

충돌이면 `conflicts` 와 함께 409 를 돌려줍니다.
제안을 합치는 방식은 [제안](../reference.md#제안)에 있습니다.

## 다음 문서

- [원본에 변경 제안하기](propose-changes.md)
- [서버 API](../reference.md#서버-api)
