**English** | [한국어](../../ko/how-to/use-guidelines-only-on-your-machine.md)

# Use guidelines only on your machine

This guide adds blocks to a project's choice, or removes blocks from it, for you alone, without changing any committed file.
It is for workers whose tools differ from the rest of the team, and for agents that set this up for them.

The project's choice in `guideline.json` stays the team's.
Your additions and removals are your **personal selection**, stored in git's own folder and never committed.

## Before you begin

- The project has received guidelines already (`guideline.json` exists). Otherwise run `guideline pick` first.
- The project is in a git repository, and git is 2.31 or later. Without git, `pick --local` stops with exit code 2.
- The guideline server is 0.24 or later. An older server does not know the personal form, and `pick --local` stops with "This server does not know the personal form" (exit code 1).

## Choose your blocks

1. In the unit directory, run `pick --local`.

   ```bash
   guideline pick --local
   ```

   The form opens with the subtitle "my personal selection". It shows the source at the revision the project received.

2. For each block, choose **As project**, **Add** or **Remove**.
   - Each row says whether the project gets the block. Add is off for a block the project gets, and Remove is off for one it does not.
   - Adding a child stack adds its ancestors too. Removing a stack removes the stacks below it.
   - A **Required** block shows "Required — cannot remove". A stack that holds one shows "Holds a required block — cannot remove".
3. On **Review**, check what you add and remove. Check **Save this selection as my default** if you want it to pre-check the form in other projects (see [Machine defaults](#machine-defaults)).
4. Select **Submit — save my selection**.

The terminal shows the generated files it wrote, as `pick` does.

```text
Applied (r3) — 2 written, 0 deleted
  write  .ruler/extra/00-e.md
  write  .ruler/guideline.md
```

`git status` shows no change: nothing that is committed was written.

To let an agent choose for you, see [Let an agent recommend](#let-an-agent-recommend).

## What changes and what stays

| What | Where | Committed |
| --- | --- | --- |
| Your personal selection | `<git common dir>/guideline/units/<unit key>/local.json` | No |
| Copies of the blocks you added | `<git common dir>/guideline/units/<unit key>/.guideline/` and `guideline-lock.json` | No |
| Generated files, and agents' settings files from ruler, that only your selection adds | Listed in `<git common dir>/info/exclude`, in a block for this unit and worktree | No |
| `guideline.json`, `guideline-lock.json`, `.guideline/`, the `.gitignore` block | Unchanged | Yes, as before |

`<git common dir>` is `.git/` in an ordinary clone.
The unit key is `%root` for the git root unit, otherwise the URL-encoded unit path, for example `packages%2Fapi`.

What you receive is the project's choice, plus your additions and their ancestor stacks, minus your removals and the stacks below them.
The management guideline (`.ruler/guideline.md`) gets a "This worker's personal scope" section that lists them.
`guideline status` shows two more lines:

```text
  Personal scope — added 1: rules/extra
  Personal scope — removed 0: -
```

> [!NOTE]
> Do not edit the personal copies in `<git common dir>/guideline/`. `guideline update` overwrites them, and `guideline propose` does not send them. To change a guideline for the team, edit the copy in `.guideline/` and propose it.

## Skills, subagents and MCP servers

ruler writes these into the agents' settings (`.mcp.json`, `.claude/skills/` and so on) and lists those files in its own block of `.gitignore`.
When your selection changes which of them exist, the committed `.gitignore` still stays as the project's choice makes it:

- Before ruler runs with your selection, the CLI runs ruler once more in a temporary folder with the project's choice alone, and puts that `.gitignore` back afterwards. Settings files that only your selection creates (for example `.mcp.json` when the project has no MCP server) go into this worktree's block in `info/exclude` instead.
- ruler does not remove an MCP server, a skill or a subagent it no longer receives. The CLI removes the ones you removed, and the ones you added before and no longer do, from `.mcp.json`, `opencode.json`, `.codex/config.toml`, `.claude/skills/`, `.agents/skills/`, `.opencode/skills/`, `.claude/agents/` and `.codex/agents/`.
- A settings file or folder that only your earlier addition created, but that still holds something you put there by hand, stays. A `ruler-leftover` to-do names it.

Without a personal selection, this works as before: ruler alone decides, and it keeps servers and skills the project drops.

## Worktrees and clones

- **Every worktree of a clone shares the personal selection**, because they share the git common directory. In a new worktree, `guideline apply` composes it without the server.
- Each worktree has its own block in `info/exclude` (`# START guideline personal files <unit path> @<worktree>`; `.` is the git root unit and the main worktree). Branches with different project choices therefore do not hide each other's generated files. The block of a removed worktree goes away on the next write.
- The personal copies hold every block you added, even one that this branch's project already picks: a worktree on another branch may not pick it. Where the project picks it, the project's copy is used. A copy is deleted only when you drop the addition in `pick --local`.
- If a block you added has no personal copy (it was never received, or was deleted), it is not composed and you get a `no-copy` to-do with `scope: "personal"`. Run `guideline update` to receive it.
- Another clone, or another machine, has no personal selection until you run `pick --local` there.

## Keep it up to date

`pick --local` receives your copies at the revision in the project's lock.
`guideline update` brings the project and your copies to the latest revision together.

If another worktree runs `update`, your copies can be at a newer revision than this worktree's project copies.
`apply` and `status` then report a `personal-revision` to-do; run `guideline update` here to align them.

## Required blocks

A project can mark blocks that nobody may remove.
In the project's pick form (`guideline pick`), a chosen block has a **Required** checkbox.
The list goes to `sources.<name>.required` in `guideline.json`, which you commit.

- A Required block, and every stack above it, cannot be removed in a personal selection.
- If a block becomes Required after you removed it, your removal is ignored and you get a `personal-ignored` to-do. Run `guideline pick --local` to clean it up.
- An agent cannot recommend removing it either: `pick --local --recommend` stops with exit code 2.

## Machine defaults

**Save this selection as my default** stores your additions and removals in `~/.config/guideline/defaults.json` (in `$XDG_CONFIG_HOME/guideline/` when it is set), per server address.

- They only pre-check the personal form, in a project where you have no personal selection for that source yet. The form says "Pre-checked: my defaults".
- Blocks that the source does not have are not pre-checked.
- `update` and `apply` never read them, so changing your defaults does not change any project.
- The last run that saves defaults sets that server's defaults. When one run saves several sources of the same server, their choices are merged; if they chose a block differently, the later source by name wins and the CLI warns.

## Set up stacks you added

A stack you added that has a setup doc gives a `setup-personal` to-do instead of `setup`.
In the management guideline's setup table, it is marked "personal".

Follow its `docs/guideline/<stack>/SETUP.md`, **but do not change committed files**, such as `package.json`, committed config files, `.gitignore` or `.ruler/ruler.project.toml`.
Your personal selection must leave the project as it is.
Do the steps that stay on your machine or in untracked files. For a step that would change a committed file, decide with your team instead.

The `guideline-sync` skill tells agents to work the same way.

## Let an agent recommend

An agent with the `guideline-sync` skill can choose for you.
It reads each stack's `when`; a stack for "work that uses <tool>" fits you when you use that tool.
It writes a file like this and runs `guideline pick --local --recommend <file>`:

```json
{ "add": { "rules/browser/browseros-neo": "you use BrowserOS neo" }, "remove": { "rules/orca": "you do not use Orca" } }
```

The form opens with those choices checked and marked.
A plain `{ "block key": "reason" }` means add.
A key that is not in the source, or a removal of a Required block, stops with exit code 2 before the form opens.

## Limits

- **Git only.** A unit outside a git repository has no personal scope.
- **Sources of the project only.** You can add blocks only from the sources in `guideline.json`.
- **Same names from another source.** If the project picked a block with the same final name from another source, your addition would never be used. `pick --local` does not save it, nor the blocks below it, and reports a `personal-shadowed` to-do. If the project picks that block after you added it, your addition and the blocks you added below it are not used either, so they never mix into the other source's stack.
- **Monorepo subdirectories.** Skills, subagents and MCP servers are received only at the git root, but the personal form in a subdirectory does not stop you from adding them. Add them in the git root's personal selection instead.
- **Broken files.** If `local.json` cannot be read, `apply` composes from the project's choice only (`local-bad` to-do) and `pick --local` stops with exit code 1 without overwriting it. Fix or delete the file.

## Next

- [Command reference: personal scope](../reference.md#personal-scope)
- [Receive guidelines in a monorepo subdirectory](use-in-a-monorepo.md)
- [Stay up to date](stay-up-to-date.md)
