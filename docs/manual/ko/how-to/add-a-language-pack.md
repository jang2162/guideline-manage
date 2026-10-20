<!-- source: docs/manual/en/how-to/add-a-language-pack.md @ v0.21.0 -->
[English](../../en/how-to/add-a-language-pack.md) | **한국어**

# 언어팩 더하기

CLI 와 서버에 언어팩을 넣거나 새로 만드는 방법입니다.
번역자와, 영어·한국어가 아닌 언어로 guideline-manage 를 쓰려는 팀을 위한 문서입니다.

언어팩은 CLI 메시지, 관리자 웹, 도구가 직접 쓰는 지침을 맡습니다. 도구가 쓰는 지침은 관리 지침, 색인, 작성 규칙, 씨앗 스킬, `/llms.txt`, 새 파일 틀입니다.
영어(`en`)와 한국어(`ko`)가 패키지에 들어 있습니다.
사람이 쓴 지침은 번역하지 않습니다.
언어를 고르는 법은 [언어](../configuration.md#언어)를 보세요.

## 언어팩 넣기

언어팩은 언어 코드 이름의 폴더 하나입니다.

| 쓰는 곳 | 폴더 |
| --- | --- |
| CLI | `GUIDELINE_LOCALES_DIR`, 없으면 `$XDG_CONFIG_HOME/guideline/locales`, 그것도 없으면 `~/.config/guideline/locales` |
| 서버 | `GUIDELINE_LOCALES_DIR`, 없으면 데이터 폴더의 `locales/`(Docker 는 `DATA_HOST_DIR/locales/`). 넣은 뒤 서버를 다시 띄우세요 |

```text
~/.config/guideline/locales/ja/
  pack.json
  messages.json
  templates/…
```

찾는 순서는 **사용자 폴더의 그 언어 → 패키지의 그 언어 → 사용자 폴더의 en → 패키지의 en** 입니다.
그래서 사용자 폴더에 `ko/messages.json` 을 두고 몇 문구만 덮어쓸 수도 있습니다.
언어팩에 빠진 문구와 템플릿은 영어로 채우므로, 옛 버전에 맞춘 언어팩도 멈추지 않습니다.

쓸 수 있는 언어와 지금 설정을 보세요.

```bash
guideline locale list
```

## 언어팩 만들기

패키지의 `locales/en/` 을 복사해 번역하세요.
`en` 이 모든 키와 템플릿의 정본입니다.

### pack.json

```json
{ "code": "ja", "name": "日本語", "version": "0.15.0" }
```

`version` 은 그 언어팩을 맞춘 도구 버전입니다.

### messages.json

키마다 문구 하나입니다.

```json
{ "pick.form": "フォーム: {url}" }
```

- 자리 표시는 `{이름}` 입니다. 영어 문구와 같은 이름의 자리 표시를 쓰세요. 다르면 그 문구는 쓰지 않고 영어로 대신합니다.
- 문구는 늘 글자로 보입니다. 웹에 넣을 때 이스케이프하므로 **HTML 은 쓸 수 없습니다**.
- JSON 이 깨졌거나 값이 문자열이 아니면 그 파일 전체를 쓰지 않고 경고합니다. 앞에 BOM 이 있어도 읽습니다.
- 복수형과 조사는 문장마다 번역자가 처리합니다.

### templates/

긴 글은 문서 통째로 번역합니다.

| 파일 | 쓰는 곳 |
| --- | --- |
| `management.md` | 프로젝트의 관리 지침 `.ruler/guideline.md` |
| `authoring.md` | 빈 서버 씨앗 `docs/authoring.md`(작성 규칙) |
| `skills/guideline-sync/SKILL.md`, `skills/guideline-export/SKILL.md` | 빈 서버 씨앗 스킬 |
| `llms.txt` | 서버의 `/llms.txt` |
| `new-file/*.md` | 관리자 웹 **새 파일**의 틀 |

템플릿의 자리 표시는 `{{이름}}` 입니다(예: `{{SERVER}}`, `{{propose}}`).
한 겹 중괄호(`{ … }`)는 그대로 남으므로 JSON 예시를 써도 됩니다.

언어팩의 템플릿은 그 언어에 맞는 표지 문구를 안내합니다. 영어·한국어가 아닌 언어팩은 영어 표지를 안내합니다. [지침의 표지 문구](../reference.md#지침의-표지-문구)를 보세요.

## 언어팩 확인하기

```bash
guideline locale check ~/.config/guideline/locales/ja
```

빠진 키, 남는 키, 자리 표시가 다른 키, 빠진 템플릿, `pack.json` 문제를 보입니다.
문제가 있으면 종료 코드 1 로 끝납니다.

## 다음 문서

- [언어 설정](../configuration.md#언어)
- [언어팩 명령](../reference.md#언어팩-명령)
