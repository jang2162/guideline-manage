# Shared guideline management

Some guidelines in this project are copies received from a guideline server.

- Do not edit the copies directly: `.ruler/<stack>/NN-*.md`, `.ruler/<stack>/99-reference.md`, `docs/guideline/`, `guideline.json`, `guideline-lock.json`, and this file. Send fixes to a copy upstream {{propose}}; propose new guidelines with the `guideline-export` skill.
- Write anything that should differ for this project only as an override, in `.ruler/<stack>/override.md`, or `.ruler/<stack>/override.d/*.md` when there are several files. Start each override section with the line ``Overrides: `<stack>/<file>` "<## section title>"`` right under its heading (drop the quoted title to override the whole file), then write this project's rule below it. Overrides win over the copies.
- To bring the guidelines up to date, check with `guideline status` and run `guideline update` (agents use the `guideline-sync` skill).{{setup}}
