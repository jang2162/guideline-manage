**English** | [한국어](../../ko/how-to/upgrade.md)

# Upgrade the server and the CLI

This guide upgrades the guideline server and the `guideline` CLI and lists the manual steps some versions need.
It is for server operators and CLI users moving to a newer release. What changed in each version is in [CHANGELOG.md](../../../../CHANGELOG.md).

## Upgrade the server

1. Check out the new release.

   ```bash
   git pull                    # or: git checkout v<version>
   ```

2. Rebuild and restart.

   ```bash
   docker compose up -d --build
   ```

The server upgrades the DB schema at startup.
Before it does, it writes `backups/guideline-pre-v<version>-<time>.db`, which is never deleted automatically.
If it does not start, see [Troubleshooting](../troubleshooting.md#the-server-does-not-start).

## Upgrade the CLI

```bash
npm install -g guideline-manage
```

- A server rejects a CLI older than 0.12.0 with "The CLI is too old — upgrade guideline-manage".
- Fetching from a public server without a token needs CLI 0.16 or later. The 0.15 CLI stops before asking the server when it has no token.
- A 0.20 or later CLI works with an older server. `whoami` returns 404 there, so `guideline propose` sends proposals as before, and `status` and `login` show no token scope. An older CLI on a 0.20 server behaves as before.

## Update the seed on a running server

The `guideline-sync` and `guideline-export` skills and the authoring rules (`docs/authoring.md`) are a seed.
The server writes them only when it first starts on an empty DB.
A server that was started before the versions below keeps the old text, so update it by hand on the web.
`llms.txt` is rebuilt per request and changes right away.

> [!WARNING]
> **Servers started before 0.19:** add the "Recommend and receive" section to the `guideline-sync` skill and the "Required blocks" section to the authoring rules. Copy them from the same files under the language pack's `templates/`.

> [!WARNING]
> **Servers started before 0.20:** step 2 of the `guideline-export` skill says to use `--apply` only when the user asks to skip review. Rewrite it to say that with an `admin` token `guideline propose` applies directly and `--review` asks for a review. See the language pack's `templates/skills/guideline-export/SKILL.md`. Change the "send an edited copy upstream" row of `guideline-sync` the same way.

> [!WARNING]
> **Servers started before 0.21:** the `guideline-sync` skill does not handle the `missing-requires` to-do. In its "Handling to-dos" section, add `status` to the first line and add the `missing-requires` row. Copy them from the language pack's `templates/skills/guideline-sync/SKILL.md`.

## Next

- [Back up and restore the server](back-up-and-restore.md)
- [Troubleshooting](../troubleshooting.md)
