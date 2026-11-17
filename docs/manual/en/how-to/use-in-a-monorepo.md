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
- After a clone, run `guideline apply` at the git root and in each unit.
- If the subdirectory has no ruler settings, `pick` creates `.ruler/ruler.project.toml` there with only the agent list.

## Next

- [Receive guidelines from several servers](receive-from-several-sources.md)
- [Stay up to date](stay-up-to-date.md)
