# Changelog

Notable changes to guideline-manage, newest first.
Until `1.0.0`, breaking changes bump the minor version (see [CONTRIBUTING.md](CONTRIBUTING.md#versioning)).
Manual steps for upgrading are in [Upgrade the server and the CLI](docs/manual/en/how-to/upgrade.md).

## Unreleased

- **Admin web:** on a block page, the file tree moved from the right side to just right of the block list (block list · file tree · document).

## 0.21.0

- **`missing-requires` to-do:** `guideline update` and `guideline status` report a to-do for each received block that needs (`requires`) blocks the project has not received. `data.missing` lists the missing block keys. With several sources, each source is judged by its own `requires` and its own blocks, before aliases.
- `/llms.txt` documents `--source`.

## 0.20.0 — Admin tokens apply directly

- **`GET /api/v1/whoami`**: returns the sent token as `{ kind, name, scope }` — the admin token is `{ kind: "admin", name: null, scope: "admin" }`, an issued token is `{ kind: "token", name, scope }`. No token, or a wrong or revoked one, gets 401 even with `PUBLIC_READ=1`.
- **`guideline propose` applies directly with an `admin` scope token.** It asks `whoami` first; with the `admin` scope it sends `apply: true`, otherwise a proposal as before. `--review` always sends a proposal, `--apply` still applies explicitly, and both together are a usage error (exit code 2). The result says it was applied directly because of the admin token, `--dry-run` says which of the two sending would do, and `--json` adds `mode` (`apply` or `proposal`).
- **`guideline status` and `guideline login` show the token's scope** (`token` in `status --json`).
- **Mixed versions**: a 0.20 CLI on an older server gets 404 from `whoami` and sends proposals as before; status and login show no scope. An older CLI on a 0.20 server behaves as before.
- **⚠️ Servers already running**: the `guideline-export` skill is a seed written only when a server first starts. Its step 2 used to say `--apply` only when the user asked to skip review. On an existing server, rewrite that step on the web to say that with an `admin` token `guideline propose` applies directly and `--review` asks for a review (see the language pack's `templates/skills/guideline-export/SKILL.md`). The same goes for the "send an edited copy upstream" row of `guideline-sync`. `llms.txt` is rebuilt per request and changes right away.
- The schema is unchanged.

## 0.19.0 — Pick flow

- **Required blocks**: `requires: [rules/x]` in a block's frontmatter. The export form checks them too, and `/api/v1/catalog` adds a `requires` map. Edit them under "Required blocks" in the web block settings; renaming a block also fixes other blocks' `requires`.
- **Agent recommendations**: a form opened with `guideline pick --recommend <file>` has the recommended blocks checked, with reasons. The form goes in steps (guidelines → MCP → subagents → skills → review), and category buttons only filter.
- **⚠️ Servers already running**: the `guideline-sync` skill and the authoring rules (`docs/authoring.md`) are seeds written only when a server first starts. On an existing server, add the "Recommend and receive" section to that skill and the "Required blocks" section to the authoring rules on the web (see the same files under the language pack's `templates/`). `llms.txt` is rebuilt per request and changes right away.
- The schema is unchanged.

## 0.18.0 — Web cleanup

- **Docs** (`/docs`) replaces 0.17's Settings (`/settings`). It is the first kind tab and shows and creates `docs/<name>.md` documents. The authoring rules (`authoring.md`) and the management additions (`management.md`) are grouped as "Also read by agents" and cannot be renamed or deleted on the web. New documents are not sent to projects.
- The pages for files outside blocks, ignored items and warnings are gone. The web handles only blocks and documents made through this service.
- **Block settings** (`/settings/<kind>/<name>`, admin): save the display name and categories, add or upload files, rename the block (also fixing the `name:` line of subagents and skills) or delete it. The block page's right side keeps only the file tree (always ● · reference ○) and a button to this page; "Download block" moved to the top button row.
- **Display name**: `label` in a block's frontmatter. Shown on the web, in the export form and in `guideline list`, and added to `/api/v1/catalog` as a `labels` map.
- **History and proposals**: lists show 30 per page (`?page=`; the old `?before=` is ignored), and revision and proposal pages show the changed files as a tree (kind → block → file) on the left and one chosen file (`?file=`) in the middle. Diffs longer than 80 lines fold.
- The schema is unchanged.

## 0.17.0 — Blocks and admin tokens

- **The web is organized by blocks.** Lists show stacks, skills, subagents and MCP servers; a block page shows the block list on the left, the chosen document in the middle and the block's files on the right. New file, upload, rename, delete and download live on the block page; lists only add blocks. The old file browser (`/f/…`, `/d/…`) and the whole-source export (`/export.tar.gz`) are gone.
- **Settings** holds what belongs to no block: the authoring rules, skeleton stacks, items the lists ignore, and warnings. **Usage** renders llms.txt with a "Copy link" button; it is open even with `PUBLIC_READ=0`.
- **Domain stacks**: a stack named `<tool>__<domain>` shows the tool name with a domain tag. Paths and API names are unchanged.
- **Token scope `admin`**: applies directly (`apply: true`, `guideline propose --apply`; from 0.20 `guideline propose` does it by default), sees every proposal, and accepts or rejects through the API. It cannot log in to the web or manage tokens.
- **Deleting tokens**: a revoked token can be deleted from the list. The row stays hidden in the DB because revisions point to it; its name can be reused.
- **Schema 5**: tokens get the `admin` scope and a deleted flag. A 0.16 server's DB is backed up and upgraded at start.

## 0.16.0 — Public read

- **`PUBLIC_READ`** (default 1): viewing guidelines (web pages, read API, CLI pick/update/list) needs no login or token. With 0, the web needs an admin login and the API and CLI need a read token, as in 0.15.
- Changing guidelines (edit, revert, upload), the proposal pages and API, token management and CLI login approval stay admin-only (tokens for the proposal API) regardless of the setting. Visitors don't see those buttons and get "Log in" at the top.
- Even on a public server, a wrong or revoked token gets 401.
- A public server lets anyone create a form (`POST /api/v1/forms`) without a token. Its result needs the form URL's link token in the `X-Form-Link` header.
- `/api/v1/health` reports `publicRead`. Fetching without a token needs CLI 0.16 or later (the 0.15 CLI stops before asking the server when it has no token).

## 0.15.0 — Language and seed

- **The default language is now English.** To keep Korean, set `GUIDELINE_LANG=ko` in your shell and in the server environment. Otherwise the next `update` rewrites the management guideline (`.ruler/guideline.md`) and the index (`99-reference.md`) in English.
- **Language**: one language per server process (`GUIDELINE_LANG`). There is no in-page language switch. Put user language packs in `GUIDELINE_LOCALES_DIR` or `locales/<code>/` in the data folder and restart the server.
- **Seed**: when a server with no revisions starts, it adds `docs/authoring.md`, `skills/guideline-sync/SKILL.md` and `skills/guideline-export/SKILL.md` in the server language as revision 1 (author `system`, source `seed`).
- **The 0.10 commands for a guideline repository are gone.** `init`, `pick`/`update` inside a guideline repository and that repository's management skills were removed; the source lives only on the guideline server.
- **Checking a source folder** is `guideline list <folder>` (the current folder is no longer treated as a source automatically).
- Markers in human-written guidelines are read in English (`## Overrides of other stacks`, ``Overrides: `<stack>/<file>` "<section title>"``, `## Build on apply`) and in their earlier Korean forms alike, so existing guidelines need no edits.
- **Schema 4**: `seed` is added to the revision sources. A 0.14 server's DB is backed up and upgraded at startup.

## 0.13 — Proposals

- Each proposal holds, per file, the new content (or deletion) and the source hash the proposer saw (base). On accept, if the source is unchanged it is taken as is; if it changed, a line-based 3-way merge combines them. If any file overlaps, it cannot be accepted (Outdated).
- Accepting is one revision (source `proposal`, author = token name, message "proposal #<number>: <title>").
- Issued tokens see only their own proposals. Only admin tokens can use `apply: true`.
- **Schema 3**: `proposals` and `proposal_changes`. A 0.12 server's DB is backed up and upgraded at startup.

## 0.12 — Applying to projects

- **CLI login**: `guideline login` opens `/cli/login`. Clicking "Issue" in an admin session sends a single-use, two-minute code to the CLI's `127.0.0.1` callback, and the CLI exchanges it at `POST /api/v1/cli/token` for a read token (named `cli-<host>-<6 chars>`). Revoke issued tokens on the "Tokens" page.
- **Forms**: `POST /api/v1/forms` (read token, 2 MB body) creates a form and returns `/forms/<id>?k=<link token>`. The link covers only that form and turns into a cookie (and leaves the address) when first opened. A form expires if not opened within 10 minutes, or after 90 seconds without page signals once opened. Forms finished more than a day ago are deleted when a new form is created.
- **New API**: `GET /api/v1/archive?rev=` (tar.gz), `GET /api/v1/forms/<id>/result?wait=`, `POST /api/v1/cli/token`, `DELETE /api/v1/tokens/self`. `/api/v1/health` reports `api: 2`.
- **`/llms.txt`**: usage and setup guide that opens without login (the language pack's `templates/llms.txt`, with `{{SERVER}}` filled from `PUBLIC_URL`). Linked from "Usage" at the top of the admin web and from the login page.
- **Schema 2**: the `forms` table is added. A 0.11 server's DB is backed up and upgraded at startup.
