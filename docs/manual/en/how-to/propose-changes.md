**English** | [한국어](../../ko/how-to/propose-changes.md)

# Propose changes to the source

This guide sends edited copies, or new guidelines, skills and MCP servers, to the guideline server.
It is for CLI users and agents who want to change the shared source.

The source changes through **proposals**.
When an admin accepts one under **Proposals** on the web, it becomes a revision, and each project receives it with `guideline update`.
Admins can also edit directly on the web.

## Get a token that can propose

Proposing needs a token with the `propose` scope.
Get one from an admin and store it.

```bash
guideline login --server <URL> --token-stdin
```

A token with the `admin` scope applies changes without review.
With it, `guideline propose` applies them directly instead of leaving a pending proposal.
Add `--review` to send a proposal for review anyway.
`guideline status` shows the stored token's scope, and `guideline propose --dry-run` says which of the two sending would do.

## Send an edited copy upstream

Run these in the project.

```bash
guideline propose --dry-run                     # the change turned back into source form, and its diff
guideline propose --title "base: tidy the commit rules"
```

## Upload new guidelines, skills or MCP servers

Work in a copy of the source.

1. Unpack the latest source into an empty folder.

   ```bash
   guideline source /tmp/gl-src
   ```

2. Edit `rules/`, `skills/`, `agents/` and `mcp/` in `/tmp/gl-src` at their source paths. The rules are in the source's `docs/authoring.md`.
3. Check for warnings.

   ```bash
   guideline list /tmp/gl-src
   ```

4. Preview, then send.

   ```bash
   guideline propose --from /tmp/gl-src --dry-run
   guideline propose --from /tmp/gl-src --title "rules: add deployment rules to the deploy stack"
   ```

Ask an agent to "share this project's guidelines" and the `guideline-export` skill picks out candidates and proposes them this way.

## Next

- [Review proposals](review-proposals.md)
- [Command reference](../reference.md#project-commands)
