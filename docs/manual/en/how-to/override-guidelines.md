**English** | [한국어](../../ko/how-to/override-guidelines.md)

# Override a guideline in one project

This guide changes how one project follows a received guideline without editing the copy.
It is for CLI users whose project needs a different rule from the shared one.

Do not edit the received copies. Write an **override** instead.
Overrides belong to the project, and `update` never touches them.

1. Create the override file in one of these places.
   - `.guideline/overrides/<stack path>/override.md`
   - `.guideline/overrides/<stack path>/override.d/*.md`
2. Start each override section with a line that says what it overrides.

   ```markdown
   ## base project overrides

   ### Commit messages in English

   Overrides: `base/01-git.md` "Commit messages"

   This project has outside contributors, so commit messages are written in English.
   ```

3. To override a whole file, drop the quoted section title from that line.

For a child stack, use its own folder: `.guideline/overrides/<parent>/<child>/override.md`.
`guideline apply` copies the overrides of the chosen stacks into the generated `.ruler/<stack>/` folders, where ruler reads them.
An override for a stack that is not chosen is not composed and leaves an `override-unchosen` to-do.

Do not put project files inside a received stack folder (`.guideline/rules/<stack>/`), sub-folders included, or inside the generated `.ruler/<stack>/` folders.
`.guideline/rules/<stack>/` belongs to the source, so a file or sub-folder that is not in the source shows up as removed from the source, and the generated folders are overwritten by `guideline apply`.
Keep project-only rules in an override, or in `.ruler/*.md` (for example `.ruler/50-project.md`).

If the overridden file or section disappears from the source, you get an `override` to-do.

## Next

- [Propose changes to the source](propose-changes.md)
- [Markers in guidelines](../reference.md#markers-in-guidelines)
