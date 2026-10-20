**English** | [한국어](../ko/configuration.md)

# Configuration

This page lists every setting of the `guideline` CLI and the guideline server.
It is for CLI users and server operators looking up a value.

## CLI environment variables

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `GUIDELINE_SERVER` | URL | none | Guideline server address. Used when there is no `--server` and no project `guideline.json` |
| `GUIDELINE_TOKEN` | string | none | A token to use instead of stored ones, for CI and so on. Used only with a single source |
| `GUIDELINE_LANG` | language code | `en` | Language of CLI messages and of text written into projects (management guideline, index). `ko` for Korean. Without it the CLI reads `lang` from `~/.config/guideline/config.json` |
| `GUIDELINE_LOCALES_DIR` | path | `$XDG_CONFIG_HOME/guideline/locales`, otherwise `~/.config/guideline/locales` | User language pack folder |
| `GUIDELINE_PROJECTS_DIR` | path | none | Parent folder where `pick --new <name>` creates projects |

## CLI files

| File | Contents |
| --- | --- |
| `~/.config/guideline/config.json` | CLI settings. `{ "lang": "ko" }` sets the language when `GUIDELINE_LANG` is not set |
| `~/.config/guideline/credentials.json` | Stored tokens, one per server (mode 600) |

## Server environment variables

`.env.example` at the repository root lists the same keys.
Docker Compose reads them from `.env`.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `ADMIN_TOKEN` | string, required, secret | none | Admin token, at least 32 characters. It works as the admin web's login password. Keep it in `.env` or your deploy tool's secret store, never in Git. Create one with `openssl rand -base64 48` |
| `PUBLIC_URL` | URL, required | none | The address users open, for example `https://guideline.example.com`. Opening any other address (server IP:port and so on) makes login and saving return 403 |
| `DATA_HOST_DIR` | path, required with Docker | none | Host path for the DB (`guideline.db`) and backups (`backups/`), for example `/data/guideline`. Must be writable by uid 1000 |
| `HOST_PORT` | integer | `3000` | Port opened on the host (Docker) |
| `PUBLIC_READ` | `0` or `1` | `1` | `1` opens viewing guidelines (web pages, read API, CLI `pick`, `update` and `list`) without login or token. `0` requires an admin login on the web and a read token for the API and CLI. Changing guidelines, reviewing proposals and managing tokens are always admin-only |
| `BACKUP_KEEP` | integer | `14` | Number of automatic backups to keep, for example `30` |
| `TRUST_PROXY` | `0` or `1` | `0` | `1` behind a single reverse proxy. Login rate limits then use the last value of `X-Forwarded-For`, which the proxy appends |
| `GUIDELINE_LANG` | language code | `en` | Language of the admin web, API errors, `/llms.txt` and the seed of an empty server. `ko` for Korean. An unknown code logs a warning at startup and runs in English |
| `GUIDELINE_SEED` | `on` or `off` | `on` | `off` skips the seed of an empty server. Use it when moving an old guideline repository clone in wholesale |
| `GUIDELINE_LOCALES_DIR` | path | `locales/` in the data folder (`DATA_HOST_DIR/locales/` with Docker) | User language pack folder. Only without Docker: Compose does not pass it to the container, so with Docker put packs in `DATA_HOST_DIR/locales/` |
| `DATA_DIR` | path | `/data` | Data folder when you run the server without Docker, for example `./.data` |
| `PORT` | integer | `3000` | Port the server listens on when you run it without Docker |

Operating logs and configuration errors are in English whatever the language setting.

## Language

- `GUIDELINE_LANG` decides. Without it the CLI reads `lang` from `~/.config/guideline/config.json` (for example `{ "lang": "ko" }`). Without both, the language is `en`. The server reads only the environment variable.
- Values like `ko-KR` or `KO` are read as `ko`.
- The CLI uses its own process's value and the server uses the server process's value. Set them separately. If they differ, output may mix languages: error messages and forms that come from the server are in the server's language.
- The server runs in one language per process. There is no in-page language switch.
- An unknown language code logs a warning and runs in English.
- Other languages come as language packs. See [Add a language pack](how-to/add-a-language-pack.md).

## Next

- [Command reference](reference.md)
- [Troubleshooting](troubleshooting.md)
