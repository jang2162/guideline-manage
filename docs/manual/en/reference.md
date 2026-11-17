**English** | [한국어](../ko/reference.md)

# Reference

This page lists the `guideline` commands, exit codes, the pick form, token scopes, the admin web and the server API.
It is for CLI users, agents and server operators who need exact behavior. Settings are in [Configuration](configuration.md).

## Project commands

Run them in a unit directory, one with `.ruler/`. [Where files go](#where-files-go) lists what they read and write.
Common options: `--project <path>` (default: current directory), `--server <URL>`, `--source <name>` (only that source when there are several), `--json`.

| Command | What it does |
| --- | --- |
| `guideline pick` | Opens the server form and applies the chosen items on submit. `--new <name\|path>` creates a new project (`git init`) and applies. `--no-browser` only prints the address. `--recommend <file\|->` opens the form with blocks an agent chose (JSON `{"block key": "reason"}`) already checked — one source at a time (add `--source` when there are several). Needs a 0.19+ server; an older server opens the form without the recommendations. Picking stacks needs a 0.24+ server (see [Exit codes](#exit-codes)) |
| `guideline update` | Re-applies the chosen items from the latest server revision. Skips files edited in the project; `--force` overwrites them. The first `pick` or `update` with a 0.24 or later CLI moves a project received in the old layout (see [Upgrade the server and the CLI](how-to/upgrade.md#move-projects-to-the-guideline-layout)) |
| `guideline apply` | Composes the generated files from `.guideline/` and `.ruler/ruler.project.toml` without contacting the server, rewrites the `.gitignore` block and runs `ruler apply` at the git root. Use it after a clone, in a new worktree and from `prepare`; `pick` and `update` do the same at their end. It runs ruler even when nothing changed. Options: `--project <path>`, `--json`. Exit code 0 done, 1 could not write, 2 nothing received yet or the project is still in the old layout. Right after a clone it also deletes a `CLAUDE.md` that ruler wrote for every agent (see [Troubleshooting](troubleshooting.md#cli)) |
| `guideline status` | Shows whether the applied guidelines are current and what the project changed, plus the stored token's name and scope (`token` in `--json`; nothing when there is no token or the server is older than 0.20) |
| `guideline propose` | Turns edited copies back into source form and proposes them. With an `admin` scope token it applies them directly instead (no review); `--review` sends a proposal anyway, `--apply` applies explicitly (an error with a non-admin token). Passing both is a usage error (exit code 2). `--dry-run` (also says which of the two sending would do), `--title`, `--message`, `--only <item,…>`, `--from <folder>`. `--json` adds `mode`: `apply` or `proposal` (absent when there is nothing to send). The dry run is the authoritative way to see the mode: it asks with the same token and server the real send uses, while `status` may resolve a different token (several sources, `GUIDELINE_TOKEN`) |
| `guideline login` / `logout` | Logs in to a server and stores a token, or deletes it. `--token-stdin` stores a token without a browser. After saving, `login` prints the token's scope (`read`, `propose` or `admin`) |

### Output and to-dos

`pick` and `update` print the written files, deleted files and **to-dos**; `status` prints to-dos too.
The kinds of to-dos are listed in the "What agents do" table of the server's `/llms.txt`.
The `.guideline/` layout adds these kinds. `apply`, `pick` and `update` print them, and `status` prints `apply`.

| Kind | Meaning |
| --- | --- |
| `apply` | The generated files are out of date (from `status`), or were not written after a move. Run `guideline apply`, before you commit |
| `root-apply` | A monorepo unit's `apply` did not run ruler because the git root has no `.ruler/ruler.toml`. Run `guideline apply` at the git root first, or put `.ruler/ruler.toml` with `nested = true` there yourself |
| `no-copy` | A chosen item has no copy in `.guideline/` (blocked, or an MCP entry to build), so it was not composed. `guideline update` shows why |
| `override-unchosen` | An override in `.guideline/overrides/<stack>/` belongs to a stack that is not chosen. Pick the stack or delete the override |
| `subagents-off` | A subagent copy exists but `.ruler/ruler.project.toml` lacks `[agents] enabled = true`, so it was not composed |
| `mcp-conflict` | A received MCP table was not added to `.ruler/ruler.toml` because `ruler.project.toml` already has a table with that name (the project's own is kept) or the TOML shapes clash. A received MCP table you changed in the project stays in `ruler.project.toml` and `status` shows the MCP as current: to share the change, edit `.guideline/mcp/<name>/server.json` and send it with `guideline propose` |
| `untracked` | A file that is now generated was removed from the git index (`git rm --cached`; the file stays), or the CLI gives you the command because it could not |
| `stray-ruler-output` | ruler ran without `.ruler/ruler.toml` and wrote files for every agent. `CLAUDE.md` with ruler's marker was deleted; one without was kept. Other agents' files are not checked |
| `migrated` | The project moved to the `.guideline/` layout. Review `git status` and commit |
| `manifest-v3` | `guideline.json` was rewritten as version 3 (whole stacks), so the rest of each chosen stack's files were added |
| `prepare` | `prepare` in `package.json` now runs `guideline apply` instead of `ruler apply` |
| `dev-dependency` | `guideline-manage` is not a dependency, so `prepare` was left alone. Add it with the command shown, then run `guideline apply` |
| `apply-hook` | There is no `package.json`: call `guideline apply` from your setup step (Orca: `scripts.setup` in `orca.yaml`) |

Some kinds no longer exist: `mcp-local` (an MCP copy is proposed like any other copy, from `.guideline/mcp/<name>/server.json`), `moved` (a copy has one place) and `new-file`.
A `blocked` to-do for a file that cannot be composed names its path in `.guideline/`.

`update` and `status` report a `missing-requires` to-do for each received block that needs (`requires`) blocks the project has not received.
This happens, for example, when the source gained a new `requires` after the project received the block.
`data.missing` lists the missing block keys; add them with `guideline pick`.
With several sources, each source is judged by its own `requires` and its own blocks, before aliases.

When the source drops a file from a stack you chose, `status` shows it as `upstream` (`both` when the project also edited it) and `update` deletes it.
An edited copy is not deleted: it stays and a `leftover` to-do asks you to check it and delete it or send it upstream.
In the pick form, a file in `.guideline/` that is not in the source (a guideline file, a skill, subagent or MCP folder) shows as removed from source. Keep project-only rules in `.guideline/overrides/` ([Override a guideline in one project](how-to/override-guidelines.md)) or in `.ruler/*.md`.
Only `.guideline/` is compared. Files generated under `.ruler/` and `docs/guideline/`, and hand-made `.claude/skills/<name>` or `.mcp.json` entries, are not.

### Where files go

| Place | Contents | Git |
| --- | --- | --- |
| `.guideline/rules/<stack path>/`, `.guideline/skills/<name>/`, `.guideline/agents/<name>.md`, `.guideline/mcp/<name>/` | Received copies, exactly as in the source | Commit |
| `.guideline/overrides/<stack path>/override.md`, `override.d/*.md` | The project's overrides (`<parent>/<child>` for a child stack) | Commit |
| `.guideline/management/<source>.md` | A source's management additions | Commit |
| `.ruler/ruler.project.toml` | The project's ruler settings and MCP servers it wrote itself | Commit |
| `.ruler/<stack path>/NN-*.md`, `99-reference.md`, `.ruler/guideline.md`, `.ruler/skills/`, `.ruler/agents/`, `.ruler/ruler.toml`, `docs/guideline/` | Generated by `apply`, `pick` and `update` | Not committed: a block in `.gitignore` lists them |

Edit the copies in `.guideline/` (or send them upstream with `guideline propose`); a change in a generated file is overwritten by the next `apply`.
`propose` sends the `.guideline/` copies edited in the project as they are, because they already have the source's form.

### `guideline.json`

`items` of each source are **block keys**: `rules/<stack path>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>` (`"version": 3`).
A child stack is listed together with its ancestor stacks, for example `["rules/browser", "rules/browser/browseros-neo"]`.
An older file (`"version": 1` or `2`, with file paths) is read as before and rewritten as version 3 the next time `pick` or `update` writes it (a `manifest-v3` to-do says so).

## Source commands

| Command | What it does |
| --- | --- |
| `guideline source <folder>` | Unpacks the latest server source into an empty folder. Edit it at source paths, then send it with `propose --from <folder>` |
| `guideline list [folder]` | Lists the source and its checks. With a folder, reads that folder (a source from `source`); otherwise the server |
| `guideline proposals [number]` | Without a number, lists the server's proposals: number, status, title, author, project, date and file count. `--status pending\|accepted\|rejected` filters the list. With a number, shows that proposal: its details, whether it is Outdated and the conflicting paths, and each file's kind and diff against its base. `--json` prints the server's response as is. Also `--server` and `--source`. Issued tokens see only their own proposals; the admin token and an `admin` scope token see all. Accept or reject on the web or through the API |

`list` shows stacks (guideline files with their load, and overrides between stacks), skills, subagents and MCP servers.
A child stack is indented under its parent and shown by its whole path (`browser/browseros-neo`), followed by its `when` from the README frontmatter.
It also shows files left out for breaking the rules (Ignored) and things to fix (warning), each with its reason.
Warnings do not change the exit code (0).
The writing rules are the source's `docs/authoring.md`.

`proposals` with a number that is not a positive integer, an unknown `--status` value, or `--status` together with a number is a usage error (exit code 2).
A proposal the token cannot see is "No such proposal" (exit code 1).
An older server does not send diffs: `proposals <number>` says so and shows only the file list.

## Language pack commands

| Command | What it does |
| --- | --- |
| `guideline locale list` | Available languages (package and user folder) and the current setting |
| `guideline locale check <folder>` | Compares a language pack folder with the canonical `en`: missing keys, extra keys, keys with different placeholders, missing templates, `pack.json` problems |

How to make a language pack: [Add a language pack](how-to/add-a-language-pack.md).

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Failure (server unreachable, no permission, write failure, language pack problems and so on). Also 1 when one source failed and the others were applied. A source whose server is older than 0.24 counts as a failed source (see below) |
| 2 | Usage error, not a ruler project, name clash. Also `apply`, `status` and `propose` in a project still in the old layout, and `apply` before anything was received |
| 3 | `pick`: not submitted (cancelled, tab closed, never opened). Nothing was written |

A server older than 0.24 cannot take stack choices.
`pick` then cancels that source's form, says "This server is older than the CLI" and leaves the source as it was.
The other sources are still picked, and the exit code is 1 because a source failed; with no source picked it is also 1.
Upgrade the server, or use an older CLI.
A 0.24 server refuses a CLI that does not send the stack form's `formVersion` with 426 "update the guideline CLI to 0.24.0 or newer".

## The pick form

`guideline pick` opens this form. Each item shows its state.

| Shown | Meaning | When checked |
| --- | --- | --- |
| same | Already there as in the source | Left as is |
| different | There, but differs from the source | Left as is. Turn on **update** to overwrite it with the source. Check it with **show diff** |
| missing | Not there yet | Added |
| source updated | The source changed after you received it | **update** starts turned on |
| edited in project | The project changed it after receiving it | Left as is. Turn on **overwrite** to revert it to the source |

- **The form chooses whole stacks**, not single files. A stack row has one checkbox that covers all its files; the files under it have no checkboxes of their own.
- **Child stacks form a tree.** A child stack is indented under its parent and shows its `when`, the work that needs it. A parent that holds only child stacks (a bundle stack) is a row of its own.
  - Checking a child stack checks its ancestors too, marked **Ancestor**.
  - Checking a parent does not check its children.
  - Unchecking an ancestor unchecks all its descendants.
  - Unchecking a child also unchecks the ancestors that were checked only because of it, unless you checked them yourself, another chosen child stack is still under them, or another chosen block needs them (`requires`).
- **Unchecking an item that is already there means "remove".** It turns red and the submit button says "includes N removal(s)".
- The form goes in steps: 1. Guidelines → 2. MCP → 3. Subagents → 4. Skills → 5. Review. Select a step tab at any time; submit from **Review** after seeing everything. Steps with nothing to choose are skipped.
- Category buttons (`backend`, `browser` …) filter the items shown. Checks do not change. **All** clears the filter.
- When a block needs another block (`requires`), choosing it checks that block too, marked **Dependency**. You can uncheck it, but a "X is missing — Y needs it" warning stays.
- A domain stack (`<tool>__<domain>`, for example `deploy-package__gitlab.example.com`) shows the tool name with a domain tag. The same tool has different rules on different servers, so pick the stack for the server your project uses.
- When a block has a display name (`label`), that name is the title and the real name sits next to it in small type.
- Items recommended with `--recommend` carry **Agent pick** and a reason.
- With uncommitted changes in the working tree you get a warning, and must check **Proceed anyway** to submit. Commit first, so you can review the result with `git diff`.
- Items with a source warning show as "blocked" and cannot be checked; the reason is shown.
- A form expires if it is not opened within 10 minutes, or after 90 seconds without page signals once opened.

## Token scopes

| Token | Can do |
| --- | --- |
| Admin token (`ADMIN_TOKEN`) | Everything, including web login and token management |
| `read` | View guidelines (needed only when `PUBLIC_READ=0`). `guideline login` issues this scope |
| `propose` | Send proposals and see its own proposals, with their diffs and content |
| `admin` | Apply directly (`apply: true`, `guideline propose`), see every proposal with its diffs and content (`guideline proposals`), accept or reject through the API. It cannot log in to the web or manage tokens |

A revoked token can be deleted from the **Tokens** list.
The row stays hidden in the DB because revisions point to it; its name can be reused.

## Admin web

- **Lists** show stacks, skills, subagents and MCP servers. Lists only add blocks. The home cards show top-level stacks only; child stacks are under their parent.
- **Child stacks**: a stack's page lists its child stacks (and a **+ Add child stack** button for admins). A child stack is a block page of its own, at `/s/<parent>/<child>`, with its `when` shown.
- **Block page**: the block list on the left, then the block's file tree (always ● · reference ○), then the chosen document. New file, upload, rename, delete and download live on the block page; **Download block (.tar.gz)** is in the top button row.
- **Block settings** (`/settings/<kind>/<name>`, admin): save the display name and categories, edit **Required blocks**, set **When it is needed** (`when`, stacks only), add or upload files, rename the block or delete it. Renaming also fixes the `name:` line of subagents and skills and other blocks' `requires`. Renaming a stack changes only its last name part, and its child stacks and the `requires` keys that point into it change with it. Moving a stack under another parent is not done on the web: use `guideline source` and `propose --from`.
- **File edit** shows a warning preview before saving. **New file** uses the language pack's `new-file/` templates.
- **Docs** (`/docs`) is the first kind tab. It shows and creates `docs/<name>.md` documents. The authoring rules (`authoring.md`) and the management additions (`management.md`) are grouped as "Also read by agents" and cannot be renamed or deleted on the web. New documents are not sent to projects.
- **Usage** renders `/llms.txt` with a **Copy link** button. It is open even with `PUBLIC_READ=0`.
- **History** and **Proposals** show 30 per page (`?page=`). Revision and proposal pages show the changed files as a tree (kind → block → file) on the left and one chosen file (`?file=`) in the middle. Diffs longer than 80 lines fold. History pages also revert.
- **Tokens**: issue, revoke and delete tokens.
- **Display name**: `label` in a block's frontmatter. Shown on the web, in the pick form and in `guideline list`.
- **Required blocks**: `requires: [rules/x]` in a block's frontmatter.
- Visitors who are not logged in do not see the editing, proposal and token buttons; they get **Log in** at the top.

## Server API

Tokens go in `Authorization: Bearer <token>`.
Even on a public server, a wrong or revoked token gets 401.

### Read API

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/health` | No authentication. Server version, schema, API level (`api: 2`), latest revision, `publicRead` |
| `GET /api/v1/whoami` | The sent token as `{ kind, name, scope }`. The admin token is `{ kind: "admin", name: null, scope: "admin" }`; an issued token is `{ kind: "token", name, scope }`. No token, or a wrong or revoked one, gets 401 even with `PUBLIC_READ=1` |
| `GET /api/v1/catalog` | Stacks, skills, subagents, MCP servers, their categories, display names (`labels`) and required blocks (`requires`) |
| `GET /api/v1/tree` | The source file tree |
| `GET /api/v1/files/<path>?rev=` | One source file |
| `GET /api/v1/archive?rev=` | The whole source (tar.gz). The CLI uses this |
| `GET /api/v1/revisions`, `GET /api/v1/revisions/<number>` | Revisions |

### Proposals

| Endpoint | Does |
| --- | --- |
| `POST /api/v1/proposals` | Creates a proposal (`propose` scope token). Body `{ title, description?, project?, changes: [{ path, text \| base64 \| delete: true, base: <sha256> \| null }] }`. The admin token or an `admin` scope token can add `apply: true` to apply it right away. Up to 500 changes and 20 MB |
| `GET /api/v1/proposals?status=` | The list (`pending`, `accepted` or `rejected`; all without `status`), newest first. Issued tokens see only their own proposals; the admin token and an `admin` scope token see all |
| `GET /api/v1/proposals/<number>` | One proposal, for checking its status and for reviewing it: details, `outdated`, `conflicts` and `changes: [{ path, kind, base }]`. Issued tokens see only their own proposals (another's is 404); the admin token and an `admin` scope token see all. `?diff=1` adds `diff` to each change: a unified diff from the base content to the proposed content (labels `base` and `proposal`), `null` when either side is not text. `?content=1` adds the content in the upload format: `text` (UTF-8 without NUL), otherwise `base64`, or `delete: true`. The two can be combined; without them the response is unchanged |
| `POST /api/v1/proposals/<number>/accept`, `POST /api/v1/proposals/<number>/reject` | Accepts or rejects (admin token or `admin` scope token). Reject takes an optional body `{ note }`. A conflict is 409 with `conflicts` |

Each proposal holds, per file, the new content (or deletion) and the source hash the proposer saw (`base`).
On accept, if the source is unchanged it is taken as is; if it changed, a line-based 3-way merge combines them.
If any file overlaps, it cannot be accepted (Outdated).
Accepting is one revision (source `proposal`, author = token name, message "proposal #<number>: <title>").

### CLI login and forms

- **CLI login**: `guideline login` opens `/cli/login`. Selecting **Issue** in an admin session sends a single-use, two-minute code to the CLI's `127.0.0.1` callback. The CLI exchanges it at `POST /api/v1/cli/token` for a read token named `cli-<host>-<6 chars>`. `DELETE /api/v1/tokens/self` revokes the sent token (`guideline logout`).
- **Forms**: `POST /api/v1/forms` (2 MB body) creates a form and returns `/forms/<id>?k=<link token>`. A private server needs a read token; a public server lets anyone create a form. The link covers only that form and turns into a cookie (and leaves the address) when first opened. `GET /api/v1/forms/<id>/result?wait=` waits for the result. The request body carries `formVersion: 2` (stack choices); a body without it is refused with 426. A form created with a token returns its result only to that token; a form created without a token, only to the admin or to a request with the link token in the `X-Form-Link` header. Forms finished more than a day ago are deleted when a new form is created.
- **`/llms.txt`**: the usage and setup guide for agents. It opens without login. It is the language pack's `templates/llms.txt`, with `{{SERVER}}` filled from `PUBLIC_URL`, rebuilt per request.

## Markers in guidelines

The tool looks for fixed phrases in human-written guidelines.
These markers are fixed in code, not in language packs, and **both the English and the earlier Korean forms are read whatever the language setting.**
English is canonical.

| Used in | Marker (English, canonical) |
| --- | --- |
| The section in a stack README with the table of overrides of other stacks | `## Overrides of other stacks` |
| A cell in that table | `` `<file>` "<section title>" `` |
| The first line of an override section | ``Overrides: `<stack>/<file>` "<section title>"`` |
| The section in an MCP README that builds the entry | `## Build on apply` |

The Korean forms are listed in the Korean version of this page.

## Next

- [Configuration](configuration.md)
- [Troubleshooting](troubleshooting.md)
