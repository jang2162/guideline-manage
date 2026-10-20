# Contributing to guideline-manage

Issues and pull requests are welcome.
This page explains how to run the code, how the repository is laid out, how documentation is kept, and how releases are made.

## Development

You need Node 24 or later and pnpm.

```bash
pnpm install
pnpm test                                # node --test. Tests run with GUIDELINE_LANG=ko
node cli/bin/guideline.js help
ADMIN_TOKEN=$(openssl rand -base64 48) PUBLIC_URL=http://localhost:3000 DATA_DIR=./.data node server/bin/guideline-server.js   # server
```

- Use pnpm. Do not create `package-lock.json`.
- The CLI has no runtime dependencies. Keep it that way.
- Every user-facing string goes through `t()` with a key in `locales/en/messages.json` (canonical). Add the Korean text to `locales/ko/messages.json` too.

## Layout

| Path | Contents |
| --- | --- |
| `cli/` | The `guideline` command. `cli/src/i18n.js` reads the language setting and language packs |
| `locales/` | Language packs: `en` (canonical) and `ko`. `messages.json` strings and `templates/` long texts (management guideline, authoring rules, seed skills, llms.txt, new-file templates) |
| `server/` | The guideline server. `server/src/` server code (`web/` admin pages), `server/static/` page CSS and JS, `server/Dockerfile`. Not part of the npm package |
| `compose.yaml` | Guideline server deployment with Docker Compose. Environment variables in `.env.example` |
| `.github/workflows/` | CI (tests) and release (npm publish) |
| `docs/manual/` | User documentation. English in `docs/manual/en/`, Korean in `docs/manual/ko/`, images in `docs/manual/images/` |
| `CHANGELOG.md` | Changes per version |

## Documentation

- English is the source. `README.ko.md` and `docs/manual/ko/` are translations with the same file names, structure and section order.
- Change the Korean copy in the same pull request as the English one. If you cannot, open an issue with the `translation` label.
- Each translation starts with `<!-- source: <source path> @ v<version> -->`. Update the version when you bring the translation up to date.
- Record user-visible changes under `Unreleased` in `CHANGELOG.md`.
- `CHANGELOG.md` and `CONTRIBUTING.md` are English only.

## Versioning

- Command behavior or skill procedures change: minor
- Anything else: patch

Until `1.0.0`, breaking changes also bump the minor version.

## Releases

GitHub Actions publishes to npm. Do not run `pnpm publish` locally.

```bash
pnpm version minor            # or patch, major. Creates the commit and the v<version> tag
git push --follow-tags        # the tag starts the release workflow
```

A `v<SemVer>` tag runs `.github/workflows/release.yml`.
It checks that the tag matches `package.json`, runs `pnpm test`, and publishes with provenance.
It uses npm Trusted Publishing, so no token is stored: the npm package trusts `jang2162/guideline-manage` and `release.yml`.
Pull requests and pushes to main run only the tests (`ci.yml`).

Before a release, move the `Unreleased` entries in `CHANGELOG.md` under the new version.
