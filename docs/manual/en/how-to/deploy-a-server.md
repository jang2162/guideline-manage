**English** | [한국어](../../ko/how-to/deploy-a-server.md)

# Deploy a guideline server

This guide deploys the guideline server (`guideline-server`) with Docker Compose and fills it with guidelines.
It is for the person who runs the server for a team.

## Deploy with Docker Compose

`compose.yaml` at the repository root builds the server image from `server/Dockerfile`.
It keeps the data in `DATA_HOST_DIR`.

```bash
git clone https://github.com/jang2162/guideline-manage.git
cd guideline-manage
cp .env.example .env
```

Fill in `.env` as described in [Server environment variables](../configuration.md#server-environment-variables).

1. Create `DATA_HOST_DIR` on the server and give it to uid 1000.

   ```bash
   sudo chown 1000:1000 <DATA_HOST_DIR>
   ```

2. Create an admin token and put it in `.env` as `ADMIN_TOKEN`.

   ```bash
   openssl rand -base64 48
   ```

3. Build and start the server.

   ```bash
   docker compose up -d --build
   ```

   The log (`docker compose logs`) shows `guideline-server listening on port 3000`. On an empty DB it also shows `seeded the empty server with <language> guidelines (r1)`.
4. Open `PUBLIC_URL`. Anyone can browse guidelines and history and download them without logging in (with `PUBLIC_READ=0`, a login is required). To edit, revert, review proposals or manage tokens, select **Log in** at the top (`/login`) and enter the admin token.

Leave TLS and the reverse proxy to the server's existing setup.
Behind a single reverse proxy, set `TRUST_PROXY=1`.

If the server does not start, the first log line is the reason. See [Troubleshooting](../troubleshooting.md#the-server-does-not-start).

### Deploy from a Git repository

Tools that deploy a Compose file straight from a Git repository work the same way.
For example, a Komodo Git Repo Stack takes `compose.yaml` as its file path and the variables in `.env.example` as its environment.
Turn off automatic redeploys on push: commits that only change the CLI would rebuild the server too.

## Fill in guidelines

A new server holds only the seed: the authoring rules `docs/authoring.md` and the seed skills `guideline-sync` and `guideline-export`.
Add guidelines in one of these ways.

- **On the web:** add a block from a list (**+ Add stack** and so on), then use **New file** on the block page.
- **Through the API:** upload many files at once to the proposals API with the admin token and `apply: true`. One request takes up to 500 changes and 20 MB.

  ```bash
  curl -s -X POST http://localhost:3000/api/v1/proposals \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d '{"title":"first fill","apply":true,"changes":[{"path":"rules/base/00-agent.md","text":"---\nload: always\n---\n\n# Agent\n","base":null}]}'
  ```

- **From an old guideline repository clone:** start an empty server with `GUIDELINE_SEED=off` first, so its files do not clash with the seed. Then upload the clone's `rules/`, `skills/`, `agents/`, `mcp/` and `docs/authoring.md` through the API as above.

The authoring rules that the source must follow are in the server's `docs/authoring.md`.

## Run the server locally with Docker

```bash
cp .env.example .env    # fill in ADMIN_TOKEN, PUBLIC_URL=http://localhost:3000, DATA_HOST_DIR
docker compose up --build
```

To run without Docker, see [Getting started](../getting-started.md#2-start-a-guideline-server).

## Next

- [Upgrade the server and the CLI](upgrade.md)
- [Back up and restore the server](back-up-and-restore.md)
- [Server environment variables](../configuration.md#server-environment-variables)
