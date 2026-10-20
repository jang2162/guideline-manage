**English** | [한국어](../../ko/how-to/use-in-a-monorepo.md)

# Receive guidelines in a monorepo subdirectory

This guide receives guidelines separately in a subdirectory of a monorepo, such as `packages/api`.
It is for CLI users whose repository holds several packages.

Run `guideline pick` in a subdirectory that has its own `.ruler/`.
That directory becomes a separate unit: its manifest (`guideline.json`), lock (`guideline-lock.json`) and copies all live inside it.
It does not rewrite the root's guidelines.

- Skills, subagents and MCP servers are received only at the git root. In subdirectories they show as "blocked".
- Stacks already received at the root show "already at root" in the form. Usually you do not choose them again, so the same guideline is not included twice.
- If `.ruler/ruler.toml` at the git root lacks `nested = true`, you get a `nested-off` to-do. ruler builds that directory's CLAUDE.md and AGENTS.md only when it is on.
- If the subdirectory has no `.ruler/ruler.toml`, `pick` creates one that holds only the agent list.

## Next

- [Receive guidelines from several servers](receive-from-several-sources.md)
- [Stay up to date](stay-up-to-date.md)
