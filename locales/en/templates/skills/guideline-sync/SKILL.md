---
name: guideline-sync
description: Picks the guidelines on the guideline server that fit this project and applies them, brings them up to date, and handles the to-dos the CLI leaves behind. Use it for requests like "get the guidelines", "export guidelines", "apply the shared guidelines", "sync guidelines" or "update the guidelines".
---

<!-- The guideline server adds this file as a seed when it first starts. From then on it is managed as source (web edits and proposals). Adapt it to your team. -->

# guideline-sync

**Run this skill in the project that receives the guidelines.** The `guideline` CLI writes the files. This skill calls the CLI and handles what the CLI could not do on its own (the to-do list).

## Preconditions

1. Check that `guideline help` works. If not, suggest `npm install -g guideline-manage` and stop.
2. Server address: `server` of the source in this project's `guideline.json`, otherwise the `GUIDELINE_SERVER` environment variable. If neither exists, ask the user and add `--server <URL>` to each command.
3. If you see "Login required", have the user run `! guideline login --server <URL>`. Clicking "Issue" in the browser stores the token.
4. If this directory has no `.ruler/`, commands stop with "Not a ruler project". Say so and stop — moving existing guidelines to ruler is the user's job.
5. In a monorepo subdirectory (one with its own `.ruler/`), commands handle only that directory. Skills, subagents and MCP servers are received at the git root (in subdirectories they show as blocked).
6. **There may be several sources.** `sources` in `guideline.json` has `server`, `items` and `aliases` for each source (guideline server). Commands handle every source; to handle one, add `--source <name>`. Add a new source with `guideline pick --source <name> --server <URL>`.
7. **If it stops with "Name clash"** (exit code 2), two sources gave a stack, skill, subagent or MCP server with the same name. Their contents differ. Show the user the alias from the message (for example `"rules/base": "company-base"`), write the chosen name into `sources.<source>.aliases` in `guideline.json`, and run `guideline pick --source <source>` again.

## What to do

First check the state with `guideline status --json` and report it in one line (items behind, files edited in the project, new files).

| Request | Command |
| --- | --- |
| First time, add or remove items ("export guidelines", "add this stack") | `guideline pick --json` |
| Pick what fits this project ("get the right guidelines", "choose for me") | "Recommend and receive" below |
| Same items, latest version ("update the guidelines") | `guideline update --json` |
| New project ("guidelines for a new project") | `guideline pick --new <name or path> --json` |
| Send an edited copy upstream ("share this fix") | show it with `guideline propose --dry-run`, and if it is right, `guideline propose --title "<title>"` |

## pick

1. Run `guideline pick --json` **in the background with no time limit**. Tell the user the `Form: <address>` line from stderr — if no browser opened, have them open that address.
2. **Submitting the form is the user's confirmation.** Do not ask again before applying.
3. Exit codes: 0 means applying is done (the JSON on stdout has the written files and to-dos). 3 means the user cancelled or the form expired — nothing was written; stop and say so. 1 or 2: report stderr as is.

## Recommend and receive

1. Read the source with `guideline list --json`. Block keys match the keys of the `categories`, `labels` and `requires` maps: `rules/<stack>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>`. A guideline file's `when` says when to read it.
2. Look at the project's config files, packages and tools, and choose blocks. Write each reason from evidence in the project (e.g. "`lefthook.yml` exists"). Leave out blocks with no evidence.
3. Write the recommendation as a JSON file — `{"rules/base": "common to every project", "rules/lefthook": "lefthook.yml exists"}`. Required blocks (`requires`) are checked by the form, so they need not be listed.
4. Run `guideline pick --recommend <file> --json` in the background, as in "pick". The form opens with the recommendations checked. Tell the user to review it and submit — **submitting the form is the confirmation.** If the form shows no "Agent pick" marks, the server is older than 0.19 — tell the user and have them choose in the form directly.
5. With several sources, add `--source <name>` and do one source at a time (that is what exit code 2 means here). A key not in the source stops with exit code 2 naming the key — read the list again and fix it.

## Handling to-dos

Handle the `todos` in the JSON from `pick` or `update` one by one.

| kind | What to do |
| --- | --- |
| `mcp-build` | `data.text` is the source `mcp/<name>/README.md`. Following its `## Build on apply` section (shown in `guideline list` as "built from README when applied"), read this project's values and build the entry. Before writing, show the entry and where each value came from, and get confirmation. If what you read contains user info or a token (`https://<user>:<token>@…`), do not copy the original — write only the extracted value. The place is `[mcp_servers.<name>]` in `.ruler/ruler.toml` (`[agents.<agent>.mcp_servers.<name>]` when the server differs per agent). Do not touch other servers, keys or formatting |
| `env` | Tell the user which environment variables to set (`data.vars`) and how to obtain them per the README |
| `setup` | Read `docs/guideline/<stack>/SETUP.md`, check with `## Check` whether it is already done, and if not, go through `## Setup` with the user. Do not skip it because the project does not use that technology yet — picking the stack is the decision to bring it in, and the setup is the step that does. Tell the user about any step you cannot do instead of skipping it |
| `conflict` | A file or entry with the same name already exists and differs from the source. Show the diff and let the user choose |
| `skipped` | Skipped because the project edited the file. Ask whether to send it upstream (`guideline propose`) or overwrite it (`guideline update --force`) |
| `override` | An override section points at a file or section the source does not have. Fix the first line of the override section |
| `subagents-off` | Ask whether to turn on `[agents] enabled = true` in `.ruler/ruler.toml` (it adds generated files to `.gitignore`) |
| `ruler-apply` | Ask whether you may run the suggested command |
| `new-file`, `removed-upstream` | Tell the user, and suggest `guideline pick` to choose or remove it |
| `blocked` | Not applied because of a source warning. The copy stays as it is. Report that the source should be fixed |
| `leftover` | Unchecked in the form, but the copy differs from the source, so it was not deleted. Show the diff and ask whether to delete it |
| `nested-off` | Ask whether to turn on `nested = true` in `.ruler/ruler.toml` at the git root. Otherwise ruler does not build this directory's guidelines |
| `mcp-local` | The project changed an MCP setting. To send it upstream, propose `server.json` with the `guideline-export` skill |
| `adopted` | A copy `propose` left out. It already differed from the source when first received — if it is an old version, proposing it would undo source changes. Show the diff, and propose it with `guideline propose --only <item>` only when the project really edited it. If it is an old version, suggest matching it with `guideline update --force` |
| `alias` | An alias problem. For "the stack moved", suggest moving that place's override files to the new place (`.ruler/<new name>/`). For "no such unit in the source" or "the same alias is given to two units", fix `aliases` in `guideline.json` |

## Where to stop

Do not commit. Report the changed files, the to-dos you handled and the ones left. If you applied MCP servers, also mention that Codex reads `.codex/config.toml` only in trusted projects.

## Rules

- **Do not edit the copies directly.** Files recorded in `guideline-lock.json` and `docs/guideline/` are written only by the CLI.
- Write anything that should differ for this project only as an override (the management guideline gives the place and format).
- **Do not write secrets into project files.** Even if the user tells you a value, tell them to keep it in an environment variable.
