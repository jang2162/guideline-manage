**English** | [한국어](../../ko/how-to/create-a-project.md)

# Create a new project with guidelines

This guide creates a new project folder and applies guidelines to it in one step.
It is for CLI users starting a project from scratch.

1. Run `pick` with `--new` and a name or a path.

   ```bash
   guideline pick --new my-new-app    # GUIDELINE_PROJECTS_DIR/my-new-app
   guideline pick --new ~/work/x      # a path works too (absolute or ~)
   ```

2. At the top of the form, choose the agents: claude, codex, opencode. The project always uses ruler.
3. Choose guidelines and submit, as in [Getting started](../getting-started.md#4-choose-guidelines-for-a-project).

Submitting creates the folder, runs `git init` and applies the choice.
Cancelling leaves no folder behind.

## Next

- [Stay up to date](stay-up-to-date.md)
- [Hand guidelines to an agent](hand-off-to-an-agent.md)
