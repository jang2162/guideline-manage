# guideline-manage — project instructions

## What this repository is

The `guideline` CLI (npm package `guideline-manage`) and the guideline server (`server/`, Docker Compose). The server holds a team's shared coding-agent guidelines; the CLI picks them into ruler projects and proposes changes back. No guideline content lives in this repository.

## Map

| When | Read |
| --- | --- |
| Changing CLI command behavior | `docs/manual/en/reference.md`, `cli/test/` |
| Changing the server, admin web or API | `docs/manual/en/reference.md`, `docs/manual/en/configuration.md`, `docs/manual/en/how-to/`, `server/test/` |
| Changing user-facing text | `locales/en/messages.json` (canonical), `locales/ko/`, `docs/manual/en/how-to/add-a-language-pack.md` |
| Changing the seed skills, authoring rules or `/llms.txt` | `locales/<lang>/templates/` |
| Writing or moving user docs (`README*.md`, `docs/manual/`) | `CONTRIBUTING.md` "Documentation" |
| Releasing | `CONTRIBUTING.md` "Releases" |

## Rules

- Run `pnpm test` after changing code or `locales/`. Tests run with `GUIDELINE_LANG=ko`.
- Every user-facing string goes through `t()` with a key in `locales/en/messages.json`; add the Korean text to `locales/ko/messages.json` too.
- Use pnpm. Do not create `package-lock.json`. The CLI has no runtime dependencies; keep it that way.
- User docs are English in `docs/manual/en/` with a Korean copy in `docs/manual/ko/` (same file names and structure) and `README.ko.md`; change both, and update the `<!-- source: … @ v<version> -->` line of the copy. `CHANGELOG.md` and `CONTRIBUTING.md` are English only.
- Record user-visible changes under `Unreleased` in `CHANGELOG.md`.
