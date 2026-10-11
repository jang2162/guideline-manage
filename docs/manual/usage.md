# Command reference

English · [한국어](ko/usage.md)

Options, environment variables and exit codes of the `guideline` command. For a first walkthrough, see [guide.md](guide.md).

## Environment variables

| Name | Meaning |
| --- | --- |
| `GUIDELINE_SERVER` | Guideline server address, used when there is no `--server` and no project `guideline.json` |
| `GUIDELINE_TOKEN` | A token to use instead of stored ones (CI and so on). Used only with a single source |
| `GUIDELINE_LANG` | Language of CLI messages and of text written into projects (management guideline, index). Default `en`; `ko` for Korean. Without it the CLI reads `lang` from `~/.config/guideline/config.json` (`{ "lang": "ko" }`) |
| `GUIDELINE_LOCALES_DIR` | User language pack folder. Otherwise `$XDG_CONFIG_HOME/guideline/locales`, otherwise `~/.config/guideline/locales` |
| `GUIDELINE_PROJECTS_DIR` | Parent folder where `pick --new <name>` creates projects |

Tokens are stored per server in `~/.config/guideline/credentials.json` (mode 600).

## Project commands

Run them in a unit directory (one with `.ruler/`). Common options: `--project <path>` (default: current directory), `--server <URL>`, `--source <name>` (just one source when there are several), `--json`.

| Command | What it does |
| --- | --- |
| `guideline pick` | Opens the server form and applies the chosen items on submit. `--new <name\|path>` creates a new project (`git init`) and applies. `--no-browser` only prints the address. `--recommend <file\|->` opens the form with blocks an agent chose (JSON `{"block key": "reason"}`) already checked — one source at a time (add `--source` when there are several). Needs a 0.19+ server; an older server opens the form without the recommendations |
| `guideline update` | Re-applies the chosen items from the latest server revision. Skips files edited in the project; `--force` overwrites them |
| `guideline status` | Shows whether the applied guidelines are current and what the project changed, plus the stored token's name and scope (`token` in `--json`; nothing when there is no token or the server is older than 0.20) |
| `guideline propose` | Turns edited copies back into source form and proposes them. With an `admin` scope token it applies them directly instead (no review); `--review` sends a proposal anyway, `--apply` applies explicitly (an error with a non-admin token). `--dry-run` (also says which of the two sending would do), `--title`, `--message`, `--only <item,…>`, `--from <folder>`. `--json` adds `mode`: `apply` or `proposal` (absent when there is nothing to send). The dry run is the authoritative way to see the mode: it asks with the same token and server the real send uses, while `status` may resolve a different token (several sources, `GUIDELINE_TOKEN`) |
| `guideline login` / `logout` | Logs in to a server and stores a token, or deletes it. `--token-stdin` stores a token without a browser. After saving, `login` prints the token's scope (`read`, `propose` or `admin`) |

`pick` and `update` print the written files, deleted files and **to-dos**. The kinds of to-dos are listed in the "What agents do" table of the server's `/llms.txt`.

## Source commands

| Command | What it does |
| --- | --- |
| `guideline source <folder>` | Unpacks the latest server source into an empty folder. Edit it at source paths, then send it with `propose --from <folder>` |
| `guideline list [folder]` | Lists the source and its checks. With a folder, reads that folder (a source from `source`); otherwise the server |

`list` shows stacks (guideline files with their load, and overrides between stacks), skills, subagents and MCP servers, plus files left out for breaking the rules (Ignored) and things to fix (warning), each with its reason. Warnings do not change the exit code (0). The writing rules are the source's `docs/authoring.md`.

## Language pack commands

| Command | What it does |
| --- | --- |
| `guideline locale list` | Available languages (package and user folder) and the current setting |
| `guideline locale check <folder>` | Compares a language pack folder with the canonical `en`: missing keys, extra keys, keys with different placeholders, missing templates, `pack.json` problems |

How to make a language pack: [locales.md](locales.md).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Failure (server unreachable, no permission, write failure, language pack problems and so on). Also 1 when one source failed and the others were applied |
| 2 | Usage error, not a ruler project, name clash |
| 3 | `pick`: not submitted (cancelled, tab closed, never opened). Nothing was written |

## Moving to 0.15

- **The default language is now English.** To keep Korean, set `GUIDELINE_LANG=ko` in your shell and in the server environment. Otherwise the next `update` rewrites the management guideline (`.ruler/guideline.md`) and the index (`99-reference.md`) in English.
- **The 0.10 commands for a guideline repository are gone.** `init`, `pick`/`update` inside a guideline repository and that repository's management skills were removed; the source lives only on the guideline server. To move an old guideline repository clone to a server, start an empty server with `GUIDELINE_SEED=off` and upload the clone's `rules/`, `skills/`, `agents/`, `mcp/` and `docs/authoring.md` with an admin token to `POST /api/v1/proposals` with `apply: true`.
- **Checking a source folder** is `guideline list <folder>` (the current folder is no longer treated as a source automatically).
- Markers in human-written guidelines are read in English (`## Overrides of other stacks`, ``Overrides: `<stack>/<file>` "<section title>"``, `## Build on apply`) and in their earlier Korean forms alike, so existing guidelines need no edits ([locales.md](locales.md)).
