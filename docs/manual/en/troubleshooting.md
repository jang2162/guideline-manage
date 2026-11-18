**English** | [한국어](../ko/troubleshooting.md)

# Troubleshooting

This page lists error messages and symptoms with their causes and fixes.
It is for CLI users and server operators who are stuck.

## CLI

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No server address` | The CLI does not know which server to use | Pass `--server <URL>` or set `GUIDELINE_SERVER` |
| `Login required: guideline login --server …` | There is no token, or it was revoked | Run the command shown |
| Messages are in the wrong language | `GUIDELINE_LANG` is not set as you want. The server uses its own environment | Set `GUIDELINE_LANG` (`en`, `ko` …) in the shell, and in the server environment for server messages |
| `The CLI is too old — upgrade guideline-manage` | The server rejected a CLI older than 0.12.0 | Run `npm install -g guideline-manage` |
| `not submitted: expired` (exit code 3) | The form was not opened within 10 minutes, or the tab was closed for 90 seconds. Nothing was written | Run `pick` again |
| The form says "This form is already closed." | It was submitted, cancelled or expired | Run `pick` again in the terminal |
| `The form is gone from the server` | The server data changed while the CLI was waiting | Run `pick` again |
| `conflict` to-do | The same name exists and differs from the source | Check **show diff** in `pick`, then turn on **update** or leave it |
| `Not a ruler project` | The directory has no `.ruler/` | Move existing guidelines into `.ruler/` and try again |
| `This project still uses the old layout — run guideline update once …` (exit code 2) | `status`, `propose` or `apply` ran in a project received before 0.24 (copies in `.ruler/<stack>/`) | Run `guideline update` once; it needs the server. See [Upgrade the server and the CLI](how-to/upgrade.md#move-projects-to-the-guideline-layout) |
| `Commit or stash your changes first` | The move to the `.guideline/` layout rewrites tracked files, and tracked files in the directory have uncommitted changes | Commit or stash them and run `update` again |
| A `CLAUDE.md` appeared, or Claude Code ignores `AGENTS.md` (`stray-ruler-output` to-do) | `ruler apply` ran without `.ruler/ruler.toml`, usually right after a clone, so ruler wrote files for every agent | Run `guideline apply`. It deletes a `CLAUDE.md` that has ruler's marker and says so; one without the marker is kept, so check it and delete it yourself. Only `CLAUDE.md` is checked, so look at `git status` for other agents' files ruler wrote and delete what you do not use |
| No guidelines after a clone or in a new worktree: `.ruler/<stack>/` is missing | The generated files are not in git | Run `guideline apply` (no server needed). To do it on install, see [Set up a fresh clone](getting-started.md#6-set-up-a-fresh-clone-or-a-new-worktree) |
| The guidelines are stale after I ran only `ruler apply` | ruler reads the generated files, not `.guideline/`. After you change `.guideline/` or `ruler.project.toml`, the generated files stay old until `guideline apply` | Run `guideline apply`, which also runs ruler. `status` shows an `apply` to-do when the generated files are out of date |
| I edited `.ruler/<stack>/01-git.md` (or `docs/guideline/…`) and the edit was lost | These are generated files; every `guideline apply` rewrites them | Edit the copy in `.guideline/` and send it upstream with `guideline propose`, or write an [override](how-to/override-guidelines.md) |
| `ruler was not run: the git root … has no .ruler/ruler.toml yet` (`root-apply` to-do) | In a monorepo, a unit's `apply` stops before ruler while the git root has no `.ruler/ruler.toml` | Run `guideline apply` at the git root first, or put `.ruler/ruler.toml` with `nested = true` there yourself, then run it in the unit again |
| `git status` shows old copies as deleted, or an `untracked` to-do gives a `git rm --cached` command | The CLI took files that are now generated out of the git index (`git rm --cached`; the files stay on disk), or could not and gives the command | Run the command if shown, check `git status` and commit. Run `guideline apply` before `git add -A`, or the old copies come back |
| `[<table>] not added to .ruler/ruler.toml` (`mcp-conflict` to-do) | `ruler.project.toml` already has a table with that name, or the TOML shapes clash. The project's own table is kept | Check the table. If you changed a received MCP table in this project, edit `.guideline/mcp/<name>/server.json` and send it with `guideline propose`. The changed table stays in `ruler.project.toml` and `status` shows the MCP as current |
| A `.claude/skills/<name>` or an `.mcp.json` entry I made by hand disappeared after the first `pick` | A received skill or MCP server with the same name is built into `.ruler/` and ruler writes it over yours. The form no longer compares `.claude/skills` or `.mcp.json`, so it does not warn | Rename yours before you pick, or send it upstream with the `guideline-export` skill |
| `The CLAUDE.md form is no longer supported` | The project was received in the 0.12 CLAUDE.md form | Move it to ruler and run `guideline pick` again |
| `This token cannot propose` | It is a read token | Get a `propose` scope token from an admin and store it with `--token-stdin` |

## Admin web

| Symptom | Cause | Fix |
| --- | --- | --- |
| Login or saving gives 403 | You opened an address other than `PUBLIC_URL` | Open the `PUBLIC_URL` address |
| The accept button is disabled under **Proposals** | The proposal conflicts with a change to the same place in the source (Outdated) | Resolve it with **Edit**, or reject it |

## The server does not start

The first log line is the reason.
Operating logs and configuration errors are in English whatever the language setting.

| Log | Cause | Fix |
| --- | --- | --- |
| `… is not set`, `… must be at least 32 characters` | A required variable is missing or too short | Fix `.env` and start again |
| `cannot write to … (chown 1000:1000)` | The server user (uid 1000) cannot write to the data folder | Run `chown 1000:1000` on `DATA_HOST_DIR` |
| `DB schema vN is newer than this server (vM) …` | A newer image was deployed and then rolled back | Deploy the newer version again, or [restore the pre-upgrade backup](how-to/back-up-and-restore.md#restore-a-backup) |

## Next

- [Configuration](configuration.md)
- [Upgrade the server and the CLI](how-to/upgrade.md)
- [All documents](../README.md)
