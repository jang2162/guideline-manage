# Changelog

Notable changes to guideline-manage, newest first.
Until `1.0.0`, breaking changes bump the minor version (see [CONTRIBUTING.md](CONTRIBUTING.md#versioning)).
Manual steps for upgrading are in [Upgrade the server and the CLI](docs/manual/en/how-to/upgrade.md).

## Unreleased

### Added

- **`guideline apply`:** composes the generated agent files from `.guideline/` and `.ruler/ruler.project.toml` without the server, updates the `.gitignore` block and runs `ruler apply` at the git root. Use it after a clone, in a new worktree and from `prepare`. `pick`, `pick --local` and `update` compose the same way at their end, and at the git root they compose the units below it too, before ruler runs. Exit code 2 when nothing was received yet or the project is still in the old layout. A `CLAUDE.md` that ruler wrote for every agent because `.ruler/ruler.toml` was missing is deleted and reported (kept and reported when a `default_agents` list over several lines makes it unclear). At the git root of a monorepo it also composes every unit below it that git tracks (a directory with a committed `guideline-lock.json`), then runs ruler once, so one `apply` (or the root's `prepare`) after a clone fills every unit; this works when the root is not a guideline project too. A unit still in the old layout is skipped with a `unit-update` to-do. A unit whose generated files cannot all be written names the unit in the error and gets a `unit-write-failed` to-do (exit code 1). At a git root that is not a guideline project, `nested` is read only from the root's `.ruler/ruler.toml`; without that file you get `root-ruler-toml`, not `nested-off`.
- **New to-do kinds:** `apply`, `root-apply`, `unit-update`, `unit-problem`, `unit-write-failed`, `root-ruler-toml`, `no-copy`, `override-unchosen`, `mcp-conflict`, `untracked`, `stray-ruler-output`, `migrated`, `manifest-v3`, `prepare`, `prepare-manual`, `dev-dependency` and `apply-hook`. `subagents-off` now means a subagent copy exists but was not composed. `status` reports `apply`, `dev-dependency`, `prepare-manual`, `no-copy`, `override-unchosen`, `mcp-conflict` and `blocked`, and `update` repeats `dev-dependency` and `prepare-manual`, until they are fixed. `/llms.txt`, the `guideline-sync` skill and the manual describe them.
- **Personal scope: `guideline pick --local`.** One worker adds blocks to the project's choice, or removes blocks from it, for themselves only, in a personal form (**As project**, **Add**, **Remove** per block). The personal selection (`local.json`) and the personal copies are kept in git's common directory (`<git common dir>/guideline/units/<unit key>/`), shared by the worktrees of a clone and never committed. `guideline.json`, `guideline-lock.json`, `.guideline/` and the `.gitignore` block do not change; generated files that only the personal scope adds are listed in `<git common dir>/info/exclude`, in a block per unit and worktree. `update` updates the personal copies with the project, `apply` composes them without the server, and `propose` never sends them. `--recommend` takes `{"add": {…}, "remove": {…}}` with `--local`. Needs git 2.31 or later (exit code 2 otherwise) and a 0.24 server (exit code 1, "This server does not know the personal form"). See [Use guidelines only on your machine](docs/manual/en/how-to/use-guidelines-only-on-your-machine.md).
- **Required blocks:** the project pick form has a **Required** checkbox on chosen blocks, saved as `required` of the source in `guideline.json`. Nobody can remove a Required block, or a stack that holds one, in a personal selection; an earlier removal is ignored with a `personal-ignored` to-do. `pick` drops a Required mark when you uncheck the block.
- **Machine defaults:** **Save this selection as my default** in the personal form stores the selection per server address in `defaults.json` in the CLI's config folder (`$XDG_CONFIG_HOME/guideline/` or `~/.config/guideline/`). It only pre-checks the personal form where you have no personal selection yet; `update` and `apply` never read it. The last run that saves defaults sets them for that server; several sources of one server in the same run are merged.
- **Personal to-dos:** `setup-personal` (set up a personal stack without changing committed files, and tell the user about a step that would), `personal-ignored`, `personal-shadowed`, `personal-revision`, `personal-sync` and `local-bad`. To-dos from the personal copies carry `scope: "personal"`, and `removed-upstream` for a personal block says to remove it with `pick --local`. `status` prints "Personal scope — added …" and "removed …" lines, and `status --json` has `personal` (`added`, `removed`, `ignored`, `shadowed`, `items`; `null` outside git or when `local.json` cannot be read).
- **New `override-target` to-do in every project:** `apply`, `pick`, `update` and `status` report an override whose target file or section is not in the composed copies. It shows up in projects without a personal scope too.
- **Forms API:** `POST /api/v1/forms` returns `modes: ["project", "personal"]` and takes `mode: "personal"` for the personal form.
- **Child stacks:** a folder inside a stack folder with its own guideline files is a child stack (`rules/browser/browseros-neo/`, stack `browser/browseros-neo`, block key `rules/browser/browseros-neo`, project folder `.ruler/browser/browseros-neo/`). Only the files directly in a folder belong to that stack. A parent may hold only child stacks. A child stack folder whose name has a `.` and no `__` is read as a file, so it is not a stack and shows in the `Ignored` section of `guideline list` (top-level stacks such as `rules/next.js` are not affected).
- **`when` for stacks:** a stack's `README.md` frontmatter takes a one-line `when`, the work that needs the stack. `guideline list` shows it after the stack name, the form and the web show it, and agents that recommend blocks read it. Block settings on the web edit it.
- **Stack-level pick form:** `guideline pick` chooses whole stacks, shown as a tree. Checking a child stack checks its ancestors (marked "Ancestor"), checking a parent does not check its children, unchecking an ancestor unchecks its descendants, and unchecking a child unchecks the ancestors that were checked only because of it (unless you checked them, another chosen child is under them, or another chosen block `requires` them).
- **Admin web:** a stack page lists its child stacks and has **+ Add child stack**; child stacks have their own pages (`/s/<parent>/<child>`) and settings. The home cards show top-level stacks. Renaming a stack changes only its last name part, and its child stacks and the `requires` keys into it change with it. Moving a stack under another parent is not done on the web; use `guideline source` and `propose --from`.
- **Override tables:** a cell's overridden side is `<stack path>/<file>`. A row that points at a descendant of the overriding stack gets a warning in `guideline list`.
- `/llms.txt`, the authoring rules and the `guideline-sync` skill describe child stacks; the sync skill reads each child stack's `when` when it recommends blocks.
- **⚠️ Servers already running**: the authoring rules and the `guideline-sync` and `guideline-export` skills are seeds written only when a server first starts. On an existing server, add the "Child stacks" section and the new places of received copies to the authoring rules, and update the `guideline-sync` and `guideline-export` skills on the web, including the personal scope rows of `guideline-sync` (above all `setup-personal`, so agents do not change committed files for a personal stack) (see [Upgrade the server and the CLI](docs/manual/en/how-to/upgrade.md#update-the-seed-on-a-running-server)). `llms.txt` is rebuilt per request and changes right away. Redeploy the server together with the CLI: the pick form's `/static/selection.js` changed. Also fix the `ruler` stack of your source, which still describes `.ruler/` as the source and `prepare` as `ruler apply` (see [Move projects to the `.guideline/` layout](docs/manual/en/how-to/upgrade.md#move-projects-to-the-guideline-layout)).

### Changed

- **Breaking: the project layout.** Received guidelines are copies in `.guideline/`, exactly as in the source (`.guideline/rules/<stack>/`, `skills/`, `agents/`, `mcp/`), instead of in `.ruler/<stack>/` and `docs/guideline/`. Overrides move to `.guideline/overrides/<stack path>/` (`override.md`, `override.d/*.md`). Commit `.guideline/`, `guideline.json`, `guideline-lock.json`, `.ruler/ruler.project.toml` and `.gitignore`.
- **Breaking: generated files are git-ignored.** `.ruler/<stack>/`, `.ruler/guideline.md`, `.ruler/skills/`, `.ruler/agents/`, `.ruler/ruler.toml` and `docs/guideline/` are generated by `guideline apply` and listed in a block of `.gitignore`. Edits there are overwritten. A fresh clone or a new worktree has none of them, so run `guideline apply` (or let `prepare` do it).
- **Breaking: `.ruler/ruler.project.toml`.** The ruler settings of the project (agents, `nested`, `output_path`, MCP servers you wrote yourself) move there; the committed `.ruler/ruler.toml` becomes generated from it plus the received MCP servers. `nested = true` for a monorepo goes in the git root's `ruler.project.toml`. A received MCP table you changed stays in `ruler.project.toml`; `status` shows the MCP as current and reports the `mcp-conflict` to-do.
- **Breaking: the lock is version 3.** An older CLI cannot read it ("version is not 1 or 2"), so upgrade the CLI of everyone who shares the project. A lock version this CLI does not know now says to update the CLI.
- **Moving existing projects.** `pick` and `update` move a project of the old layout: copies to `.guideline/` with the project's edits kept, overrides to `.guideline/overrides/`, `ruler.toml` to `ruler.project.toml`, old copies out of the git index (`git rm --cached`), and `prepare` from `ruler apply` to `guideline apply` when `guideline-manage` is a dependency and `ruler apply` has no arguments (otherwise a `dev-dependency` or `prepare-manual` to-do, repeated by `status` and `update` until it is fixed: until then `prepare` in a clone runs only ruler and writes an `AGENTS.md` without the guidelines; without a `package.json`, an `apply-hook` to-do). The move lists the files it wrote and runs ruler, also when nothing else is received or the pick form is cancelled. Pulling the move commit deletes the old generated files from a teammate's working tree: run `guideline apply` right away, not `ruler apply` alone. Until the move, `status`, `propose` and `apply` stop with exit code 2 ("This project still uses the old layout"). See [Upgrade the server and the CLI](docs/manual/en/how-to/upgrade.md#move-projects-to-the-guideline-layout).
- **To-dos that went away:** `mcp-local` (an MCP copy is proposed like any other copy from `.guideline/mcp/<name>/server.json`) and `moved` (a copy has one place).
- A broken file in `.guideline/` that cannot be composed is reported as a `blocked` to-do that names its path in `.guideline/`. The `mcp-conflict` to-do says how to send a changed received MCP table upstream.
- The pick form compares only the copies in `.guideline/`. A hand-made `.claude/skills/<name>` or `.mcp.json` entry with the name of a received skill or MCP server is no longer shown as different and is overwritten by ruler.
- **Breaking: `guideline.json` version 3.** `items` are block keys (`rules/<stack path>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>`), not file paths, and a child stack is listed with its ancestors. Versions 1 and 2 are still read and are rewritten as version 3 when `pick` or `update` writes them. An older CLI cannot read version 3 ("version is not 1 or 2"), so upgrade the CLI of everyone who shares the project.
- **Breaking: the pick form needs CLI and server 0.24 or later.** The form API refuses a request without `formVersion: 2` with 426 "update the guideline CLI to 0.24.0 or newer". A 0.24 CLI that meets an older server cancels that source's form ("This server is older than the CLI"), leaves the source as it was, and exits with 1 when no source was picked. `update`, `status` and `propose` need no server upgrade.
- **Breaking: no `new-file` to-do.** Picking stacks takes every file of a stack, so `guideline update` and `guideline status` no longer report new files in a chosen stack, and `status` no longer prints "New files in chosen stacks". A file the source removes from a chosen stack shows as `upstream` in `status` (`both` when the project also edited it) and `update` deletes it; an edited copy is kept with a `leftover` to-do.
- In the pick form, a guideline file (`NN-*.md`) in a sub-folder of `.ruler/<stack>/` that is not in the source now shows as removed from source. Keep project-only rules in `override.md` or `override.d/`, not inside a stack folder.

## 0.23.0

- **Proposal contents in the API:** `GET /api/v1/proposals/<number>?diff=1` adds `diff` to each change, a unified diff from the base content to the proposed content (labels `base` and `proposal`; `null` when either side is not text), the same diff the web proposal page shows. `?content=1` adds the content in the upload format (`text`, `base64` or `delete: true`). Both can be combined; without them the response is unchanged. Who can see a proposal is unchanged: issued tokens see their own, the admin token and `admin` scope tokens see all.
- **`guideline proposals [number]`:** lists the server's proposals (`--status pending|accepted|rejected`), or shows one with whether it is Outdated, its conflicting paths and each file's diff. `--json` prints the server's response. Accept and reject stay on the web and the API.
- **Mixed versions**: on an older server, `guideline proposals <number>` says the server cannot send diffs and shows only the file list.
- `/llms.txt` documents the proposal detail API and `guideline proposals`.

## 0.22.0

- **opencode is a default agent:** the `guideline pick --new` form offers opencode next to claude and codex, checked by default, and `agents` in `guideline.json` accepts `opencode`.
- **Admin web:** on a block page, the file tree moved from the right side to beside the block list (block list · file tree · document).

## 0.21.0

- **`missing-requires` to-do:** `guideline update` and `guideline status` report a to-do for each received block that needs (`requires`) blocks the project has not received. `data.missing` lists the missing block keys. With several sources, each source is judged by its own `requires` and its own blocks, before aliases.
- `/llms.txt` documents `--source`.
- **⚠️ Servers already running**: the `guideline-sync` skill is a seed written only when a server first starts. On an existing server, add `status` to the first line of its "Handling to-dos" section and add the `missing-requires` row on the web (see the language pack's `templates/skills/guideline-sync/SKILL.md`). `llms.txt` is rebuilt per request and changes right away.

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
