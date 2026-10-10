# Running the guideline server

English · [한국어](ko/server.md)

How to run and operate the server that holds the guideline source (`guideline-server`).

## What it has

- Admin web: list, file view and edit (with a warning preview before saving), new file, delete, rename, upload, history, diffs and revert, issuing and revoking tokens, export (tar.gz), proposal review (diff, conflicts, edit, accept, reject)
- Read API `/api/v1`: `health`, `catalog`, `tree`, `files/<path>`, `revisions`, `revisions/<number>`. Tokens go in `Authorization: Bearer <token>`
- Proposals API `/api/v1/proposals`: a propose-scope token proposes; an admin token applies right away with `apply: true`. Proposals are reviewed and accepted under "Proposals" on the web

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
4. Log in with the admin token at `/login` under `PUBLIC_URL`.
5. Fill in guidelines: "New file" on the admin web, or `POST /api/v1/proposals` with `apply: true` and the admin token (→ [guide.md](guide.md) "Running a guideline server").

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
- "Export" on the web gives the latest guidelines as a tar.gz in the source layout. That is the backup people download.

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

## Running locally

```bash
cp .env.example .env    # fill in ADMIN_TOKEN, PUBLIC_URL=http://localhost:3000, DATA_HOST_DIR
docker compose up --build
```

Without Docker: `ADMIN_TOKEN=… PUBLIC_URL=http://localhost:3000 DATA_DIR=./.data node server/bin/guideline-server.js`
