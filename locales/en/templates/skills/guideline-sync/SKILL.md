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
5. In a monorepo subdirectory (one with its own `.ruler/`), commands handle only that directory. Skills, subagents and MCP servers are received at the git root (in subdirectories they show as blocked).
6. **There may be several sources.** `sources` in `guideline.json` has `server`, `items` and `aliases` for each source (guideline server). Commands handle every source; to handle one, add `--source <name>`. Add a new source with `guideline pick --source <name> --server <URL>`.
7. **If the project was received in the old layout** (copies in `.ruler/<stack>/`), `status`, `propose` and `apply` stop with "This project still uses the old layout" (exit code 2). Run `guideline update --json` once: it moves the project to `.guideline/` (it needs the server, and stops with "Commit or stash your changes first" if tracked files in the directory have uncommitted changes — ask the user to commit first). The user then reviews `git status` and commits.
8. **If it stops with "Name clash"** (exit code 2), two sources gave a stack, skill, subagent or MCP server with the same name. Their contents differ. Show the user the alias from the message (for example `"rules/base": "company-base"`), write the chosen name into `sources.<source>.aliases` in `guideline.json`, and run `guideline pick --source <source>` again.

## What to do

First check the state with `guideline status --json` and report it in one line (items behind, files edited in the project).

| Request | Command |
| --- | --- |
| First time, add or remove items ("export guidelines", "add this stack") | `guideline pick --json` |
| Pick what fits this project ("get the right guidelines", "choose for me") | "Recommend and receive" below |
| Same items, latest version ("update the guidelines") | `guideline update --json` |
| After a fresh clone or in a new worktree, or when `status` says the generated files are out of date | `guideline apply --json` (it needs no server). Do not run `ruler apply` alone before it |
| New project ("guidelines for a new project") | `guideline pick --new <name or path> --json` |
| Send an edited copy upstream ("share this fix") | show it with `guideline propose --dry-run`, and if it is right, `guideline propose --title "<title>"`. The dry run says what sending will do (`mode` with `--json`). If it is `apply` ("Sending would apply this directly"), tell the user before sending that it will be applied directly, without review, and add `--review` if the user wants a review |

## pick

1. Run `guideline pick --json` **in the background with no time limit**. Tell the user the `Form: <address>` line from stderr — if no browser opened, have them open that address.
2. **Submitting the form is the user's confirmation.** Do not ask again before applying.
3. Exit codes: 0 means applying is done (the JSON on stdout has the written files and to-dos). 3 means the user cancelled or the form expired — nothing was written; stop and say so. 1 or 2: report stderr as is.

## Recommend and receive

1. Read the source with `guideline list --json`. Block keys match the keys of the `categories`, `labels` and `requires` maps: `rules/<stack>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>`. A guideline file's `when` says when to read it, and a child stack's `when` (`stacks[].when` in the JSON; `stacks[].parent` names its parent stack) says which work needs it. Stacks nest: `rules/browser/browseros-neo` is a child stack of `rules/browser`.
2. Look at the project's config files, packages and tools, and choose blocks. **Read each child stack's `when` and choose the child stacks that fit this project**; the form checks a chosen child's ancestor stacks too, so you need not list them. Write each reason from evidence in the project (e.g. "`lefthook.yml` exists"). Leave out blocks with no evidence.
3. Write the recommendation as a JSON file — `{"rules/base": "common to every project", "rules/lefthook": "lefthook.yml exists"}`. Required blocks (`requires`) are checked by the form, so they need not be listed.
4. Run `guideline pick --recommend <file> --json` in the background, as in "pick". The form opens with the recommendations checked. Tell the user to review it and submit — **submitting the form is the confirmation.** If the form shows no "Agent pick" marks, the server is older than 0.19 — tell the user and have them choose in the form directly.
5. With several sources, add `--source <name>` and do one source at a time (that is what exit code 2 means here). A key not in the source stops with exit code 2 naming the key — read the list again and fix it.

## Handling to-dos

Handle the `todos` in the JSON from `pick`, `update`, `status` or `apply` one by one.

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
| `unit-update` | `guideline apply` at the git root found a unit below it still in the old layout and did not compose it. Run `guideline update` in that unit (it needs the server) |
| `unit-problem` | `guideline apply` at the git root could not open a unit below it (the reason follows). Fix it, or run `guideline apply` in that unit to see the error |
| `root-ruler-toml` | The git root is not a guideline project and has no `.ruler/ruler.toml`, so `apply` composed the units but did not run ruler. Ask the user to put a `.ruler/ruler.toml` with `nested = true` there and commit it, then run `guideline apply` again |
| `removed-upstream` | Tell the user, and suggest `guideline pick` to remove it |
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
- **Do not write secrets into project files.** Even if the user tells you a value, tell them to keep it in an environment variable.
