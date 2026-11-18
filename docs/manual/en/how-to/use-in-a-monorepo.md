**English** | [한국어](../../ko/how-to/use-in-a-monorepo.md)

# Receive guidelines in a monorepo subdirectory

This guide receives guidelines separately in a subdirectory of a monorepo, such as `packages/api`.
It is for CLI users whose repository holds several packages.

Run `guideline pick` in a subdirectory that has its own `.ruler/`.
That directory becomes a separate unit: its manifest (`guideline.json`), lock (`guideline-lock.json`), `.guideline/` copies, overrides and generated files all live inside it, including its own block in the unit's `.gitignore`.
It does not rewrite the root's guidelines.

- Skills, subagents and MCP servers are received only at the git root. In subdirectories they show as "blocked".
- Stacks already received at the root show "already at root" in the form. Usually you do not choose them again, so the same guideline is not included twice.
- If the ruler settings at the git root (`.ruler/ruler.project.toml`) lack `nested = true`, you get a `nested-off` to-do. ruler builds that directory's CLAUDE.md and AGENTS.md only when it is on.
- Run `guideline apply` at the git root before you run it in a unit. While the git root has no `.ruler/ruler.toml`, a unit's `apply` composes its own files but does not run ruler, and leaves a `root-apply` to-do: ruler would write files for every agent without it. Either run `guideline apply` at the git root first, or put `.ruler/ruler.toml` with `nested = true` there yourself.
- After a clone, run `guideline apply` once at the git root (the root's `prepare` does it when it calls `guideline apply`). It composes the root and every unit below it that git tracks (a directory with a committed `guideline-lock.json`), then runs ruler once, so every unit's CLAUDE.md and AGENTS.md are filled. A unit still in the old layout is skipped with a `unit-update` to-do: run `guideline update` in it.
- `guideline update`, `guideline pick` and `guideline pick --local` at the git root also compose the units below it, before ruler runs. So the root's ruler run never builds a unit from missing or stale generated files.
- If a unit's generated files cannot all be written, the error names the unit and you get a `unit-write-failed` to-do (exit code 1). ruler still ran, so do not trust that unit's `AGENTS.md` and other agent files: fix the cause, then run `guideline apply` at the git root again.
- The git root does not have to receive guidelines itself. If it has no `guideline.json`, `guideline apply` there still composes the units and runs ruler with the root's own `.ruler/ruler.toml`, which you commit with `nested = true`. Without it you get a `root-ruler-toml` to-do and ruler does not run.
- If the subdirectory has no ruler settings, `pick` creates `.ruler/ruler.project.toml` there with only the agent list.
- The [personal scope](use-guidelines-only-on-your-machine.md) is per unit: run `guideline pick --local` in the unit whose blocks you want to change. The personal form in a subdirectory does not block skills, subagents and MCP servers; add those in the git root's personal selection.

## Next

- [Receive guidelines from several servers](receive-from-several-sources.md)
- [Stay up to date](stay-up-to-date.md)
