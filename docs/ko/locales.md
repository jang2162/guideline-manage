# 언어팩

[English](../locales.md) · 한국어

CLI 메시지, 관리자 웹, 도구가 처음 만들어 주는 지침(관리 지침, 색인, 작성 규칙, 씨앗 스킬, `/llms.txt`, 새 파일 틀)은 언어팩을 따른다. 영어(`en`)와 한국어(`ko`)가 패키지에 들어 있고, 다른 언어는 언어팩 폴더를 받아 넣는다. 사람이 쓴 지침은 번역하지 않는다.

## 언어 고르기

- 환경 변수 `GUIDELINE_LANG` 으로 정한다. 없으면 CLI 는 `~/.config/guideline/config.json` 의 `lang`(예: `{ "lang": "ko" }`)을 읽고, 둘 다 없으면 `en` 이다. 서버는 환경 변수만 본다. `ko-KR`·`KO` 처럼 써도 `ko` 로 받는다.
- CLI 는 자기 프로세스의 값을, 서버는 서버 프로세스의 값을 쓴다. 두 언어가 다르면 섞여 보일 수 있다(서버가 보낸 오류 문장과 폼은 서버 언어).
- 모르는 언어 코드면 경고하고 영어로 동작한다.

## 언어팩 넣기

언어팩은 언어 코드 이름의 폴더 하나다. 넣는 곳:

| 쓰는 곳 | 폴더 |
| --- | --- |
| CLI | `GUIDELINE_LOCALES_DIR`, 없으면 `$XDG_CONFIG_HOME/guideline/locales`, 그것도 없으면 `~/.config/guideline/locales` |
| 서버 | `GUIDELINE_LOCALES_DIR`, 없으면 데이터 폴더의 `locales/`(Docker 는 `DATA_HOST_DIR/locales/`). 넣은 뒤 서버를 다시 띄운다 |

```
~/.config/guideline/locales/ja/
  pack.json
  messages.json
  templates/…
```

찾는 순서는 **사용자 폴더의 그 언어 → 패키지의 그 언어 → 사용자 폴더의 en → 패키지의 en** 이다. 그래서 사용자 폴더에 `ko/messages.json` 을 두고 몇 문구만 덮어쓸 수도 있다. 언어팩에 빠진 문구와 템플릿은 영어로 채운다 — 옛 버전에 맞춘 언어팩도 멈추지 않는다.

```bash
guideline locale list                 # 쓸 수 있는 언어와 지금 설정
```

## 언어팩 만들기

패키지의 `locales/en/` 을 복사해 번역한다. `en` 이 모든 키와 템플릿의 정본이다.

### pack.json

```json
{ "code": "ja", "name": "日本語", "version": "0.15.0" }
```

`version` 은 맞춘 도구 버전이다.

### messages.json

키마다 문구 하나다.

```json
{ "pick.form": "フォーム: {url}" }
```

- 자리 표시는 `{이름}` 이다. 영어 문구와 **같은 이름의 자리 표시**를 써야 한다. 다르면 그 문구는 쓰지 않고 영어로 대신한다.
- 문구는 늘 글자로 보인다. **HTML 은 쓸 수 없다**(웹에 넣을 때 이스케이프한다).
- JSON 이 깨졌거나 값이 문자열이 아니면 그 파일 전체를 쓰지 않고 경고한다. 앞에 BOM 이 있어도 읽는다.
- 복수형과 조사는 문장마다 번역자가 처리한다.

### templates/

긴 글은 문서 통째로 번역한다.

| 파일 | 쓰는 곳 |
| --- | --- |
| `management.md` | 프로젝트의 관리 지침 `.ruler/guideline.md` |
| `authoring.md` | 빈 서버 씨앗 `docs/authoring.md`(작성 규칙) |
| `skills/guideline-sync/SKILL.md`, `skills/guideline-export/SKILL.md` | 빈 서버 씨앗 스킬 |
| `llms.txt` | 서버의 `/llms.txt` |
| `new-file/*.md` | 관리자 웹 「새 파일」 의 틀 |

템플릿의 자리 표시는 `{{이름}}` 이다(예: `{{SERVER}}`, `{{propose}}`). 한 겹 중괄호(`{ … }`)는 그대로 남으므로 JSON 예시를 써도 된다.

### 확인

```bash
guideline locale check ~/.config/guideline/locales/ja
```

빠진 키, 남는 키, 자리 표시가 다른 키, 빠진 템플릿, `pack.json` 문제를 보인다. 문제가 있으면 코드 1.

## 지침의 표지 문구

도구는 사람이 쓴 지침에서 정해진 문구를 찾아 해석한다. 이 표지는 언어팩이 아니라 코드에 고정돼 있고, **언어 설정과 상관없이 영어·한국어를 둘 다 읽는다.** 영어가 정본이다. 언어팩의 템플릿은 그 언어 설정에 맞는 표지를 안내한다(영어·한국어가 아닌 언어팩은 영어 표지를 안내한다).

| 쓰는 곳 | 영어(정본) | 한국어 |
| --- | --- | --- |
| 스택 README 의 다른 스택 바꿈 표 절 | `## Overrides of other stacks` | `## 다른 스택을 바꾸는 것` |
| 바꿈 표 셀 | `` `<파일>` "<절 제목>" `` | `` `<파일>` 「<절 제목>」 `` |
| 바꿈 절의 첫 줄 | ``Overrides: `<스택>/<파일>` "<절 제목>"`` | ``바꾸는 절: `<스택>/<파일>` 「<절 제목>」`` |
| MCP README 의 항목 만들기 절 | `## Build on apply` | `## 반영할 때 항목 만들기` |
