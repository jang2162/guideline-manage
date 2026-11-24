**English** | [한국어](../ko/reference.md)

# Reference

This page lists the `guideline` commands, exit codes, the pick form, token scopes, the admin web and the server API.
It is for CLI users, agents and server operators who need exact behavior. Settings are in [Configuration](configuration.md).

## Project commands

Run them in a unit directory, one with `.ruler/`. [Where files go](#where-files-go) lists what they read and write.
Common options: `--project <path>` (default: current directory), `--server <URL>`, `--source <name>` (only that source when there are several), `--json`.

| Command | What it does |
| --- | --- |
| `guideline pick` | Opens the server form and applies the chosen items on submit. `--new <name\|path>` creates a new project (`git init`) and applies. `--no-browser` only prints the address. `--recommend <file\|->` opens the form with blocks an agent chose (JSON `{"block key": "reason"}`, or `{"add": {…}, "remove": {…}}` to also take blocks out) already checked — one source at a time (add `--source` when there are several). Needs a 0.19+ server; an older server opens the form without the recommendations. Recommended removals are pre-unchecked by a 0.26+ server; an older server shows only the additions. `--yes` (with `--recommend` only) applies the recommendation without the form, see [Applying without the form](#applying-without-the-form). Picking stacks needs a 0.24+ server (see [Exit codes](#exit-codes)) |
| `guideline pick --local` | Opens the personal form and changes only what you receive in this unit: blocks added to or removed from the project's choice ([personal scope](#personal-scope)). Writes nothing that is committed. `--recommend <file\|->` takes `{"add": {"block key": "reason"}, "remove": {"block key": "reason"}}` (a plain `{"block key": "reason"}` is add). `--yes` saves what the form would have opened with checked, without the form (also with `--role`; never as machine defaults). Needs a git repository with git 2.31 or later, and a server that knows the personal form. Cannot be combined with `--new` |
| `guideline pick --local --role <name>` | Opens the personal form for a personal role and stores the result as that role's layer in this unit's `local.json` ([personal roles](#personal-roles)). The form's project column shows the project's choice plus your common personal selection. Creates the role when it does not exist. Does not switch this worktree to the role. A name that breaks the naming rule, or `--role` without `--local`, exits with code 2 |
| `guideline update` | Re-applies the chosen items from the latest server revision. Skips files edited in the project; `--force` overwrites them. The first `pick` or `update` with a 0.24 or later CLI moves a project received in the old layout (see [Upgrade the server and the CLI](how-to/upgrade.md#move-projects-to-the-guideline-layout)) |
| `guideline apply` | Composes the generated files from `.guideline/` and `.ruler/ruler.project.toml` without contacting the server, rewrites the `.gitignore` block and runs `ruler apply` at the git root. Use it after a clone, in a new worktree and from `prepare`. `pick`, `pick --local` and `update` compose the same way at their end (at the git root, the units below it too) but run ruler only when they wrote something; `apply` runs ruler even when nothing changed. Options: `--project <path>`, `--json`. Exit code 0 done, 1 could not write, 2 nothing received yet or the project is still in the old layout. Right after a clone it also deletes a `CLAUDE.md` that ruler wrote for every agent (see [Troubleshooting](troubleshooting.md#cli)). At the git root of a monorepo it also composes every unit below it that git tracks, then runs ruler once; this works when the root is not a guideline project too ([monorepos](how-to/use-in-a-monorepo.md)) |
| `guideline status` | Shows whether the applied guidelines are current and what the project changed, plus the stored token's name and scope (`token` in `--json`; nothing when there is no token or the server is older than 0.20). With a personal scope it adds "Personal scope — added …" and "Personal scope — removed …" lines and the personal copies that are not current (`personal` in `--json`, see [Personal scope](#personal-scope)). With a role it adds "Role — …" and "Role <name> — added …", "removed …" lines |
| `guideline role` | Prints this worktree's personal role and the roles each unit defines. `--json`: `{ role, bad, units: [{ unit, roles }] }` (the git root unit is `.`; `role` is `null` without a role, `bad` is `true` when the role file is broken). See [Personal roles](#personal-roles) |
| `guideline role use <name>` / `use --none` | Sets or clears this worktree's role, then applies from the git root like `guideline apply` there. The role must be defined in at least one unit (exit code 2 otherwise) |
| `guideline role remove <name>` | Deletes the role's definition from this unit's `local.json` without applying. `--json`: `{ removed, todos }`. Exit code 2 when this unit does not define it, when `local.json` cannot be read, or when the folder is not a guideline unit |
| `guideline propose` | Turns edited copies back into source form and proposes them. With an `admin` scope token it applies them directly instead (no review); `--review` sends a proposal anyway, `--apply` applies explicitly (an error with a non-admin token). Passing both is a usage error (exit code 2). `--dry-run` (also says which of the two sending would do), `--title`, `--message`, `--only <item,…>`, `--from <folder>`. `--json` adds `mode`: `apply` or `proposal` (absent when there is nothing to send). The dry run is the authoritative way to see the mode: it asks with the same token and server the real send uses, while `status` may resolve a different token (several sources, `GUIDELINE_TOKEN`) |
| `guideline login` / `logout` | Logs in to a server and stores a token, or deletes it. `--token-stdin` stores a token without a browser. After saving, `login` prints the token's scope (`read`, `propose` or `admin`) |

### Applying without the form

`guideline pick --recommend <file|-> --yes` applies the recommendation without creating a form or opening a browser. Use it only when nobody needs to review the choice.

- It applies what the form would have opened with checked: the source's blocks in `guideline.json`, plus the recommended additions, the blocks they need (`requires`) and their ancestor stacks, minus the recommended removals. Removing a stack also removes its chosen child stacks, and the ancestors and dependencies that were checked only because of it, as unchecking it in the form does.
- Required blocks stay Required. Recommending the removal of a Required block, or a stack that holds one, exits with code 2. So does a key both added and removed, and a key not in the source.
- Agents stay as they are.
- Files edited in the project are not overwritten: they are skipped with a `skipped` to-do, as `guideline update` does without `--force`. A removed block whose copy was edited keeps that copy, with a `leftover` to-do. Files in `.guideline/` that the source does not have stay. Blocked items stay blocked.
- It refuses, with exit code 2 and nothing written, when the working tree has uncommitted changes or the project is not in a git repository (the form asks **Proceed anyway** then). Commit first.
- It prints the same report as a submitted pick, `--json` too, and exits with the same codes. It needs no server upgrade.
- `--yes` without `--recommend`, and `--yes` with `--new`, exit with code 2.
- With `--local` (and `--role`), it saves what the personal form would have opened with checked: your current personal selection (or that server's machine defaults when you have none) with the recommendation on top. It never saves machine defaults and needs no clean working tree, because it writes nothing that is committed.

### Output and to-dos

`pick` and `update` print the written files, deleted files and **to-dos**; `status` prints to-dos too.
The kinds of to-dos are listed in the "What agents do" table of the server's `/llms.txt`.
The `.guideline/` layout adds these kinds. `apply`, `pick` and `update` print them. `status` prints `apply`, `dev-dependency`, `prepare-manual`, `no-copy`, `override-unchosen`, `mcp-conflict` and `blocked`, so they stay visible until they are fixed.

| Kind | Meaning |
| --- | --- |
| `apply` | The generated files are out of date (from `status`), or were not written after a move. Run `guideline apply`, before you commit |
| `root-apply` | A monorepo unit's `apply` did not run ruler because the git root has no `.ruler/ruler.toml`. Run `guideline apply` at the git root first, or put `.ruler/ruler.toml` with `nested = true` there yourself |
| `unit-update` | `guideline apply`, `update`, `pick` or `pick --local` at the git root skipped a unit below it that is still in the old layout. Run `guideline update` in that unit |
| `unit-problem` | `guideline apply`, `update`, `pick` or `pick --local` at the git root could not open a unit below it; the reason follows |
| `unit-write-failed` | `guideline apply`, `update`, `pick` or `pick --local` at the git root could not write all the generated files of a unit below it (the error names the unit). ruler still ran, so do not trust that unit's `AGENTS.md` and other agent files. Fix the cause, then run `guideline apply` at the git root again. Exit code 1 |
| `root-ruler-toml` | The git root is not a guideline project and has no `.ruler/ruler.toml`, so `apply` composed the units but did not run ruler. Put a `.ruler/ruler.toml` with `nested = true` there and commit it |
| `no-copy` | A chosen item has no copy in `.guideline/` (blocked, or an MCP entry to build), so it was not composed. `guideline update` shows why |
| `override-unchosen` | An override in `.guideline/overrides/<stack>/` belongs to a stack that is not chosen. Pick the stack or delete the override |
| `override-target` | An override points at a file or section that is not in the composed copies (the project's copies, plus the personal ones). Fix the override's first line, or run `guideline update` when the revisions differ. Any project can get it, with or without a personal scope |
| `subagents-off` | A subagent copy exists but `.ruler/ruler.project.toml` lacks `[agents] enabled = true`, so it was not composed |
| `mcp-conflict` | A received MCP table was not added to `.ruler/ruler.toml` because `ruler.project.toml` already has a table with that name (the project's own is kept) or the TOML shapes clash. A received MCP table you changed in the project stays in `ruler.project.toml`; `status` shows the MCP as current and repeats this to-do. To share the change, edit `.guideline/mcp/<name>/server.json` and send it with `guideline propose` |
| `untracked` | A file that is now generated was removed from the git index (`git rm --cached`; the file stays), or the CLI gives you the command because it could not |
| `stray-ruler-output` | ruler ran without `.ruler/ruler.toml` and wrote files for every agent. `CLAUDE.md` with ruler's marker was deleted; one without was kept, and so was one the settings cannot judge (a `default_agents` list over several lines). Other agents' files are not checked |
| `migrated` | The project moved to the `.guideline/` layout. Review `git status` and commit |
| `manifest-v3` | `guideline.json` was rewritten as version 3 (whole stacks), so the rest of each chosen stack's files were added |
| `prepare` | `prepare` in `package.json` now runs `guideline apply` instead of `ruler apply` |
| `dev-dependency` | `guideline-manage` is not a dependency, so `prepare` was left alone. Until it is, `prepare` in a clone runs only ruler and writes an `AGENTS.md` without the guidelines. Add it with the command shown, then run `guideline apply` |
| `prepare-manual` | `prepare` runs `ruler apply` with arguments, which `guideline apply` does not take, so it was left alone. Change it to `guideline apply` by hand and move the ruler settings to `.ruler/ruler.project.toml` |
| `apply-hook` | There is no `package.json`: call `guideline apply` from your setup step (Orca: `scripts.setup` in `orca.yaml`) |

The personal scope adds these kinds. `status` also prints `personal-ignored`, `personal-shadowed`, `override-target`, `personal-revision`, `local-bad`, `role-missing` and `role-bad`.

| Kind | Meaning |
| --- | --- |
| `setup-personal` | A stack received only in the personal scope has a setup doc. Follow `docs/guideline/<stack>/SETUP.md` without changing committed files, and tell the user about a step that would. Agents get it instead of `setup` |
| `personal-ignored` | The project marks a block **Required** that you removed personally, so the removal is ignored. Clean it up with `guideline pick --local` |
| `personal-shadowed` | A personal addition has the same final name (after aliases) as a block the project picked from another source, so it is not used, nor the blocks you added below it. `pick --local` does not save them; elsewhere, clean it up with `guideline pick --local` |
| `personal-revision` | The personal copies and the project's copies are at different revisions of a source, for example after `update` in another worktree. Run `guideline update` (from `apply` and `status`) |
| `personal-sync` | The personal copies could not be updated: a write error, or a personal lock that cannot be read (delete the file the message names). The project itself was applied. Run `guideline update` again |
| `local-bad` | `local.json` cannot be read, so the files were composed from the project's choice only. Fix or delete the file. A 0.24.0 CLI also gives it for a `local.json` of version 2 |
| `role-missing` | This worktree's role is defined in no unit, so only the common personal selection was used. Define it with `guideline pick --local --role <name>`, or run `guideline role use --none`. A role missing only in some units is a `status` line instead |
| `role-bad` | The role file (`<git dir>/guideline/role`) does not hold a valid role name, so the worktree was composed without a role. Run `guideline role use <name>` or `guideline role use --none` |
| `ruler-leftover` | Something ruler made or changed only for your personal choice was left alone: a settings file or folder (`.mcp.json`, `.claude/skills`, `.cursor/mcp.json`, `.mcp.json.bak` …) that still holds something added by hand, is tracked, belongs to an agent other than claude, codex and opencode, or is the backup of such another agent's settings or of a settings file put there by hand — or an MCP server dropped from the composed choice is still in such another agent's settings. Check it and remove it yourself if you no longer need it |

`role-missing`, `role-bad` and the `apply` to-do of `guideline role remove` carry `scope: "personal"` too.
To-dos that come from the personal copies carry `scope: "personal"` in `--json`: `setup-personal`, `removed-upstream` (remove it with `guideline pick --local`) and the other kinds, whose message starts with "Personal copy —". A `no-copy` with `scope: "personal"` means a block you added has no personal copy, so it was not composed; run `guideline update`.

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

The [personal scope](#personal-scope) keeps its files outside the working tree, in git's common directory, so they are never committed.

Edit the copies in `.guideline/` (or send them upstream with `guideline propose`); a change in a generated file is overwritten by the next `apply`.
`propose` sends the `.guideline/` copies edited in the project as they are, because they already have the source's form.

### `guideline.json`

`items` of each source are **block keys**: `rules/<stack path>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>` (`"version": 3`).
A child stack is listed together with its ancestor stacks, for example `["rules/browser", "rules/browser/browseros-neo"]`.
An older file (`"version": 1` or `2`, with file paths) is read as before and rewritten as version 3 the next time `pick` or `update` writes it (a `manifest-v3` to-do says so).
`required` of a source lists the blocks marked **Required** in the pick form, for example `"required": ["rules/browser"]`. Each must be one of `items`. Nobody can remove them, or the stacks above them, in a personal selection. `pick` drops a required block you unchecked.

## Personal scope

`guideline pick --local` lets one worker add blocks to the project's choice, or remove blocks from it, without changing any committed file.
How to use it: [Use guidelines only on your machine](how-to/use-guidelines-only-on-your-machine.md).

What you receive is the project's choice, plus your additions and their ancestor stacks, minus your removals and the stacks below them.
A **Required** block and the stacks above it cannot be removed; such a removal is ignored with a `personal-ignored` to-do.
Additions are limited to the sources in `guideline.json`.

| Place | Contents |
| --- | --- |
| `<git common dir>/guideline/units/<unit key>/local.json` | Your personal selection: `{ "version": 2, "sources": { "<source>": { "add": [block keys], "remove": [block keys] } }, "roles": { "<role>": { "sources": { … } } } }`, real names before aliases. `roles` holds each personal role's layer, in the same form as `sources`. A file of version 1 (without `roles`) is still read. The unit key is `%root` for the git root unit, otherwise the URL-encoded unit path (`packages%2Fapi`) |
| `<git common dir>/guideline/units/<unit key>/.guideline/`, `guideline-lock.json` | The personal copies of the blocks you added, and their lock. Written by `pick --local` and `update`; do not edit them |
| `<git dir>/guideline/role` | This worktree's role name, on the first line. `<git dir>` is the worktree's own git directory (`.git/` in the main worktree, `.git/worktrees/<name>/` in a linked one), so each worktree has its own |
| `<git common dir>/info/exclude` | One block per unit and worktree, `# START guideline personal files <unit path> @<worktree>` … `# END …`, with the generated files, and the agents' settings files ruler writes (such as `.mcp.json`), that come only from the personal scope. `.` is the git root unit and the main worktree. A block of a worktree that git no longer knows is removed on the next write |

All worktrees of a clone share the git common directory, so they share the personal selection and copies.
`guideline.json`, `guideline-lock.json`, `.guideline/` and the `.gitignore` block stay as they would be without a personal scope.
The management guideline (`.ruler/guideline.md`) gets a "This worker's personal scope" section, and stacks received personally are marked "personal" in its setup table.

- `pick --local` opens one personal form per source. It shows the source at the revision in the project's lock, and receives the personal copies at that revision. `guideline update` brings the project and the personal copies to the latest revision together.
- `apply` composes the personal scope from the git common directory without the server, in any worktree.
- `propose` never sends personal copies.
- `--recommend` pre-checks the additions and removals in the form. A key not in the source, or a removal of a Required block or a stack that holds one, stops with exit code 2 before the form opens.
- A personal addition hidden by a block with the same final name that the project picked from another source is not saved (`personal-shadowed`). The blocks below it are not saved either.
- `local.json` or `defaults.json` that cannot be read stops `pick --local` with exit code 1; the file is not overwritten.

`status --json` adds `personal`:

| Field | Meaning |
| --- | --- |
| `added` | Blocks your common personal selection added that are received (`<source>:<key>` with several sources). `removed` and `ignored` are also the common layer's; the role's are in `role` |
| `removed` | Blocks of the project's choice you do not receive, the stacks below a removed one included |
| `ignored` | Removals ignored because the block is Required |
| `shadowed` | `[{ id, by }]`: additions hidden by a block of source `by`, judged on what the worktree finally receives |
| `role` | `{ name, defined, added, removed, ignored }` for this worktree's role, `null` without a role. `defined` is `false` when the role has a name but this unit does not define it; the lists are then empty |
| `items` | `[{ id, state }]`: the personal copies and their states, as for the project's copies |

`personal` is `null` when the unit is not in a git repository, or `local.json` cannot be read (a `local-bad` to-do says so).

### Personal roles

A worktree can use a personal role: a named layer of additions and removals on top of the common personal selection.
How to use it: [Use a role per worktree](how-to/use-guidelines-only-on-your-machine.md#use-a-role-per-worktree).

`apply`, `update`, `pick`, `pick --local` and `status` compose three layers: the project's choice, the common personal selection, then the role's layer from `roles.<name>` in `local.json`.

- The role's layer sits on the result of the common layer, the stacks it fills in above your additions included. When the role removes only a block below such a stack, the stack stays; remove the stack itself to drop it.
- A Required block and the stacks above it cannot be removed in the role's layer either (`personal-ignored`).
- A unit that does not define the worktree's role composes the common layer only, and `status` says so. When no unit of the worktree defines it, the worktree gets one `role-missing` to-do, even in a monorepo.
- The personal copies hold the additions of every role, whichever worktree runs `update`.
- The management guideline's personal section shows "Role: `<name>`" with the role's additions and removals when this unit defines the role.
- Committed files never change when you define, switch or remove a role.

`guideline role use <name>` checks the name and that some unit defines it, writes the role file, then applies from the git root.
When applying fails before anything is written, the role file goes back to what it held and the message names the earlier role.
When part of applying fails after files were written, the role stays and the message says to fix it and run `guideline apply`.

### Machine defaults

"Save this selection as my default" on the personal form stores your additions and removals in `defaults.json` in the CLI's configuration folder ([Configuration](configuration.md#cli-files)), per server address (origin).
They pre-check the personal form only in a project where you have no personal selection for that source yet; blocks the source does not have are left out.
`update` and `apply` never read them.
The last run that saves defaults sets that server's defaults. Within one run, several sources on the same server are merged; when they chose a block differently, the later source by name wins and the CLI warns.
In the role form (`pick --local --role <name>`), it stores the role's defaults under `roles.<name>` of that server, and leaves the common defaults and other roles alone.

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

`pick --local` exits with 2 when the folder is not in a git repository (or git is older than 2.31), nothing was received yet, the project is still in the old layout, or it is combined with `--new`.
It exits with 1 when `local.json` or `defaults.json` cannot be read, or when the server does not know the personal form ("This server does not know the personal form").
`pick --yes` exits with 2 without `--recommend`, with `--new`, with uncommitted changes in the working tree or outside a git repository (project mode), and for a recommended removal of a Required block. Nothing is written then.
`pick --local --role` also exits with 2 for a role name that breaks the naming rule, and `pick --role` without `--local` exits with 2.
`guideline role` exits with 2 outside a git repository, for a bad name or arguments, and when `use` names a role no unit defines. `role use` exits with the code `guideline apply` would (1 write failure, 2 nothing received or old layout).

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
- Items recommended with `--recommend` carry **Agent pick** and a reason. Blocks recommended for removal (`"remove"`) start unchecked and carry **Agent removal** and a reason (0.26+ server).
- With uncommitted changes in the working tree you get a warning, and must check **Proceed anyway** to submit. Commit first, so you can review the result with `git diff`.
- Items with a source warning show as "blocked" and cannot be checked; the reason is shown.
- A chosen stack row, and a chosen MCP server, subagent or skill row, has a **Required** checkbox. A Required block cannot be removed in anyone's personal selection. Unchecking the block turns its Required box off. **Review** lists the Required blocks.
- A form expires if it is not opened within 10 minutes, or after 90 seconds without page signals once opened.

### The personal form

`guideline pick --local` opens the same form in personal mode. Its subtitle ends with "my personal selection".

- Each block shows whether the project gets it, and three choices: **As project**, **Add** and **Remove**. Add is off for a block the project already gets; Remove is off for one it does not.
- A Required block shows "Required — cannot remove"; a stack above one shows "Holds a required block — cannot remove".
- Adding a child stack adds its ancestors the project does not get. Removing a stack removes the stacks below it. Turning a choice back to **As project** resets the stacks below that had the same choice.
- A line at the top says what is pre-checked: "my selection for this project" or "my defaults".
- **Review** lists what you add and remove, and has **Save this selection as my default**. There is no uncommitted-changes warning, because nothing committed is written.
- With `--role <name>` the form edits that role's layer. Its subtitle ends with "personal selection — role <name>", and the project column reads "project + my common selection get it" ("… do not get it"). A 0.24 server shows the plain personal form instead.
- In a monorepo subdirectory the personal form does not block skills, subagents and MCP servers, which are received only at the git root. Add them in the git root's personal selection.

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
- **Forms**: `POST /api/v1/forms` (2 MB body) creates a form and returns `/forms/<id>?k=<link token>`. A private server needs a read token; a public server lets anyone create a form. The link covers only that form and turns into a cookie (and leaves the address) when first opened. `GET /api/v1/forms/<id>/result?wait=` waits for the result. The request body carries `formVersion: 2` (stack choices); a body without it is refused with 426. The response lists `modes: ["project", "personal"]`; a body with `mode: "personal"` opens the personal form, and its result is `{ mode: "personal", add, remove, saveDefault, rejected: [] }` (block keys with aliases applied). A removal of a Required block is refused with 400. A form created with a token returns its result only to that token; a form created without a token, only to the admin or to a request with the link token in the `X-Form-Link` header. Forms finished more than a day ago are deleted when a new form is created.
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
