**English** | [한국어](../../ko/how-to/stay-up-to-date.md)

# Stay up to date

This guide checks whether a project's guidelines are current and brings them up to date.
It is for CLI users who have already received guidelines.

## Check and update

```bash
guideline status            # what changed?
guideline update            # same choices, latest version
guideline update --force    # also revert files edited in the project to the source
guideline pick              # to change what you chose
```

`update` skips files edited in the project and leaves a `skipped` to-do, so edits are never lost.
Edit a copy in `.guideline/`, never the generated files in `.ruler/` and `docs/guideline/`: `update` and `apply` rewrite those.
After `update` the generated files are composed again and `ruler apply` runs at the git root.

## Read the status

| State | Meaning | What to do |
| --- | --- | --- |
| current | Neither the source nor the project changed | Nothing |
| source updated | The source changed | `update` |
| edited in project | The copy was edited in the project | Send it upstream with `guideline propose`, move it to an [override](override-guidelines.md), or `update --force` |
| both changed | Both changed | Look at the diff and decide |
| missing | The copy was deleted | `update` writes it again |
| `apply` to-do (from `status`) | The generated files differ from what `.guideline/` composes: the copies or `ruler.project.toml` changed, or the generated files are missing | `guideline apply` (no server needed) |
| not applied (conflict) | It already existed and differed on first receive, so it was not written | **show diff** in `pick`, then **update** |
| removed from source | Deleted from the source | Remove it in `pick` |

When a received block needs (`requires`) a block the project has not received, `update` and `status` report a `missing-requires` to-do. Add the missing block with `guideline pick`.

## Follow stack setup docs

Stacks that need setup, for example `mise`, come with `docs/guideline/<stack>/SETUP.md`.
When it is newly received or the source changes, you get a `setup` to-do.

1. Check `## Check` in the setup doc to see whether the setup is already done.
2. If it is not, follow `## Setup`.

Anyone who freshly clones the project follows it too.
The generated copy `docs/guideline/<stack>/SETUP.md` is not in git, so run `guideline apply` first after a clone or in a new worktree (see [Getting started](../getting-started.md#6-set-up-a-fresh-clone-or-a-new-worktree)).
The received copy is also in `.guideline/rules/<stack>/SETUP.md`.

## Next

- [Override a guideline in one project](override-guidelines.md)
- [Propose changes to the source](propose-changes.md)
