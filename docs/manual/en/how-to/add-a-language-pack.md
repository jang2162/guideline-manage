**English** | [한국어](../../ko/how-to/add-a-language-pack.md)

# Add a language pack

This guide installs a language pack, or makes a new one, for the CLI and the server.
It is for translators and for teams that want guideline-manage in a language other than English and Korean.

A language pack covers CLI messages, the admin web, and the guidelines the tool writes itself: the management guideline, the index, the authoring rules, the seed skills, `/llms.txt` and the new-file templates.
English (`en`) and Korean (`ko`) ship with the package.
Human-written guidelines are never translated.
To choose the language, see [Language](../configuration.md#language).

## Install a language pack

A language pack is one folder named after the language code.

| Used by | Folder |
| --- | --- |
| CLI | `GUIDELINE_LOCALES_DIR`, otherwise `$XDG_CONFIG_HOME/guideline/locales`, otherwise `~/.config/guideline/locales` |
| Server | `GUIDELINE_LOCALES_DIR`, otherwise `locales/` in the data folder (`DATA_HOST_DIR/locales/` with Docker). Restart the server afterwards |

```text
~/.config/guideline/locales/ja/
  pack.json
  messages.json
  templates/…
```

The lookup order is **the user folder's language → the package's language → the user folder's en → the package's en**.
So you can also put a `ko/messages.json` in the user folder that overrides only a few strings.
Strings and templates missing from a pack are filled in from English, so a pack made for an older version never breaks.

List the available languages and the current setting.

```bash
guideline locale list
```

## Make a language pack

Copy the package's `locales/en/` and translate it.
`en` is the canonical set of every key and template.

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

- Placeholders are `{name}`. Use the same placeholder names as the English string; otherwise that string is not used and English is shown instead.
- Strings are always shown as text. **HTML is not allowed**, because strings are escaped when they go into web pages.
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
| `new-file/*.md` | Templates for **New file** on the admin web |

Template placeholders are `{{name}}`, for example `{{SERVER}}` and `{{propose}}`.
Single braces (`{ … }`) are left alone, so JSON examples are fine.

Language pack templates explain the guideline markers for their language. Packs other than English and Korean explain the English markers. See [Markers in guidelines](../reference.md#markers-in-guidelines).

## Check a language pack

```bash
guideline locale check ~/.config/guideline/locales/ja
```

The command shows missing keys, extra keys, keys with different placeholders, missing templates and `pack.json` problems.
It exits with code 1 if there are any.

## Next

- [Language settings](../configuration.md#language)
- [Language pack commands](../reference.md#language-pack-commands)
