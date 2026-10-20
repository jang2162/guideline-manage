**English** | [한국어](../../ko/how-to/receive-from-several-sources.md)

# Receive guidelines from several servers

This guide lets one project receive guidelines from several guideline servers, called sources.
It is for teams that combine, for example, tool stacks from a personal server with company stacks from a company server.

1. **Add a source.** Run `guideline login --server <URL>` once per server. Then open that server's form with `guideline pick --source <name> --server <URL>`. Names start with a lowercase letter and use lowercase letters, digits and `-`, up to 32 characters.
2. **Give an alias when names clash.** Two sources may give a stack, skill, subagent or MCP server with the same name. The form then blocks it with "Another source uses this name", and forcing it through the manifest makes `pick` stop with "Name clash". Write an alias in that source's entry in `guideline.json`.

   ```json
   "company": { "server": "https://guideline.example.com", "items": [], "aliases": { "rules/base": "company-base" } }
   ```

   The company `base` then arrives as `.ruler/company-base/`, and override first lines use `company-base/<file>`. Changing an alias deletes the copies at the old place and leaves an `alias` to-do for override files there.
3. **Keep up to date.** `guideline status` and `guideline update` cover every source; pass `--source` for one. If one server is unreachable, only that source is left as it is and the rest is applied.
4. **Propose per source.** `guideline propose` splits edited copies by source and sends one proposal to each server.

Each source's `docs/management.md` is appended to the management guideline (`.ruler/guideline.md`) as `## <source> additional guidelines`.
A company source admin writes operating rules for every company project there.

## Next

- [Stay up to date](stay-up-to-date.md)
- [Propose changes to the source](propose-changes.md)
