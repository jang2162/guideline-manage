# guideline-manage

English · [한국어](README.ko.md)

A tool for keeping a team's shared coding-agent guidelines (per-stack rules, skills, subagents, MCP settings) on a **guideline server** and picking them into projects with the `guideline` CLI. Projects receive them as [ruler](https://github.com/intellectronica/ruler) sources (`.ruler/`).

```
guideline server (source DB) ── admin web: view, edit, history, proposal review, tokens
        │  ▲
        │  │ guideline propose (proposal → accepted by an admin)
        ▼  │
project: guideline pick / status / update → copies in .ruler/ + guideline.json + guideline-lock.json
```

## Install

You need Node 24 or later.

```bash
npm install -g guideline-manage   # provides the guideline command
```

The server runs with Docker Compose from this repository ([docs/server.md](docs/server.md)).

## Usage

```bash
guideline login --server <URL>   # once per machine
guideline pick                   # choose in the server form; submitting applies right away
guideline status                 # are we up to date?
guideline update                 # same choices, latest version
guideline propose --dry-run      # propose edited copies upstream (preview without sending)
```

- **New here? Start with [docs/guide.md](docs/guide.md)** — installation, running a server, receiving guidelines, overrides and troubleshooting, in order.
- Point agents at the server's `/llms.txt` ("Usage" at the top of the admin web).
- Command reference: [docs/usage.md](docs/usage.md). Running the server: [docs/server.md](docs/server.md). Language packs: [docs/locales.md](docs/locales.md).
- Projects must use ruler (`.ruler/`). Subdirectories of a monorepo receive guidelines separately.
- A project can receive from several guideline servers (`--source`). Name clashes are resolved with aliases in `guideline.json`.
- The source changes through proposals: edited copies with `guideline propose`, new guidelines with `guideline source` + `guideline propose --from`. An admin accepts them under "Proposals" on the web.

## Language

English is the default. With **`GUIDELINE_LANG=ko`**, CLI messages, the admin web, the management guideline and index written into projects, and the seed of an empty server are in Korean. For the CLI you can instead put `{ "lang": "ko" }` in `~/.config/guideline/config.json`; the environment variable wins. Set it for the CLI and the server separately. Other languages come as language pack folders you drop in ([docs/locales.md](docs/locales.md)).

**Coming from 0.14 or earlier:** the default language is now English. To keep Korean, set `GUIDELINE_LANG=ko` in your shell and in the server environment; otherwise the next `update` rewrites the management guideline and index in English. The 0.10 docs-repository commands (`init`, `pick`/`update` inside a guideline repository, and its management skills) are gone — see "Moving to 0.15" in [docs/usage.md](docs/usage.md).

## Development

```bash
pnpm test                                # node --test. Tests run with GUIDELINE_LANG=ko
node cli/bin/guideline.js help
ADMIN_TOKEN=$(openssl rand -base64 48) PUBLIC_URL=http://localhost:3000 DATA_DIR=./.data node server/bin/guideline-server.js   # server
```

## Releases

GitHub Actions publishes to npm. Do not run `pnpm publish` locally.

```bash
pnpm version minor            # or patch, major. Creates the commit and the v<version> tag
git push --follow-tags        # the tag starts the release workflow
```

A `v<SemVer>` tag runs `.github/workflows/release.yml`: it checks that the tag matches `package.json`, runs `pnpm test`, and publishes with provenance. It needs an `NPM_TOKEN` repository secret. Pull requests and pushes to main run only the tests (`ci.yml`).

## Versioning

- Command behavior or skill procedures change: minor
- Anything else: patch

Until `1.0.0`, breaking changes also bump the minor version.

## Layout

| Path | Contents |
| --- | --- |
| `cli/` | The `guideline` command. `cli/src/i18n.js` reads the language setting and language packs |
| `locales/` | Language packs: `en` (canonical) and `ko`. `messages.json` strings and `templates/` long texts (management guideline, authoring rules, seed skills, llms.txt, new-file templates) |
| `server/` | The guideline server. `server/src/` server code (`web/` admin pages), `server/static/` page CSS and JS, `server/Dockerfile`. Not part of the npm package |
| `compose.yaml` | Guideline server deployment with Docker Compose. Environment variables in `.env.example` |
| `.github/workflows/` | CI (tests) and release (npm publish) |
| `docs/` | Documentation for people (English). Korean in `docs/ko/` |

## License

[MIT](LICENSE)
