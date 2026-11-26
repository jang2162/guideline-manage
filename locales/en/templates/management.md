# Shared guideline management

Some guidelines in this project are copies received from a guideline server.

- The received copies live in `.guideline/` (`.guideline/rules/<stack>/NN-*.md` and so on). Do not edit them, `guideline.json`, `guideline-lock.json` or this file directly. Send fixes to a copy upstream {{propose}}; propose new guidelines with the `guideline-export` skill.
- The guideline files under `.ruler/` (`.ruler/<stack>/`, `.ruler/guideline.md`, `.ruler/skills/`), `docs/guideline/` and `.ruler/ruler.toml` are generated from `.guideline/` by `guideline apply` and are listed in `.gitignore`. An edit there is overwritten by the next `guideline apply`, so do not put project files in those folders. Project-only rules go in `.ruler/*.md` (for example `.ruler/50-project.md`) or in an override.
- Write anything that should differ for this project only as an override, in `.guideline/overrides/<stack path>/override.md` (`.guideline/overrides/<parent>/<child>/override.md` for a child stack), or `.guideline/overrides/<stack path>/override.d/*.md` when there are several files. Start each override section with the line ``Overrides: `<stack>/<file>` "<section title>"`` right under its heading (drop the quoted title to override the whole file; copy the title after `## ` in the original exactly), then write this project's rule below it. Overrides win over the copies.
- This project's own ruler settings (agents, output paths, MCP servers the project wrote itself) go in `.ruler/ruler.project.toml`. `guideline apply` builds `.ruler/ruler.toml` from it and the received MCP servers.
- To add or remove a coding agent (claude, codex, opencode), run `guideline agents add <name>` / `guideline agents remove <name>`. It needs no form: it changes `agents` in `guideline.json` and `default_agents` in `.ruler/ruler.project.toml` together, then applies. Do not edit either by hand.
- After a fresh clone or in a new worktree, run `guideline apply` (it does not need the server) to create the generated files.
- To bring the guidelines up to date, check with `guideline status` and run `guideline update` (agents use the `guideline-sync` skill).{{setup}}
