---
name: guideline-sync
description: Picks the guidelines on the guideline server that fit this project and applies them, brings them up to date, and handles the to-dos the CLI leaves behind. Use it for requests like "get the guidelines", "export guidelines", "apply the shared guidelines", "sync guidelines" or "update the guidelines".
---

<!-- The guideline server adds this file as a seed when it first starts. From then on it is managed as source (web edits and proposals). Adapt it to your team. -->

# guideline-sync

**Run this skill in the project that receives the guidelines.** The `guideline` CLI writes the files. Received guidelines are copies in `.guideline/`; `guideline apply` composes the generated agent files (`.ruler/<stack>/`, `.ruler/guideline.md`, `docs/guideline/`, `.ruler/ruler.toml` and so on, listed in `.gitignore`) from them. This skill calls the CLI and handles what the CLI could not do on its own (the to-do list).

## Preconditions

1. Check that `guideline help` works. If not, suggest `npm install -g guideline-manage` and stop.
2. Server address: `server` of the source in this project's `guideline.json`, otherwise the `GUIDELINE_SERVER` environment variable. If neither exists, ask the user and add `--server <URL>` to each command.
3. If you see "Login required", have the user run `! guideline login --server <URL>`. Clicking "Issue" in the browser stores the token.
4. If this directory has no `.ruler/`, commands stop with "Not a ruler project". Say so and stop — moving existing guidelines to ruler is the user's job.
5. In a monorepo subdirectory (one with its own `.ruler/`), commands handle only that directory. Skills, subagents and MCP servers are received at the git root (in subdirectories they show as blocked). The personal form of `pick --local` does not block them in a subdirectory: add them in the git root's personal selection instead.
6. **There may be several sources.** `sources` in `guideline.json` has `server`, `items` and `aliases` for each source (guideline server). Commands handle every source; to handle one, add `--source <name>`. Add a new source with `guideline pick --source <name> --server <URL>`.
7. **If the project was received in the old layout** (copies in `.ruler/<stack>/`), `status`, `propose` and `apply` stop with "This project still uses the old layout" (exit code 2). Run `guideline update --json` once: it moves the project to `.guideline/` (it needs the server, and stops with "Commit or stash your changes first" if tracked files in the directory have uncommitted changes — ask the user to commit first). The user then reviews `git status` and commits.
8. **If it stops with "Name clash"** (exit code 2), two sources gave a stack, skill, subagent or MCP server with the same name. Their contents differ. Show the user the alias from the message (for example `"rules/base": "company-base"`), write the chosen name into `sources.<source>.aliases` in `guideline.json`, and run `guideline pick --source <source>` again.

## What to do

First check the state with `guideline status --json` and report it in one line (items behind, files edited in the project).

| Request | Command |
| --- | --- |
| First time, add or remove items ("export guidelines", "add this stack") | `guideline pick --json` |
| Pick what fits this project ("get the right guidelines", "choose for me") | "Recommend and receive" below |
| Apply the recommendation without the form ("just apply it, no need to review") | "Recommend and receive" step 6 below — only when the user said so |
| Same items, latest version ("update the guidelines") | `guideline update --json` |
| After a fresh clone or in a new worktree, or when `status` says the generated files are out of date | `guideline apply --json` (it needs no server). Do not run `ruler apply` alone before it |
| Change only what this worker receives ("only for me", "without changing the project") | `guideline pick --local --json` — see "Personal scope" below |
| Pick for this worker's own tools ("add what fits how I work") | "Personal scope" step 3 below |
| A different selection per worktree ("frontend stacks in this worktree only", "switch this worktree to the backend role") | "Personal scope" step 6 below |
| New project ("guidelines for a new project") | `guideline pick --new <name or path> --json` |
| Send an edited copy upstream ("share this fix") | show it with `guideline propose --dry-run`, and if it is right, `guideline propose --title "<title>"`. The dry run says what sending will do (`mode` with `--json`). If it is `apply` ("Sending would apply this directly"), tell the user before sending that it will be applied directly, without review, and add `--review` if the user wants a review |

## pick

1. Run `guideline pick --json` **in the background with no time limit**. Tell the user the `Form: <address>` line from stderr — if no browser opened, have them open that address.
2. **Submitting the form is the user's confirmation.** Do not ask again before applying.
3. Exit codes: 0 means applying is done (the JSON on stdout has the written files and to-dos). 3 means the user cancelled or the form expired — nothing was written; stop and say so. 1 or 2: report stderr as is.

## Recommend and receive

1. Read the source with `guideline list --json`. Block keys match the keys of the `categories`, `labels` and `requires` maps: `rules/<stack>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>`. A guideline file's `when` says when to read it, and a child stack's `when` (`stacks[].when` in the JSON; `stacks[].parent` names its parent stack) says which work needs it. Stacks nest: `rules/browser/browseros-neo` is a child stack of `rules/browser`.
2. Look at the project's config files, packages and tools, and choose blocks. **Read each child stack's `when` and choose the child stacks that fit this project**; the form checks a chosen child's ancestor stacks too, so you need not list them. Write each reason from evidence in the project (e.g. "`lefthook.yml` exists"). Leave out blocks with no evidence.
3. Write the recommendation as a JSON file — `{"rules/base": "common to every project", "rules/lefthook": "lefthook.yml exists"}`. Required blocks (`requires`) are checked by the form, so they need not be listed. To also take out blocks the project has, write `{"add": {"<block key>": "<reason>"}, "remove": {"<block key>": "<reason>"}}` (a plain object is add); removing a stack also removes its child stacks. A server older than 0.26 opens the form with only the additions checked.
4. Run `guideline pick --recommend <file> --json` in the background, as in "pick". The form opens with the recommendations checked. Tell the user to review it and submit — **submitting the form is the confirmation.** If the form shows no "Agent pick" marks, the server is older than 0.19 — tell the user and have them choose in the form directly.
5. With several sources, add `--source <name>` and do one source at a time (that is what exit code 2 means here). A key not in the source stops with exit code 2 naming the key — read the list again and fix it. So does a removal of a Required block or a stack that holds one, and a key both added and removed.
6. **Without the form (`--yes`).** Add `--yes` only when the user said to apply without the form, or asked in the same request for no review: `guideline pick --recommend <file> --yes --json`. Otherwise always open the form. `--yes` applies exactly what the form would have opened with checked — the project's current blocks, plus the additions and the blocks they need, minus the removals — and prints the same result as a submitted form. It keeps files edited in the project (`skipped` and `leftover` to-dos, as `update` does) and files in `.guideline/` that the source does not have. It stops with exit code 2, writing nothing, when the working tree has uncommitted changes or the project is not in a git repository: ask the user to commit first, or open the form. It does not work with `--new`.

## Personal scope

1. `guideline pick --local` changes only what this worker receives in this unit: blocks added to or removed from the project's choice. The personal selection is stored in git's common directory (`<git common dir>/guideline/units/<unit key>/local.json`), shared by every worktree of the clone and never committed. `guideline.json`, `guideline-lock.json`, `.guideline/` and `.gitignore` stay as they are; generated files that come only from the personal scope are listed in git's `info/exclude`. It needs a git repository (exit code 2 otherwise) and a server that knows the personal form (exit code 1 "This server does not know the personal form").
2. Run `guideline pick --local --json` in the background, as in "pick". **Submitting the form is the user's confirmation.** Exit code 3 means it was cancelled and nothing was written.
3. To recommend, read `guideline list --json` as in "Recommend and receive", but judge from this worker's work and tools, not from the project's files. A stack whose `when` names a tool ("work that uses <tool>") fits a worker who uses that tool. Ask the user when you cannot see what they use. Write the recommendation as `{"add": {"<block key>": "<reason>"}, "remove": {"<block key>": "<reason>"}}` (a plain `{"<block key>": "<reason>"}` means add) and run `guideline pick --local --recommend <file> --json`. The form opens with them checked and marked. A key not in the source, or a removal of a Required block or a stack that holds one, stops with exit code 2 before the form opens. As in "Recommend and receive" step 6, add `--yes` only when the user said to apply without the form: it saves what the form would have opened with checked (never as machine defaults). It also works with `--role <name>`.
4. **Required** blocks (`sources.<name>.required` in `guideline.json`, marked in the project's pick form) and the stacks above them cannot be removed personally.
5. `pick --local` receives the personal copies at the revision in the project's lock; `guideline update` brings the project and the personal copies up to date together.
6. **Personal roles.** A worktree can use one role: a named layer of additions and removals on top of the common personal selection. Define or change a role with `guideline pick --local --role <name> --json` (a lowercase name of letters, digits and `-`; the role is created when it does not exist, and its form's project column reads "project + my common selection get it"). That does not switch the worktree to the role: run `guideline role use <name> --json`, which writes the role to `<git dir>/guideline/role` (this worktree only) and applies from the git root. `guideline role use --none --json` clears it, and `guideline role --json` shows the role and the roles each unit defines. If `role use` says part of applying failed, the role stays: fix the cause, then run `guideline apply --json`. A role that removes only a block below a stack the common selection received keeps that stack; remove the stack itself to drop it.

## Handling to-dos

Handle the `todos` in the JSON from `pick`, `update`, `status` or `apply` one by one.
A to-do with `scope: "personal"` comes from the personal copies: `setup-personal`, `removed-upstream`, and other kinds whose message starts with "Personal copy —". Handle it like the same kind, but do not change committed files for it; tell the user about a step that would.

| kind | What to do |
| --- | --- |
| `mcp-build` | `data.text` is the source `mcp/<name>/README.md`. Following its `## Build on apply` section (shown in `guideline list` as "built from README when applied"), read this project's values and build the entry. Before writing, show the entry and where each value came from, and get confirmation. If what you read contains user info or a token (`https://<user>:<token>@…`), do not copy the original — write only the extracted value. The place is `[mcp_servers.<name>]` in `.ruler/ruler.project.toml` (`[agents.<agent>.mcp_servers.<name>]` when the server differs per agent); `.ruler/ruler.toml` is regenerated by `guideline apply`. Do not touch other servers, keys or formatting |
| `env` | Tell the user which environment variables to set (`data.vars`) and how to obtain them per the README |
| `setup` | Read `docs/guideline/<stack>/SETUP.md`, check with `## Check` whether it is already done, and if not, go through `## Setup` with the user. Do not skip it because the project does not use that technology yet — picking the stack is the decision to bring it in, and the setup is the step that does. Tell the user about any step you cannot do instead of skipping it |
| `conflict` | A file or entry with the same name already exists and differs from the source. Show the diff and let the user choose |
| `skipped` | Skipped because the project edited the file. Ask whether to send it upstream (`guideline propose`) or overwrite it (`guideline update --force`) |
| `override` | An override section points at a file or section the source does not have. Fix the first line of the override section |
| `subagents-off` | The subagent has a copy in `.guideline/` but was not composed. Ask whether to turn on `[agents] enabled = true` in `.ruler/ruler.project.toml` (it adds generated files to `.gitignore`), then run `guideline apply` |
| `ruler-apply` | Ask whether you may run the suggested command |
| `apply` | The generated agent files are out of date (from `status`, or after a move that could not write them). Run `guideline apply`; run it before committing, or `git add -A` puts the old copies back |
| `root-apply` | A monorepo unit's `apply` did not run ruler because the git root has no `.ruler/ruler.toml` yet. Run `guideline apply` at the git root first (or put `.ruler/ruler.toml` with `nested = true` there yourself), then run it in the unit again |
| `unit-update` | `guideline apply`, `update`, `pick` or `pick --local` at the git root (they all compose the units below it) found a unit still in the old layout and did not compose it. Run `guideline update` in that unit (it needs the server) |
| `unit-problem` | `guideline apply`, `update`, `pick` or `pick --local` at the git root could not open a unit below it (the reason follows). Fix it, or run `guideline apply` in that unit to see the error |
| `unit-write-failed` | `guideline apply`, `update`, `pick` or `pick --local` at the git root could not write all the generated files of a unit below it (the error names the unit). ruler still ran, so do not trust that unit's `AGENTS.md` and other agent files. Fix the cause in the message, then run `guideline apply` at the git root again |
| `root-ruler-toml` | The git root is not a guideline project and has no `.ruler/ruler.toml`, so `apply` composed the units but did not run ruler. Ask the user to put a `.ruler/ruler.toml` with `nested = true` there and commit it, then run `guideline apply` again |
| `removed-upstream` | Tell the user, and suggest `guideline pick` to remove it. With `scope: "personal"` it is a block added personally: suggest `guideline pick --local` |
| `setup-personal` | A stack received only in the personal scope has a setup doc. Read `docs/guideline/<stack>/SETUP.md` and go through it as for `setup`, **but do not change committed files** (`package.json`, committed config files, `.gitignore`, `.ruler/ruler.project.toml` and so on): the personal scope must leave the project as it is. Do the steps that stay outside them (the worker's machine, untracked files). Do not do a step that would change a committed file, and do not skip it silently: tell the user what it would change |
| `personal-ignored` | The project now marks a block Required that this worker removed personally, so the removal is ignored and the block is received. Tell the user; the removal can be cleaned up with `guideline pick --local` |
| `personal-shadowed` | A personal addition has the same final name as a block the project picked from another source, so the project's copy is used and the personal one is not. From `pick --local` it was not saved. From the other commands, suggest cleaning it up with `guideline pick --local` |
| `personal-revision` | The personal copies and the project's copies are at different revisions of a source (another worktree ran `update`, for example), so overrides may point at sections that differ. Run `guideline update` to align them |
| `personal-sync` | The personal copies could not be updated: a write error, or a personal lock that cannot be read (delete the file the message names). The project itself was applied. Fix it and run `guideline update` again |
| `local-bad` | The personal selection (`local.json`) cannot be read, so the files were composed from the project's choice only. Show the message; the user fixes or deletes that file (deleting drops the personal selection), then run `guideline apply` |
| `role-missing` | This worktree's role is defined in no unit, so only the common personal selection was used. Ask the user whether to define it (`guideline pick --local --role <name> --json`) or clear it (`guideline role use --none --json`) |
| `role-bad` | The worktree's role file does not hold a valid role name, so the worktree was composed without a role. Ask the user which role to use, then run `guideline role use <name> --json` or `guideline role use --none --json` |
| `ruler-leftover` | Something ruler made or changed only for the worker's personal choice was left alone: a settings file or folder (`.mcp.json`, `.claude/skills`, `.cursor/mcp.json`, `.mcp.json.bak` …) that still holds something added by hand, is tracked, belongs to an agent other than claude, codex and opencode, or is the backup of such another agent's settings or of a settings file put there by hand — or an MCP server dropped from the composed choice is still in such another agent's settings. Show it to the user; do not delete it yourself |
| `override-target` | An override points at a file or section that is not in the composed copies (the project's copies plus the personal ones). Fix the override's first line, or run `guideline update` if the revisions differ (`personal-revision`). Any project can get it, with or without a personal scope |
| `missing-requires` | A received block (`item`) needs blocks that were not received (`data.missing`, source keys). Tell the user which blocks are missing, write a recommendation file with them (`{"<missing block>": "needed by <item>"}`) and run `guideline pick --recommend <file> --json` as in "Recommend and receive" — submitting the form is the confirmation. With several sources (`item` starts with `<source>:`), add `--source <source>` |
| `blocked` | Not applied because of a source warning, or a file in `.guideline/` could not be composed (the message gives its path). The copy stays as it is. Report that the source (or that file) should be fixed |
| `no-copy` | A chosen item has no copy in `.guideline/` (blocked, or an MCP entry to build), so it was not composed. Run `guideline update` to see why |
| `override-unchosen` | `.guideline/overrides/<stack>/` belongs to a stack that is not chosen, so it was not composed. Ask whether to pick the stack or delete the override |
| `leftover` | Unchecked in the form (or dropped from a chosen stack by the source), but the copy differs from the source, so it was not deleted. Show the diff and ask whether to delete it |
| `nested-off` | Ask whether to turn on `nested = true` in `.ruler/ruler.project.toml` at the git root. Otherwise ruler does not build this directory's guidelines |
| `mcp-conflict` | A received MCP table was not added to `.ruler/ruler.toml`: the project's `ruler.project.toml` already has a table with that name (the project's own is kept), or the TOML shape clashes. Show the table and let the user resolve it. If the project changed a received MCP table, edit `.guideline/mcp/<name>/server.json` and send it with `guideline propose` (the `guideline-export` skill); the changed table stays in `ruler.project.toml`; `status` shows the MCP as current but repeats this to-do |
| `untracked` | A file is now generated but git still tracks it, or the CLI removed it from the git index (`git rm --cached`, the file stays on disk), or it could not ask git and gives a command. Show the command and run it only with the user's go-ahead. Tell the user to check `git status` and commit |
| `stray-ruler-output` | ruler ran without `.ruler/ruler.toml` (usually `ruler apply` right after a clone) and wrote a file for every agent. The CLI deleted `CLAUDE.md` because it carries ruler's marker, or kept it because it has none or because the settings do not tell (a `default_agents` list over several lines). Tell the user; if it was kept, check whether it hides `AGENTS.md` from Claude Code and ask before deleting it. Only `CLAUDE.md` is checked, so other agents' files ruler wrote may remain |
| `migrated` | The project moved to the new layout. Tell the user what moved, and that they should review `git status` and commit. Handle the other to-dos |
| `manifest-v3` | `guideline.json` was rewritten as version 3 (whole stacks), so the rest of each chosen stack's files were added. Tell the user, and commit `guideline.json` with the rest |
| `prepare` | `prepare` in `package.json` now runs `guideline apply` instead of `ruler apply`. Show the change; the user reviews and commits it |
| `dev-dependency` | `guideline-manage` is not in this project's dependencies, so `prepare` was left alone: until it is, `prepare` in a clone runs only ruler and writes an `AGENTS.md` without the guidelines. Run the command shown (add it as a dev dependency), then `guideline apply`, which changes `prepare`. `status` and `update` repeat it until it is fixed |
| `prepare-manual` | `prepare` in `package.json` runs `ruler apply` with arguments, which `guideline apply` does not take, so it was left alone. Show it; the user changes it to `guideline apply` by hand (ruler settings go in `.ruler/ruler.project.toml`). `status` and `update` repeat it until it is fixed |
| `apply-hook` | There is no `package.json`, so nothing composes agent files after a clone. Add `guideline apply` to the project's setup step (for Orca, `scripts.setup` in `orca.yaml`) |
| `adopted` | A copy `propose` left out. It already differed from the source when first received — if it is an old version, proposing it would undo source changes. Show the diff, and propose it with `guideline propose --only <item>` only when the project really edited it. If it is an old version, suggest matching it with `guideline update --force` |
| `alias` | An alias problem. For "the stack moved", suggest moving that place's override files to the new place (`.guideline/overrides/<new name>/`). For "no such unit in the source" or "the same alias is given to two units", fix `aliases` in `guideline.json` |

## Where to stop

Do not commit. Report the changed files, the to-dos you handled and the ones left. The generated files are not committed (they are in `.gitignore`); `.guideline/`, `guideline.json`, `guideline-lock.json` and `.ruler/ruler.project.toml` are. If you applied MCP servers, also mention that Codex reads `.codex/config.toml` only in trusted projects.

## Rules

- **Do not edit the copies in `.guideline/` directly** (everything there except `overrides/`), and do not edit the generated files (`.ruler/<stack>/`, `.ruler/guideline.md`, `docs/guideline/`, `.ruler/ruler.toml`): the CLI writes them, and the next `guideline apply` overwrites generated files. Settings of ruler go in `.ruler/ruler.project.toml`.
- Write anything that should differ for this project only as an override (the management guideline gives the place and format). Do not put project files inside a received stack folder (`.guideline/rules/<stack>/`, sub-folders included): they show up as "removed from source".
- **Do not edit the personal copies** in git's common directory (`<git common dir>/guideline/units/<unit key>/.guideline/`): `guideline update` overwrites them and `guideline propose` does not send them. To change what this worker receives, use `guideline pick --local`.
- **Do not write secrets into project files.** Even if the user tells you a value, tell them to keep it in an environment variable.
