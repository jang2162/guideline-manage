<!-- source: docs/manual/en/how-to/hand-off-to-an-agent.md @ v0.21.0 -->
[English](../../en/how-to/hand-off-to-an-agent.md) | **한국어**

# 에이전트에게 맡기기

코딩 에이전트가 지침을 고르고, 받고, 최신으로 맞추고, 할 일을 처리하게 하는 방법입니다.
Claude Code, Codex 같은 에이전트와 함께 일하는 CLI 사용자를 위한 문서입니다.

## guideline-sync 스킬이 있을 때

지침을 받은 프로젝트에는 `guideline-sync` 스킬이 함께 들어갑니다(스킬을 골랐다면).
에이전트에게 "지침 최신으로 맞춰줘", "지침 내보내줘" 라고 하세요.
스킬이 `status`·`update`·`pick` 을 부르고 할 일을 처리합니다.

## 스킬이 없을 때

스킬이 없는 프로젝트나 다른 에이전트에게는 "`http://localhost:3000/llms.txt` 를 읽고 지침을 받아줘" 라고 하세요.
`llms.txt` 에 할 일 종류마다 처리 방법이 있습니다.

## 에이전트에게 블록을 추천받기

에이전트에게 "맞는 지침 받아와" 라고 하세요.
에이전트가 블록을 골라 `guideline pick --recommend` 로 폼을 엽니다.
추천 항목에는 **에이전트 추천**과 이유가 붙어 있습니다.
훑어보고 제출하세요.

`--recommend` 는 출처 하나씩만 받고, 0.19 이상 서버가 필요합니다. [프로젝트 명령](../reference.md#프로젝트-명령)을 보세요.

## 다음 문서

- [최신으로 유지하기](stay-up-to-date.md)
- [원본에 변경 제안하기](propose-changes.md)
