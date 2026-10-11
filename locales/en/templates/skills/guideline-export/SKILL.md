---
name: guideline-export
description: Proposes sections of this project's guidelines that other projects could use as stacks on the guideline server. Use it for requests like "upload guidelines", "export to shared", or "propose to the guideline server".
---

<!-- The guideline server adds this file as a seed when it first starts. From then on it is managed as source (web edits and proposals). Adapt it to your team. -->

# guideline-export

**Run this skill in the project whose guidelines you want to upload.** It reads this project's guidelines, picks out the sections that also hold in other projects, and proposes only the ones the user chooses to the guideline server.

## Preconditions

1. **Get the source.** Pick an empty temporary folder (for example `src` under `mktemp -d`) and run `guideline source <folder>`. If this project's `guideline.json` has more than one source, ask the user which source (guideline server) to upload to and run `guideline source <folder> --source <name>`. Below, this is the "source folder". If you see "Login required", point the user to `! guideline login --server <URL>` and stop.
2. **Token scope.** Check the stored token's scope on the "Token:" line of `guideline status` (`token` with `--json`). `guideline propose --from <source folder> --dry-run` in step 6 also tells you what sending would do.
   - With the `admin` scope, `guideline propose` **applies directly instead of proposing** — the source changes right away, without review. Tell the user it will be applied directly before uploading. If the user wants a review, upload as a proposal with `guideline propose --from <source folder> --title <title> --review`.
   - With the `propose` scope it becomes a proposal, which becomes source once an admin accepts it under "Proposals" on the web.
   - If uploading says "This token cannot propose", tell the user to get a token with the `propose` scope from an admin and store it with `guideline login --server <URL> --token-stdin`, then stop.
3. If `<source folder>/docs/authoring.md` has no `## Subagents` or `## MCP servers` section, stop before uploading subagents or MCP servers and ask the guideline admin to add that section to the source. When uploading an MCP server built from its README, also read the `### Servers built when applied` section.
4. If `<source folder>/docs/authoring.md` has no `## Load — always and reference` section, stop the same way before uploading guideline files. The rule for choosing the load is in that section. When uploading an override of another stack, also read the `## Overriding another stack` section.
5. **Edits to received copies are not this skill's job.** Copies that `guideline status` shows as "edited in project" are sent with `guideline propose` (it turns the copy back into source form). This skill uploads guidelines that are new to the source. `propose` leaves out copies that already differed from the source when first received (to-do `adopted`), because proposing an old version would undo source changes.

## Steps

1. **Collect this project's guidelines,** whatever their form.
   - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.ruler/`, `.claude/rules/`, `.cursor/rules/`, `.github/copilot-instructions.md`, guideline files in subdirectories, project skills (`.claude/skills/`, `.agents/skills/`, `.ruler/skills/`)
   - Subagents: `.claude/agents/`, `.codex/agents/`, `.cursor/agents/`, `.github/agents/`, `.ruler/agents/`
   - MCP settings: `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, `[mcp_servers]` and `[agents.<agent>.mcp_servers]` in `.ruler/ruler.toml`, `.ruler/mcp.json`
   - Copies written by `guideline` are copies of the source, so do not upload them again as stack candidates: `.ruler/<stack>/` (same name as a source stack), `docs/guideline/`, indexes (`.ruler/<stack>/99-reference.md`), the management guideline (`.ruler/guideline.md`), and `guideline.json`/`guideline-lock.json`. Setup doc copies (`docs/guideline/<stack>/SETUP.md`) are under `docs/guideline/` too. If one differs from the source without its frontmatter, report the difference in the "Already present / conflicts" table.
   - Project overrides (`.ruler/<stack>/override.md`, `.ruler/<stack>/override.d/*.md`) are the project's deliberate changes to the source. Do not upload them as stack candidates; show them in the "Project overrides" table in step 4.
   - When generated files and their source exist together (`CLAUDE.md`, `.claude/agents/` and `.mcp.json` in a ruler project), read only the source (`.ruler/`). When two files are copies of each other, read only one.

2. **Learn the source's layout.** Run `guideline list <source folder>` to see the stacks (guideline files and loads), skills, subagents and MCP servers, and read the relevant files and `docs/authoring.md`.

3. **Classify section by section (`##`/`###`).** Classify skills, subagents and MCP servers one by one.

   | Class | Criterion |
   | --- | --- |
   | Stack candidate | A section with no names specific to this project (scripts, packages, classes, columns, ports, people) that also holds in other projects. Decide which stack it goes to; propose a new stack when none fits. Rules true in every project go to a general stack like `base`. Decide the load (`always`/`reference`) by the criterion in `docs/authoring.md` |
   | Overrides another stack | The candidate teaches the same topic as a section of another stack differently **in a specific environment** (for example: when Orca is running, create worktrees with Orca). Give both the overriding and the overridden section as the target. Without an environment condition it is a "conflict with the source" |
   | Skill candidate | A skill of this project that other projects could use |
   | Subagent candidate | A subagent of this project that other projects could use |
   | MCP candidate | An MCP server other projects could use. If it points at a specific project's host, database or repository, keep it project-specific. But if the value merely differs per project and can be found inside the project (for example the GitLab host from `git remote`), it can be uploaded as an MCP server built from its README |
   | Already present | Say which section of which source file has the same intent |
   | Conflicts with the source | Same topic, different rule. The user decides which is right |
   | Project-specific | Everything else. Report only the count |

4. **Report in tables and upload only what the user chooses.**

```
## Guideline export — <project> → guideline server

### Candidates
| Source file · section | Class | Target | Load | Reason |
| --- | --- | --- | --- | --- |
| CLAUDE.md · "Never report done without verification" | Stack candidate | rules/base/05-verification.md | always | no project names, a general principle |
| CLAUDE.md · "When Orca is running, create worktrees with Orca too" | Overrides another stack | rules/orca/05-switch.md "…" → base/01-git.md "Create worktrees inside the repository, one per task" | always | the worktree command and location differ only while Orca is running |
| .mcp.json · jira | MCP candidate | mcp/jira/ | — | team Jira. headers.Authorization has a hard-coded value; change it to a reference |
| .mcp.json · gitlab | MCP candidate (built from README) | mcp/gitlab/README.md | — | the url host matches the git remote host. Some projects use another GitLab, so it is built when applied |

### Already present / conflicts
| Source file · section | Source | Details |
| --- | --- | --- |

### Project overrides
| Override | Overridden section | Suggestion |
| --- | --- | --- |
| .ruler/base/override.md "Create worktrees in ~/worktrees" | base/06-worktree-setup.md "Create worktrees inside the repository, one per task" | keep in the project |

Project-specific sections: N
```

   A "Project overrides" suggestion is one of three: **fix the source** (the override is right for every project), **upload as an override between stacks** (it differs only in a specific environment — handle it as "Overrides another stack"), or **keep in the project**. Apply only what the user chooses.

5. **Write into the source folder.** Polish the text into general wording per `docs/authoring.md` and write it into `rules/<stack>/` or `skills/`.
   - Remove project names, script paths, ports and people's names.
   - Keep the order rule → Why → How to apply. If the original has no Why, ask the user; do not invent one.
   - Split files that pass 200 lines.
   - Put `load` in the frontmatter at the top of each new guideline file, and `when` too for `reference` (`docs/authoring.md` "Load — always and reference"). When adding a section to an existing file whose load differs from the section's, put the section in another file.
   - For "Overrides another stack", write the overriding section in a `load: always` file of the narrow stack and add a row to the `## Overrides of other stacks` table in that stack's `README.md` (`docs/authoring.md` "Overriding another stack"). Do not write anything in the broad stack's file that points at the narrow stack.
   - Write subagents as `agents/<name>.md`. Keep only `name`, `description`, `tools` and `model` in the frontmatter, and wrap values containing `: ` in double quotes. When uploading from a Codex `.toml`, move `developer_instructions` into the body.
   - Write MCP servers as `mcp/<name>/server.json` and `README.md`, using variable references as the MCP section of `docs/authoring.md` says. From Codex settings, `env_vars = ["X"]` becomes `"X": "${X}"` in `env`, `bearer_token_env_var = "X"` becomes `"Authorization": "Bearer ${X}"` in `headers`, `"H" = "X"` in `env_http_headers` becomes `"H": "${X}"` in `headers`, and `http_headers` become fixed values in `headers`.
   - For an MCP server built from its README because its values differ per project, do not write `server.json`; write a `## Build on apply` section in `README.md` (`docs/authoring.md` "Servers built when applied"). Do not invent where the value is read from or how it is extracted. If you cannot confirm where the value came from in this project, ask the user.
   - When done, run `guideline list <source folder>` and check that the files you wrote are not under `Ignored` or `warning` (load and override warnings included). Fix them, or tell the user about ones to leave as they are (like fixed-value warnings). For MCP servers built from README, check that the `MCP` section shows `built from README when applied`.

6. **Upload.** First show the changes, the diffs and whether sending applies directly or creates a proposal with `guideline propose --from <source folder> --dry-run`, and upload once the user agrees. With an `admin` scope token, add `--review` if the user wants a review.

```bash
guideline propose --from <source folder> --title "rules: add <topic> to the <stack> stack" --message "<body>"
```

   In the body, list the origin (`<project>` `<file>` "<section title>") and what you changed to generalize it, one line each. For subagents or MCP servers, use titles like `agents: add <name>` or `mcp: add <name>` and list the needed environment variable names in the body (never values). If it became a proposal, report its number and address; once an admin reviews and accepts it under "Proposals" on the web, it becomes source. If it was applied directly ("Applied: r<number>"), report the revision number. Either way, each project receives it with `guideline update`.

## Rules

- **Do not cast a wide net.** Do not filter by how many projects use it — a stack is also the common guidance for new projects. Keep as project-specific only sections you cannot be sure hold in every project using that stack (ones that depend on a specific project's choices or environment).
- Put **section titles as they are** in the tables; do not summarize them.
- Do not upload sections the user did not choose.
- **Do not change this project's files.** Whether to remove uploaded sections from this project is decided with the user later, when `guideline-sync` flags them as duplicates.
- Never write the source folder's files to the server any other way. Always upload with `guideline propose --from`.
- **Do not carry secrets.** Replace tokens, passwords and keys hard-coded in project settings with `${VARIABLE}` references before uploading. Never copy such a value into source folder files, chat output, report tables or the proposal body. In tables, give only the location, like "`env.DB_PASSWORD` has a hard-coded value".
- Do not invent how to obtain values in an MCP `README.md`. If you do not know, ask the user.
- An MCP server with a token hard-coded in `args` or `url` cannot be turned into a reference (and `list` does not catch it). Check the server's docs for whether it accepts the same value as an environment variable, and move it to `env`. If not, do not upload it; keep it project-specific and tell the user.
