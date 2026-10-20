**English** | [한국어](../../ko/how-to/override-guidelines.md)

# Override a guideline in one project

This guide changes how one project follows a received guideline without editing the copy.
It is for CLI users whose project needs a different rule from the shared one.

Do not edit the received copies. Write an **override** instead.
Overrides belong to the project, and `update` never touches them.

1. Create the override file in one of these places.
   - `.ruler/<stack>/override.md`
   - `.ruler/<stack>/override.d/*.md`
2. Start each override section with a line that says what it overrides.

   ```markdown
   ## base project overrides

   ### Commit messages in English

   Overrides: `base/01-git.md` "Commit messages"

   This project has outside contributors, so commit messages are written in English.
   ```

3. To override a whole file, drop the quoted section title from that line.

If the overridden file or section disappears from the source, you get an `override` to-do.

## Next

- [Propose changes to the source](propose-changes.md)
- [Markers in guidelines](../reference.md#markers-in-guidelines)
