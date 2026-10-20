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
