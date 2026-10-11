# Language packs

English · [한국어](ko/locales.md)

CLI messages, the admin web, and the guidelines the tool writes itself (management guideline, index, authoring rules, seed skills, `/llms.txt`, new-file templates) follow a language pack. English (`en`) and Korean (`ko`) ship with the package; other languages come as language pack folders you drop in. Human-written guidelines are never translated.

## Choosing a language

- The environment variable `GUIDELINE_LANG` decides. Without it the CLI reads `lang` from `~/.config/guideline/config.json` (e.g. `{ "lang": "ko" }`); without both the language is `en`. The server reads only the environment variable. Values like `ko-KR` or `KO` are read as `ko`.
- The CLI uses its own process's value and the server uses the server process's value. If they differ, output may mix languages (error messages and forms that come from the server are in the server's language).
- An unknown language code logs a warning and runs in English.

## Installing a language pack

A language pack is one folder named after the language code. Where it goes:

| Used by | Folder |
| --- | --- |
| CLI | `GUIDELINE_LOCALES_DIR`, otherwise `$XDG_CONFIG_HOME/guideline/locales`, otherwise `~/.config/guideline/locales` |
| Server | `GUIDELINE_LOCALES_DIR`, otherwise `locales/` in the data folder (`DATA_HOST_DIR/locales/` with Docker). Restart the server afterwards |

```
~/.config/guideline/locales/ja/
  pack.json
  messages.json
  templates/…
```

Lookup order is **the user folder's language → the package's language → the user folder's en → the package's en**. So you can also put a `ko/messages.json` in the user folder that overrides just a few strings. Strings and templates missing from a pack are filled in from English — a pack made for an older version never breaks.

```bash
guideline locale list                 # available languages and the current setting
```

## Making a language pack

Copy the package's `locales/en/` and translate it. `en` is the canonical set of every key and template.

### pack.json

```json
{ "code": "ja", "name": "日本語", "version": "0.15.0" }
```

`version` is the tool version the pack was made for.

### messages.json

One string per key.

```json
{ "pick.form": "フォーム: {url}" }
```

- Placeholders are `{name}`. Use **the same placeholder names** as the English string; otherwise that string is not used and English is shown instead.
- Strings are always shown as text. **HTML is not allowed** (strings are escaped when they go into web pages).
- If the JSON is broken or a value is not a string, the whole file is skipped with a warning. A leading BOM is fine.
- Plural forms and grammar are up to the translator, sentence by sentence.

### templates/

Long texts are translated as whole documents.

| File | Used for |
| --- | --- |
| `management.md` | The project's management guideline `.ruler/guideline.md` |
| `authoring.md` | The empty server seed `docs/authoring.md` (authoring rules) |
| `skills/guideline-sync/SKILL.md`, `skills/guideline-export/SKILL.md` | The empty server seed skills |
| `llms.txt` | The server's `/llms.txt` |
| `new-file/*.md` | Templates for "New file" on the admin web |

Template placeholders are `{{name}}` (for example `{{SERVER}}`, `{{propose}}`). Single braces (`{ … }`) are left alone, so JSON examples are fine.

### Checking

```bash
guideline locale check ~/.config/guideline/locales/ja
```

Shows missing keys, extra keys, keys with different placeholders, missing templates and `pack.json` problems. Exit code 1 if there are any.

## Markers in guidelines

The tool looks for fixed phrases in human-written guidelines. These markers are fixed in code, not in language packs, and **both the English and the earlier Korean forms are read whatever the language setting.** English is canonical. Language pack templates explain the markers for their language (packs other than English and Korean explain the English markers).

| Used in | Marker (English, canonical) |
| --- | --- |
| The section in a stack README with the table of overrides of other stacks | `## Overrides of other stacks` |
| A cell in that table | `` `<file>` "<section title>" `` |
| The first line of an override section | ``Overrides: `<stack>/<file>` "<section title>"`` |
| The section in an MCP README that builds the entry | `## Build on apply` |

The Korean forms are listed in the Korean version of this page.
