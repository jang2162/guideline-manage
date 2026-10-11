# Rules for writing guidelines in this source

## Where things go

| Content | Location |
| --- | --- |
| Rules that hold for one stack (a group that shares guidelines) | `rules/<stack>/` |
| A procedure used by several projects | `skills/<name>/SKILL.md` |
| A subagent used by several projects | `agents/<name>.md` |
| An MCP server used by several projects | `mcp/<name>/server.json`, `mcp/<name>/README.md`. Only `README.md` when values differ per project |
| One stack overriding a section of another stack in a specific environment | the `## Overrides of other stacks` table in the overriding stack's `rules/<stack>/README.md` (→ "Overriding another stack") |
| Categories for picking items together | `categories` in each item's frontmatter (→ "Categories") |
| A display name people can read | `label` in each block's frontmatter (→ "Display name") |
| Blocks that must come along | `requires` in each block's frontmatter (→ "Required blocks") |
| Setup done when a stack is adopted or on every clone | `rules/<stack>/SETUP.md` (→ "Setup docs") |
| A rule that holds in only one project | Not here. Keep it in that project's own guidelines |

A stack is not a "language" but **a unit that actually shares guidelines**. Name a group built on your own framework after that group, not `java-spring`. Rules that hold in every project also live in one such stack (for example `base`). The tool treats no stack specially.

## File rules

- One file = one topic. Split it when it passes 200 lines.
- Name it `NN-<topic>.md`. The topic uses lowercase letters, digits and `-`. The number is `00`–`99` and only orders files within the stack.
- The number is the order in which the guidelines go into a project. `guideline list` and the CLI recognize guideline files by this name.
- **Do not put project-specific names in a guideline file.** If a script, package, class, column or port name gets in, that section moves down to a narrower stack or stays in the project.
- A stack file holds only what is true in **every** project of that stack. Lists that differ per project (encrypted columns and so on) keep only the pattern.

## Load — always and reference

Every guideline file states its load in the frontmatter at the top. When applied to a project, `always` goes where it is read every session, and `reference` is kept aside and pointed at from an index by "when to read it".

```markdown
---
load: reference
when: "when the browser MCP server does not connect, or when asking a worker to check something in a browser"
---

# When the browser server does not connect
```

- `load` is `always` or `reference` and is **required**.
- `when` is **required** for `reference` and not used with `always`. Write the moment in the work when the file must be read ("when ..."). Write the task ("when checking a screen in the browser"), not the topic ("browser").
- Keep values on one line, and wrap a value in double quotes when it contains `: ` (same as subagent frontmatter).
- **How to choose:** if the moment when missing the rule causes an accident can come during any task, it is `always`; if it comes only during specific tasks, it is `reference`.
- If one file mixes `always` and `reference` sections, split the file. Load is per file.
- A stack whose files are all `reference` is fine.

- **Why:** with a default for missing loads, a file whose load was forgotten is silently injected as always-on and weighs down the context of every session.
- **How to apply:** after writing, check that the file is not in the `warning` section of `guideline list <source folder>`. The `Stacks` section shows the load and `when` next to each file.

## Overriding another stack

The default for a topic belongs to the broad stack (for example `base`). Changing it in a specific environment belongs to the narrow stack (for example `orca`), which declares it in a table in its `README.md`.

```markdown
## Overrides of other stacks

| This stack's section | Overridden section |
| --- | --- |
| `05-switch.md` "When Orca is running, create worktrees with Orca too" | `base/01-git.md` "Create worktrees inside the repository, one per task" |
```

- A cell is `` `<file>` "<## section title>" ``. This stack's side gives only the file name; the overridden side gives `<stack>/<file>`. Copy the section title after `## ` exactly.
- Overriding only part of it is fine. The overriding section's body says what it replaces and what still applies.
- **A broad stack never points at a narrow stack.** Projects that did not receive the narrow stack would be left with text pointing at a stack they do not have.
- If the same topic differs with no environment condition, that is not an override but a contradiction in the source. Fix one side.

**Put overriding sections in `load: always` files.**

- **Why:** the overridden section is always-on, so the agent sees it every turn; if the overriding section is `reference`, nothing prompts the agent to read it and it follows the broad stack.
- **How to apply:** keep overriding sections short — the switching condition, what is replaced and what still applies, and a `reference` file with the procedure. After writing, check that the README is not in the `warning` section of `guideline list <source folder>` and that an `overrides` line appears under the stack.

## Categories

To let people pick items together by category in the export form, add `categories` to the frontmatter.

```markdown
---
categories: [backend, spring]
---
```

| Item | Where |
| --- | --- |
| Stack | frontmatter of `rules/<stack>/README.md`. Every guideline file in the stack inherits it |
| Guideline file | that file's frontmatter (next to `load`). Added to the stack's categories |
| Skill | frontmatter of `skills/<name>/SKILL.md` |
| Subagent | frontmatter of `agents/<name>.md` |
| MCP server | frontmatter of `mcp/<name>/README.md`. Not in `server.json` — it is copied into projects as is |

- Write the value on one line as `[a, b]`. Quote a name that contains `,`. Multi-line lists (`- a`) are not read.
- Mostly tag stacks, and tag individual files only where they diverge within a stack.

- **Why:** a malformed category is silently dropped, and the item is then missed when picking by category.
- **How to apply:** after tagging, check that `[…]` appears next to the name in `guideline list <source folder>` and that the file is not in the `warning` section.

## Display name

When a block name (`deploy-agent__deploy.kbrainc.dev`) is a tool name that says little, add `label` to the frontmatter. The web, the export form and `guideline list` show it next to the real name.

```markdown
---
label: Internal dev server deploy
---
```

- It goes where the block rows of the "Categories" table say (stack README, `SKILL.md`, subagent file, MCP README). Not on guideline files.
- One line. Quote it with double quotes when it contains `: `.
- Only the shown name changes. The folder name, the project's `.ruler/<stack>/` and the name CLI commands take stay the same. It differs from source aliases (`aliases` in `guideline.json`), which change the folder name inside projects.

- **Why:** people cannot tell what a rule set is from its name, so they skip it or pick the wrong one.
- **How to apply:** after adding it, check that `guideline list <source folder>` shows the display name right after the name.

## Required blocks

When a block does not work properly without another block, add `requires` to its frontmatter. Picking it in the export form checks the required blocks too.

```markdown
---
requires: [rules/browseros-neo]
---
```

- It goes where the block rows of the "Categories" table say. Not on guideline files.
- One-line list of block keys: `rules/<stack>`, `skills/<name>`, `agents/<name>.md`, `mcp/<name>`. Only blocks in the same source.
- Example: the `playwright-neo` MCP server needs the `browseros-neo` guidelines on how to connect; the `orca-worker` skill needs the `orca` guidelines.

- **Why:** receiving a tool without the rules for using it makes agents use the tool wrongly.
- **How to apply:** after adding it, check that the block shows up in the `requires` map of `guideline list --json` and that the `warning` section has no "not in the source" line.

## Setup docs

Setup that must be done when adopting a stack or on every clone (config files, hook installation, environment variables) goes in `rules/<stack>/SETUP.md`, not in a guideline file. It is not read every session; applying copies it to the project's `docs/guideline/<stack>/SETUP.md`, and the project's management guideline tells agents to read it when setting up.

```markdown
# <stack> setup

## Check

<how to tell it is already set up: files, commands>

## Setup

1. <step>
```

- No frontmatter.
- A stack with only `SETUP.md` and `README.md` is a skeleton and does not appear in `guideline list`.
- No secrets here either. Write only environment variable names and how to obtain them.

- **Why:** one-time setup steps written in a guideline file would ride along in the context of every session.
- **How to apply:** after writing, check that `setup doc` appears on the stack's line in `guideline list <source folder>`.

## Section format

```markdown
## <the rule in one sentence>

<rule body: what to do / not do>

- **Why:** <what silently breaks if it is ignored>
- **How to apply:** <concrete actions; commands go in a code block>
```

Do not invent a Why. If you do not know the reason, hold off on adding the rule.

## Domain stacks

The same tool can need different rules on different servers (companies, instances). Then name the stack `<tool>__<domain>`. Examples: `deploy-package__gitlab.develma.com`, `deploy-agent__deploy.kbrainc.dev`.

- Use `__` once. The part after it must look like a domain (lowercase letters, digits, `-`, and at least one dot). Otherwise `guideline list` shows a warning (the stack still works).
- The web shows the tool name with the domain as a tag. Project paths (`.ruler/<stack>/`) and CLI output keep the full name.

## Skeleton stacks

A `rules/<stack>/` with only `README.md` is a skeleton and does not appear in `guideline list`. It becomes a stack the moment its first guideline file (`NN-*.md`) is added.

## Skills

Put skills in `skills/<name>/SKILL.md`. Use only the two frontmatter fields `name` and `description`, each on one line (agents support different fields). Make `name` equal to the directory name. Only procedures that need judgment become skills.

## Subagents

Put subagents in `agents/<name>.md`, with no subdirectories. The format matches ruler's `.ruler/agents/` source format, so they go into ruler projects as is.

```markdown
---
name: code-reviewer
description: Reviews the diff read-only after implementation is done.
tools: [Read, Grep, Glob, Bash]
model: inherit
---

# Code Reviewer

<instructions for the subagent>
```

- Use only `name`, `description` (required), `tools` and `model` (optional) in the frontmatter. Keep `name` and `description` on one line, and wrap a value in double quotes when it contains `: `. Unquoted, YAML cannot read it, ruler drops it, and `guideline list` ignores it.
- Make `name` equal to the file name. Otherwise `guideline list` ignores it.
- In `description`, say when to delegate to this subagent.
- Write `tools` with Claude tool names (`Read`, `Grep`, `Bash` …). They are translated for other agents when applied.

## MCP servers

Put `server.json` and `README.md` in `mcp/<name>/`. The server name is the directory name. A server whose values differ per project and cannot be fixed in the source has only `README.md`, no `server.json` (→ "Servers built when applied").

### No secrets

Do not keep tokens, passwords or API keys in this source. Use only `${VARIABLE}` references, and only in two places.

- `env` values: the whole value is a reference with the same name as the key. `"DB_PASSWORD": "${DB_PASSWORD}"`
- `headers` values: the whole value is a reference `"${X}"`. Only the `Authorization` header may also use `"Bearer ${X}"`.

No references and no tokens in `command`, `args` or `url` (query strings included).

- **Why:** this source spreads to many projects. Also, Codex does not expand `${…}`, so only references in those two places can be carried over to Codex's `env_vars`, `bearer_token_env_var` and `env_http_headers`.
- **How to apply:** after writing, check that the server is not in the `warning` section of `guideline list <source folder>`. Non-secret fixed values (`LOG_LEVEL` and so on) also get a warning; leave those as they are.

### server.json

Same shape as one entry of `mcpServers` in `.mcp.json`.

```json
{ "type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"] }
```

```json
{
  "type": "http",
  "url": "https://gitlab.example.com/api/v4/mcp",
  "headers": { "Authorization": "Bearer ${GITLAB_TOKEN}" }
}
```

- `type` is `stdio` or `http` and is always written.
- stdio uses `command` (required), `args`, `env`; http uses `url` (required) and `headers`.

### README.md

- What the server does, and which stacks and projects it fits
- Each environment variable it needs and how to obtain and set it

Do not invent how to obtain a value. If you do not know, hold off on adding the server.

### Servers built when applied

Instead of `server.json`, write how to build the entry in the `## Build on apply` section of `README.md`. The applying agent builds the entry in the target project following that section, then applies it the same way as a server with `server.json`.

Use this only when both of these hold.

- The non-secret values of `url`, `command`, `args`, or of `env`/`headers` differ per project.
- The value can be found inside the project. For example, the GitLab host from `git remote get-url origin`.

Values a person supplies through an environment variable, like tokens, go in `server.json` as `${VARIABLE}` as usual.

What to write in the `## Build on apply` section:

- Where the value is read from (a command or a file)
- How to extract it, and for each form the value can take (SSH and HTTPS remotes and so on)
- The shape of the entry to build, with the same fields as `server.json` and placeholders such as `<web address>`
- When to ask the user: the value cannot be read, there are several candidates (several remotes and so on), or it is unclear whether the extracted value fits this server

```markdown
## Build on apply

1. Read `git remote get-url origin` in the target project.
2. Extract the web address. If it starts with `https://`, keep the scheme, host and port and drop only user info (`…@`) and the path — that port is the web port. For `git@<host>:<path>` or `ssh://` forms, use `https://<host>` — any port there is the SSH port, so drop it.
3. Build this entry: `{ "type": "http", "url": "<web address>/api/v4/mcp" }`
4. Ask the user when there is no `origin`, several remotes, or the host does not look like GitLab (github.com and so on).
```

- "No secrets" applies to built entries too. If the value read contains user info or a token (`https://<user>:<token>@…`), drop it, and never write steps that read a token into the entry.
- Write the section title exactly. With neither `server.json` nor this section, `guideline list` treats `server.json` as missing and ignores the server. An empty section is ignored too.
- Do not keep `server.json` and this section together. It is ambiguous which to use, and `guideline list` warns.

- **Why:** fixing one project's value in the source spreads a wrong value to projects that use a different one. The section also tells this case apart from a `server.json` that was accidentally left out.
- **How to apply:** after writing, check that the `MCP` section of `guideline list <source folder>` shows it as `built from README when applied`. Without `server.json` it does not get the secret check in the `warning` section, so check the entry shape in the section for secrets yourself.

## Reaching projects

Accepting a change updates the source. It reaches a project only when someone runs `guideline update` (or `guideline pick`) in that project. Do not report that a project has it just because the change was accepted.

## Management guideline additions

`docs/management.md` holds operating rules added to the management guideline (`.ruler/guideline.md`) of **every project** that receives guidelines from this source. For example: "propose company guidelines only after a security review", "set up deployment stacks together with the infrastructure owner".

- It is appended to the end of the project's management guideline as a `## <source name> additional guidelines` section, only in projects that received at least one item from this source.
- Do not use a `#` heading; start from `##`. When appended, `##` moves down one level to `###`.
- After a change, each project receives it with `guideline update`. Change it like any other source file, by editing on the web or with a proposal.
