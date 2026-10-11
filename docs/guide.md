# User guide

English · [한국어](ko/guide.md)

How to keep a team's shared agent guidelines on a **guideline server** and pick them into projects with the `guideline` CLI, from start to finish. Every command option is in [usage.md](usage.md); running the server (deployment, backups) is in [server.md](server.md).

Agents can read the server's `/llms.txt` (for example `http://localhost:3000/llms.txt`), a condensed version of this guide for agents.

```
guideline source (server DB) ── admin web: view, edit, history, tokens
        │
        ▼  guideline pick / update (logged-in CLI)
project: copies + guideline.json (chosen items) + guideline-lock.json (what was applied)
```

## 1. Setup (once per machine)

You need **Node 24 or later**.

Install the CLI and check it:

```bash
npm install -g guideline-manage   # provides the guideline command
guideline help
```

To use it straight from a clone of this repository, call `node <repo>/cli/bin/guideline.js <command>`, or run `pnpm link --global` at the repository root.

Put these in your shell profile:

```bash
export GUIDELINE_LANG=en                       # language of CLI messages and of text written into projects (ko for Korean)
export GUIDELINE_PROJECTS_DIR=~/IdeaProjects   # parent folder for new projects created by name alone
```

## 2. Running a guideline server (locally)

Skip this if you use a server that is already running. Create `.env` at the repository root (git ignores it).

```bash
cat > .env <<EOF
ADMIN_TOKEN=$(openssl rand -base64 48)
PUBLIC_URL=http://localhost:3000
DATA_DIR=./.data
GUIDELINE_LANG=en
EOF
node --env-file=.env server/bin/guideline-server.js
```

- `ADMIN_TOKEN` must be at least 32 characters; it works as the admin web's login password. Changing it ends every login session.
- **Always open the `PUBLIC_URL` address.** Opening another address such as `127.0.0.1:3000` makes login and saving fail.
- The data is a single `.data/guideline.db`; backups go to `.data/backups/` at startup and daily. When you restart with a new version, the DB is backed up before the schema is upgraded.
- `GUIDELINE_LANG` is the language of the admin web and of the seed put into an empty server (default English).
- Running with Docker Compose: see [server.md](server.md).

A freshly started server gets a **seed** as revision 1: the authoring rules `docs/authoring.md` and the seed skills `guideline-sync` and `guideline-export` (in the server language). Create guidelines with "New file" on the admin web, or upload many at once through the proposals API with an admin token and `apply: true` (up to 500 changes and 20 MB). To move an old guideline repository clone in wholesale, start an empty server with `GUIDELINE_SEED=off` first, so its files do not clash with the seed.

```bash
curl -s -X POST http://localhost:3000/api/v1/proposals \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"first fill","apply":true,"changes":[{"path":"rules/base/00-agent.md","text":"---\nload: always\n---\n\n# Agent\n","base":null}]}'
```

Open `http://localhost:3000` to browse stacks, skills, subagents and MCP servers without logging in (with `PUBLIC_READ=0`, log in first). To edit, review proposals or manage tokens, use "Log in" at the top with the admin token. "Usage" at the top is `/llms.txt`.

## 3. Log in (once per machine)

```bash
guideline login --server http://localhost:3000
```

A browser opens. If you are not logged in to the admin web, log in with the admin token and click "Issue". When the terminal prints `Logged in: http://localhost:3000 (cli-<host>-…)`, you are done.

- The read token is stored in `~/.config/guideline/credentials.json` (mode 600), separately per server.
- Where no browser is available (remote shells), issue a token on the web "Tokens" page and store it with `guideline login --server <URL> --token-stdin`.
- In CI, use the `GUIDELINE_TOKEN` environment variable.
- To stop, run `guideline logout --server <URL>`. It deletes the local token and revokes it on the server.

## 4. Receiving guidelines in a project

**Only projects that use ruler can receive guidelines.** The directory needs a `.ruler/`. Otherwise it stops with "Not a ruler project" — move your existing CLAUDE.md/AGENTS.md guidelines into `.ruler/` first.

Run it at the project root (a git repository).

```bash
cd ~/IdeaProjects/my-app
guideline pick --server http://localhost:3000   # later runs can drop --server (it is kept in guideline.json)
```

The CLI downloads the source from the server, compares it with the project, creates a form on the server from the result, and opens it in the browser. **The terminal waits until you submit the form.**

### Choosing in the form

A domain stack (`<tool>__<domain>`, e.g. `deploy-package__gitlab.develma.com`) shows the tool name with a domain tag. The same tool has different rules on different servers, so pick the stack for the server your project uses.

| Shown | Meaning | When checked |
| --- | --- | --- |
| same | Already there as in the source | Left as is |
| different | There, but differs from the source | Left as is. Turn on "update" to overwrite it with the source. Check it with "show diff" |
| missing | Not there yet | Added |
| source updated | The source changed after you received it | "update" starts turned on |
| edited in project | The project changed it after receiving it | Left as is. Turn on "overwrite" to revert it to the source |

- **Unchecking an item that is already there means "remove".** It turns red and the submit button says "includes N removal(s)".
- Category buttons (`backend`, `browser` …) check every item in that category. "Reset" undoes it.
- With uncommitted changes in the working tree you get a warning, and must check "Proceed anyway" to submit. Committing first makes the result easy to review with `git diff`.
- Items with a source warning show as "blocked" and cannot be checked; the reason is shown.

### After submitting

The terminal shows the written files, deleted files and **to-dos**.

```
Applied (r3) — 5 written, 1 deleted
  write  .ruler/base/01-git.md
  write  docs/guideline/mise/SETUP.md
  delete  docs/guideline/tiergear/02-orca-spawn.md
To do
  - mise: set up by following the setup doc — docs/guideline/mise/SETUP.md
```

To-dos are what the CLI cannot do alone (MCP secrets, environment variables, setup docs, conflicts with existing files and so on). Do them yourself or hand them to an agent (section 6).

Finally, check the changed files and **commit them yourself**, together with `guideline.json` and `guideline-lock.json`. The CLI does not commit.

### What appears in the project

| What | Where |
| --- | --- |
| Always-on guidelines | `.ruler/<stack>/NN-*.md` |
| Reference guidelines | `docs/guideline/<stack>/` + index `.ruler/<stack>/99-reference.md` |
| Setup docs | `docs/guideline/<stack>/SETUP.md` |
| Skills, subagents | `.ruler/skills/`, `.ruler/agents/` (when `[agents] enabled = true`) |
| MCP | `.ruler/ruler.toml` |
| Management guideline | `.ruler/guideline.md` |

- After applying, `ruler apply` is needed at the git root. If ruler is installed in the project the CLI runs it; otherwise it leaves a to-do.

### Monorepo subdirectories

Running `guideline pick` in a subdirectory with its own `.ruler/`, such as `packages/api`, makes that directory a separate unit. Its manifest, lock and copies all live inside it, and it does not rewrite the root's guidelines.

- Skills, subagents and MCP servers are received only at the git root; in subdirectories they show as "blocked".
- Stacks already received at the root show "already at root" in the form. Usually you do not choose them again, so the same guideline is not included twice.
- If `.ruler/ruler.toml` at the git root lacks `nested = true`, you get a to-do (`nested-off`). ruler builds that directory's CLAUDE.md and AGENTS.md only when it is on.
- If the subdirectory has no `.ruler/ruler.toml`, `pick` creates one with just the agent list.

### Receiving from several sources

One project can receive from several guideline servers (sources). For example, tool stacks from a personal server and company stacks from a company server.

1. **Add a source.** Run `guideline login --server <URL>` once per server, then open that server's form with `guideline pick --source <name> --server <URL>`. Names start with a lowercase letter and use lowercase letters, digits and `-`, up to 32 characters.
2. **Give an alias when names clash.** When two sources give a stack (or skill, subagent, MCP server) with the same name, the form blocks it with "Another source uses this name", and forcing it through the manifest makes `pick` stop with "Name clash". Write an alias in that source's entry in `guideline.json`:

   ```json
   "company": { "server": "https://guideline.example.com", "items": [], "aliases": { "rules/base": "company-base" } }
   ```

   The company `base` then arrives as `.ruler/company-base/`, and override first lines use `company-base/<file>`. Changing an alias deletes the copies at the old place and leaves a to-do (`alias`) for override files there.
3. **Keep up to date.** `guideline status` and `guideline update` cover every source (`--source` for one). If one server is unreachable, only that source is left as it is and the rest is applied.
4. **Proposals go per source.** `guideline propose` splits edited copies by source and sends one proposal to each server.

Each source's `docs/management.md` is appended to the management guideline (`.ruler/guideline.md`) as `## <source> additional guidelines`. That is where a company source admin writes operating rules for every company project.

## 5. Creating a new project

```bash
guideline pick --new my-new-app    # GUIDELINE_PROJECTS_DIR/my-new-app
guideline pick --new ~/work/x      # a path works too (absolute or ~)
```

Choose the agents (claude, codex) at the top of the form. The form is always ruler. Submitting creates the folder, runs `git init`, and applies the choice. **Cancelling leaves no folder behind.**

## 6. Handing it to an agent

Projects that received guidelines also get the `guideline-sync` skill (if you chose the skill). Tell the agent "update the guidelines" or "export guidelines" and the skill calls `status`, `update` or `pick` and handles the to-dos.

For projects without the skill, or other agents, say "read `http://localhost:3000/llms.txt` and get the guidelines". llms.txt explains how to handle each kind of to-do.

## 7. Staying up to date

```bash
guideline status            # what changed?
guideline update            # same choices, latest version
guideline update --force    # also revert files edited in the project to the source
guideline pick              # to change what you chose
```

`status` states:

| State | Meaning | What to do |
| --- | --- | --- |
| current | Neither the source nor the project changed | Nothing |
| source updated | The source changed | `update` |
| edited in project | The copy was edited in the project | Send it upstream with `guideline propose`, move it to an override, or `update --force` |
| both changed | Both changed | Look at the diff and decide |
| missing | The copy was deleted | `update` writes it again |
| not applied (conflict) | It already existed and differed on first receive, so it was not written | "show diff" in `pick`, then "update" |
| removed from source | Deleted from the source | Remove it in `pick` |

`update` **skips files edited in the project** and leaves a to-do (`skipped`), so edits are never lost.

## 8. Doing things differently in this project (overrides)

Do not edit the copies; write an **override**. Overrides belong to the project and `update` never touches them.

- Place: `.ruler/<stack>/override.md` or `.ruler/<stack>/override.d/*.md`

Start each override with a line saying what it overrides.

```markdown
## base project overrides

### Commit messages in English

Overrides: `base/01-git.md` "Commit messages"

This project has outside contributors, so commit messages are written in English.
```

To override a whole file, drop the quoted title. If the file or section disappears from the source, you get a to-do (`override`).

## 9. Stack setup docs

Stacks that need setup (for example `mise`) come with `docs/guideline/<stack>/SETUP.md`. When it is newly received or the source changes, you get a to-do (`setup`). Check `## Check` to see whether it is already done, and if not, follow `## Setup`. Anyone who freshly clones the project follows it too.

## 10. Changing the source guidelines

The source changes through **proposals**. When an admin accepts one under "Proposals" on the web it becomes a revision, and each project receives it with `guideline update`. Admins can also edit directly on the web.

Proposing needs a token with the `propose` scope. Get one from an admin and store it with `guideline login --server <URL> --token-stdin`.

A token with the `admin` scope can apply changes without review. `guideline propose --apply` applies them directly instead of leaving a pending proposal (without `--apply`, even an admin token proposes). Agents can accept or reject other proposals with `POST /api/v1/proposals/<number>/accept` and `/reject`. An admin token cannot log in to the web or manage tokens.

**If you edited a received copy**, in the project:

```bash
guideline propose --dry-run                     # the change turned back into source form, and its diff
guideline propose --title "base: tidy the commit rules"
```

**To upload new guidelines, skills or MCP servers**, from a working copy of the source:

```bash
guideline source /tmp/gl-src                    # unpack the latest source into an empty folder
# edit rules/ skills/ agents/ mcp/ in /tmp/gl-src at their source paths (rules in docs/authoring.md)
guideline list /tmp/gl-src                      # check for warnings
guideline propose --from /tmp/gl-src --dry-run
guideline propose --from /tmp/gl-src --title "rules: add deployment rules to the deploy stack"
```

Ask an agent to "share this project's guidelines" and the `guideline-export` skill picks out candidates and proposes them this way.

**Reviewing proposals (admins).** Under "Proposals" on the web, look at each file's diff. If the source changed in the meantime, you see the merged result for non-overlapping changes, or a conflict (Outdated) where both changed the same place. Resolve a conflict with "Edit", remove that file, or reject the proposal.

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `No server address` | Pass `--server <URL>` or set `GUIDELINE_SERVER` |
| `Login required: guideline login --server …` | No token, or it was revoked. Run the command shown |
| Messages are in the wrong language | Set `GUIDELINE_LANG` (`en`, `ko` …). The server uses its own environment |
| `The CLI is too old — upgrade guideline-manage` | The server rejected a CLI older than 0.12.0. Upgrade with `npm install -g guideline-manage` |
| `not submitted: expired` (exit code 3) | The form was not opened within 10 minutes, or the tab was closed for 90 seconds. Nothing was written. Run `pick` again |
| The form says "This form is already closed." | It was submitted, cancelled or expired. Run `pick` again in the terminal |
| `The form is gone from the server` | The server data changed while waiting. Run `pick` again |
| Admin web login or saving gives 403 | You opened an address other than `PUBLIC_URL`. Open the `PUBLIC_URL` address |
| To-do `conflict` | The same name exists and differs from the source. Check "show diff" in `pick`, then turn on "update" or leave it |
| `Not a ruler project` | The directory has no `.ruler/`. Move existing guidelines into `.ruler/` and try again |
| `The CLAUDE.md form is no longer supported` | The project was received in the 0.12 CLAUDE.md form. Move it to ruler and run `guideline pick` again |
| `This token cannot propose` | It is a read token. Get a `propose` scope token from an admin and store it with `--token-stdin` |
| The accept button is disabled under "Proposals" | It conflicts with a change to the same place in the source (Outdated). Resolve it with "Edit" or reject it |
