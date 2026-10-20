**English** | [한국어](../../ko/how-to/hand-off-to-an-agent.md)

# Hand guidelines to an agent

This guide lets a coding agent choose, receive and update guidelines and handle the to-dos.
It is for CLI users who work with Claude Code, Codex or another agent.

## With the guideline-sync skill

Projects that received guidelines also get the `guideline-sync` skill, if you chose it.
Tell the agent "update the guidelines" or "export guidelines".
The skill calls `status`, `update` or `pick` and handles the to-dos.

## Without the skill

For projects without the skill, or for other agents, say "read `http://localhost:3000/llms.txt` and get the guidelines".
`llms.txt` explains how to handle each kind of to-do.

## Let the agent recommend blocks

Ask an agent to "get the right guidelines".
It chooses blocks and opens the form with `guideline pick --recommend`.
Recommended items carry **Agent pick** and a reason.
Review them and submit.

`--recommend` takes one source at a time and needs a 0.19 or later server. See [Project commands](../reference.md#project-commands).

## Next

- [Stay up to date](stay-up-to-date.md)
- [Propose changes to the source](propose-changes.md)
