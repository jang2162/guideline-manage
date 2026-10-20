**English** | [한국어](../../ko/how-to/back-up-and-restore.md)

# Back up and restore the server

This guide explains the server's automatic backups and how to restore one.
It is for the person who runs the guideline server.

## Automatic backups

- At startup and every 24 hours after, the server writes `backups/guideline-<YYYYMMDD-HHmmss>.db` (UTC) in the data folder.
- It deletes automatic backups beyond `BACKUP_KEEP` (default 14).
- Before a schema upgrade it also writes `backups/guideline-pre-v<version>-<time>.db`. These are never deleted automatically.

## Download guidelines

- **Download block (.tar.gz)** on a block page gives that block in the source layout.
- `GET /api/v1/archive` gives the whole source. The CLI uses this.

## Restore a backup

1. Stop the server.

   ```bash
   docker compose stop
   ```

2. On the server, copy the backup over the DB, then delete `guideline.db-wal` and `guideline.db-shm`.

   ```bash
   cp <DATA_HOST_DIR>/backups/<backup>.db <DATA_HOST_DIR>/guideline.db
   rm -f <DATA_HOST_DIR>/guideline.db-wal <DATA_HOST_DIR>/guideline.db-shm
   ```

3. Start the server.

   ```bash
   docker compose start
   ```

## Next

- [Upgrade the server and the CLI](upgrade.md)
- [Server environment variables](../configuration.md#server-environment-variables)
