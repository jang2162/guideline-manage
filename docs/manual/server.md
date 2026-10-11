# Running the guideline server

English · [한국어](ko/server.md)

How to run and operate the server that holds the guideline source (`guideline-server`).

## What it has

- Web: block lists (stacks, skills, subagents, MCP) and block detail pages (block list · document · the block's files), adding blocks, block settings (display name, categories, adding files, rename, delete), file edit (with a warning preview before saving), new file, per-block download (tar.gz), Docs (`docs/<name>.md`), Usage (rendered llms.txt), history, diffs and revert, issuing, revoking and deleting tokens, proposal review (diff, conflicts, edit, accept, reject)
- Read API `/api/v1`: `health`, `catalog`, `tree`, `files/<path>`, `revisions`, `revisions/<number>`, `whoami` (the sent token's kind, name and scope). Tokens go in `Authorization: Bearer <token>`
- Proposals API `/api/v1/proposals`: a propose-scope token proposes; the admin token or an admin-scope token applies right away with `apply: true` and accepts or rejects with `POST /api/v1/proposals/<number>/accept|reject`. People review proposals under "Proposals" on the web

## Deploying with Docker Compose

`compose.yaml` at the repository root builds the server image from `server/Dockerfile` and keeps its data in `DATA_HOST_DIR`.

```bash
git clone https://github.com/jang2162/guideline-manage.git
cd guideline-manage
cp .env.example .env          # fill in the table below
docker compose up -d --build
```

Tools that deploy a Compose file straight from a Git repository work the same way. For example, a Komodo Git Repo Stack with `compose.yaml` as its file path and the variables below as its environment. Turn off automatic redeploys on push: commits that only change the CLI would rebuild the server too.

## Environment variables

| Key | Required | Description | Example |
| --- | --- | --- | --- |
| `ADMIN_TOKEN` | required (secret) | Admin token, at least 32 characters. Keep it in `.env` or your deploy tool's secret store, never in Git | |
| `PUBLIC_URL` | required | The address users open. Opening any other address (server IP:port and so on) makes login and saving return 403 | `https://guideline.example.com` |
| `DATA_HOST_DIR` | required | Host path for the DB (`guideline.db`) and backups (`backups/`). Must be writable by uid 1000 | `/data/guideline` |
| `HOST_PORT` | optional (3000) | Port opened on the host | `3000` |
| `PUBLIC_READ` | optional (1) | 1 opens viewing guidelines (web pages, read API, CLI pick/update/list) without login or token. 0 requires an admin login on the web and a read token for the API and CLI. Changing guidelines, reviewing proposals and managing tokens are always admin-only | `0` |
| `BACKUP_KEEP` | optional (14) | Number of automatic backups to keep | `30` |
| `TRUST_PROXY` | optional (0) | 1 behind a (single) reverse proxy. Login rate limits use the last value of `X-Forwarded-For`, which the proxy appends | `1` |
| `GUIDELINE_LANG` | optional (en) | Language of the admin web, API errors, `/llms.txt` and the seed of an empty server. `ko` for Korean. An unknown code logs a warning at startup and runs in English | `ko` |
| `GUIDELINE_SEED` | optional (on) | `off` skips the seed of an empty server. Use it when moving an old guideline repository clone in wholesale | `off` |
| `GUIDELINE_LOCALES_DIR` | optional | User language pack folder. Otherwise `locales/` in the data folder (`DATA_HOST_DIR/locales/` with Docker) | |

Leave TLS and the reverse proxy to the server's existing setup.

## First start

1. Create `DATA_HOST_DIR` on the server and run `sudo chown 1000:1000 <path>`.
2. Create an admin token with `openssl rand -base64 48` and put it in `.env` as `ADMIN_TOKEN`.
3. Run `docker compose up -d --build`. The log (`docker compose logs`) shows `guideline-server listening on port 3000`, and on an empty DB also `seeded the empty server with <language> guidelines (r1)`.
4. Open `PUBLIC_URL`. Anyone can browse guidelines and history and download them without logging in (with `PUBLIC_READ=0`, a login is required). To edit, revert, review proposals or manage tokens, use "Log in" at the top (`/login`) with the admin token.
5. Fill in guidelines: add blocks from the lists and use "New file" on a block page, or `POST /api/v1/proposals` with `apply: true` and the admin token (→ [guide.md](guide.md) "Running a guideline server").

## Upgrades

Check out the new release (`git pull`, or `git checkout v<version>`) and run `docker compose up -d --build`. The server is rebuilt and upgrades the DB schema at startup, first writing `backups/guideline-pre-v<version>-<time>.db` (never deleted automatically).

If it does not start, the first log line is the reason.

| Log | Fix |
| --- | --- |
| `… is not set`, `… must be at least 32 characters` | Fix `.env` and start again |
| `cannot write to … (chown 1000:1000)` | `chown 1000:1000` the `DATA_HOST_DIR` |
| `DB schema vN is newer than this server (vM) …` | A newer image was deployed and then rolled back. Deploy the newer version again, or restore the pre-upgrade backup |

Operating logs and configuration errors are in English whatever the language setting.

## Backup and restore

- At startup and every 24 hours after, the server writes `backups/guideline-<YYYYMMDD-HHmmss>.db` (UTC) and deletes ones beyond `BACKUP_KEEP`.
- "Download (.tar.gz)" on a block page gives that block in the source layout. The whole source is `GET /api/v1/archive` (what the CLI uses).

To restore:

1. `docker compose stop`.
2. On the server, `cp <DATA_HOST_DIR>/backups/<backup>.db <DATA_HOST_DIR>/guideline.db` and delete `guideline.db-wal` and `guideline.db-shm`.
3. `docker compose start`.

## Applying to projects (0.12)

- **CLI login**: `guideline login` opens `/cli/login`. Clicking "Issue" in an admin session sends a single-use, two-minute code to the CLI's `127.0.0.1` callback, and the CLI exchanges it at `POST /api/v1/cli/token` for a read token (named `cli-<host>-<6 chars>`). Revoke issued tokens on the "Tokens" page.
- **Forms**: `POST /api/v1/forms` (read token, 2 MB body) creates a form and returns `/forms/<id>?k=<link token>`. The link covers only that form and turns into a cookie (and leaves the address) when first opened. A form expires if not opened within 10 minutes, or after 90 seconds without page signals once opened. Forms finished more than a day ago are deleted when a new form is created.
- **API**: `GET /api/v1/archive?rev=` (tar.gz), `GET /api/v1/forms/<id>/result?wait=`, `POST /api/v1/cli/token`, `DELETE /api/v1/tokens/self`. `/api/v1/health` reports `api: 2`.
- **`/llms.txt`**: usage and setup guide that opens without login (the language pack's `templates/llms.txt`, with `{{SERVER}}` filled from `PUBLIC_URL`). Linked from "Usage" at the top of the admin web and from the login page.

## Proposals (0.13)

- Each proposal holds, per file, the new content (or deletion) and the source hash the proposer saw (base). On accept, if the source is unchanged it is taken as is; if it changed, a line-based 3-way merge combines them. If any file overlaps, it cannot be accepted (Outdated).
- Accepting is one revision (source `proposal`, author = token name, message "proposal #<number>: <title>").
- Issued tokens see only their own proposals. Only admin tokens can use `apply: true`.

## Language and seed (0.15)

- **Language**: one language per server process (`GUIDELINE_LANG`). There is no in-page language switch. Put user language packs in `GUIDELINE_LOCALES_DIR` or `locales/<code>/` in the data folder and restart the server (→ [locales.md](locales.md)).
- **Seed**: when a server with no revisions starts, it adds `docs/authoring.md`, `skills/guideline-sync/SKILL.md` and `skills/guideline-export/SKILL.md` in the server language as revision 1 (author `system`, source `seed`).
- **Schema 4**: `seed` is added to the revision sources. A 0.14 server's DB is backed up and upgraded at startup.

## Public read (0.16)

- **`PUBLIC_READ`** (default 1): viewing guidelines (web pages, read API, CLI pick/update/list) needs no login or token. With 0, the web needs an admin login and the API and CLI need a read token, as in 0.15.
- Changing guidelines (edit, revert, upload), the proposal pages and API, token management and CLI login approval stay admin-only (tokens for the proposal API) regardless of the setting. Visitors don't see those buttons and get "Log in" at the top.
- Even on a public server, a wrong or revoked token gets 401.
- A public server lets anyone create a form (`POST /api/v1/forms`) without a token. Its result needs the form URL's link token in the `X-Form-Link` header.
- `/api/v1/health` reports `publicRead`. Fetching without a token needs CLI 0.16 or later (the 0.15 CLI stops before asking the server when it has no token).

## Blocks and admin tokens (0.17)

- **The web is organized by blocks.** Lists show stacks, skills, subagents and MCP servers; a block page shows the block list on the left, the chosen document in the middle and the block's files on the right. New file, upload, rename, delete and download live on the block page; lists only add blocks. The old file browser (`/f/…`, `/d/…`) and the whole-source export (`/export.tar.gz`) are gone.
- **Settings** holds what belongs to no block: the authoring rules, skeleton stacks, items the lists ignore, and warnings. **Usage** renders llms.txt with a "Copy link" button; it is open even with `PUBLIC_READ=0`.
- **Domain stacks**: a stack named `<tool>__<domain>` shows the tool name with a domain tag. Paths and API names are unchanged.
- **Token scope `admin`**: applies directly (`apply: true`, `guideline propose --apply`; from 0.20 `guideline propose` does it by default), sees every proposal, and accepts or rejects through the API. It cannot log in to the web or manage tokens.
- **Deleting tokens**: a revoked token can be deleted from the list. The row stays hidden in the DB because revisions point to it; its name can be reused.
- **Schema 5**: tokens get the `admin` scope and a deleted flag. A 0.16 server's DB is backed up and upgraded at start.

## Web cleanup (0.18)

- **Docs** (`/docs`) replaces 0.17's Settings (`/settings`). It is the first kind tab and shows and creates `docs/<name>.md` documents. The authoring rules (`authoring.md`) and the management additions (`management.md`) are grouped as "Also read by agents" and cannot be renamed or deleted on the web. New documents are not sent to projects.
- The pages for files outside blocks, ignored items and warnings are gone. The web handles only blocks and documents made through this service.
- **Block settings** (`/settings/<kind>/<name>`, admin): save the display name and categories, add or upload files, rename the block (also fixing the `name:` line of subagents and skills) or delete it. The block page's right side keeps only the file tree (always ● · reference ○) and a button to this page; "Download block" moved to the top button row.
- **Display name**: `label` in a block's frontmatter. Shown on the web, in the export form and in `guideline list`, and added to `/api/v1/catalog` as a `labels` map.
- **History and proposals**: lists show 30 per page (`?page=`; the old `?before=` is ignored), and revision and proposal pages show the changed files as a tree (kind → block → file) on the left and one chosen file (`?file=`) in the middle. Diffs longer than 80 lines fold.
- The schema is unchanged.

## Pick flow (0.19)

- **Required blocks**: `requires: [rules/x]` in a block's frontmatter. The export form checks them too, and `/api/v1/catalog` adds a `requires` map. Edit them under "Required blocks" in the web block settings; renaming a block also fixes other blocks' `requires`.
- **Agent recommendations**: a form opened with `guideline pick --recommend <file>` has the recommended blocks checked, with reasons. The form goes in steps (guidelines → MCP → subagents → skills → review), and category buttons only filter.
- **⚠️ Servers already running**: the `guideline-sync` skill and the authoring rules (`docs/authoring.md`) are seeds written only when a server first starts. On an existing server, add the "Recommend and receive" section to that skill and the "Required blocks" section to the authoring rules on the web (see the same files under the language pack's `templates/`). `llms.txt` is rebuilt per request and changes right away.
- The schema is unchanged.

## Admin tokens apply directly (0.20)

- **`GET /api/v1/whoami`**: returns the sent token as `{ kind, name, scope }` — the admin token is `{ kind: "admin", name: null, scope: "admin" }`, an issued token is `{ kind: "token", name, scope }`. No token, or a wrong or revoked one, gets 401 even with `PUBLIC_READ=1`.
- **`guideline propose` applies directly with an `admin` scope token.** It asks `whoami` first; with the `admin` scope it sends `apply: true`, otherwise a proposal as before. `--review` always sends a proposal, `--apply` still applies explicitly, and both together are a usage error (exit code 2). The result says it was applied directly because of the admin token, `--dry-run` says which of the two sending would do, and `--json` adds `mode` (`apply` or `proposal`).
- **`guideline status` and `guideline login` show the token's scope** (`token` in `status --json`).
- **Mixed versions**: a 0.20 CLI on an older server gets 404 from `whoami` and sends proposals as before; status and login show no scope. An older CLI on a 0.20 server behaves as before.
- **⚠️ Servers already running**: the `guideline-export` skill is a seed written only when a server first starts. Its step 2 used to say `--apply` only when the user asked to skip review. On an existing server, rewrite that step on the web to say that with an `admin` token `guideline propose` applies directly and `--review` asks for a review (see the language pack's `templates/skills/guideline-export/SKILL.md`). The same goes for the "send an edited copy upstream" row of `guideline-sync`. `llms.txt` is rebuilt per request and changes right away.
- The schema is unchanged.

## Running locally

```bash
cp .env.example .env    # fill in ADMIN_TOKEN, PUBLIC_URL=http://localhost:3000, DATA_HOST_DIR
docker compose up --build
```

Without Docker: `ADMIN_TOKEN=… PUBLIC_URL=http://localhost:3000 DATA_DIR=./.data node server/bin/guideline-server.js`
