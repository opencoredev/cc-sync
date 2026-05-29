# ccsync

ccsync is a Bun CLI, daemon, OpenTUI console, and Convex backend for syncing AI coding-agent skills and MCP server configuration across machines.

The default model is simple: sign in once with GitHub, create a CLI token, run `ccsync init` on each machine, then leave `ccsync daemon start` running.

## Quick Start

Install from Homebrew:

```bash
brew tap opencoredev/cc-sync https://github.com/opencoredev/cc-sync
brew install --HEAD opencoredev/cc-sync/ccsync
```

Open the account page, sign in with GitHub, and create a CLI token:

```txt
https://cc-sync.dev
```

Then connect the machine:

```bash
ccsync init
ccsync daemon start
```

Full docs:

```txt
https://cc-sync.dev/docs
```

## What Syncs

- Registry skill references by agent/name/ID.
- Explicit custom skill content.
- MCP server definitions from global user-level config files.
- Device presence, sync health, and manifest revisions.

ccsync only targets user-level/global agent setup. It does not sync project-level config.

## Supported Agents

The scanner is adapter-based and currently checks Claude Code, Cursor, Codex CLI, OpenCode, Windsurf, Cline, Roo Code, Continue, Aider, Gemini CLI, Qwen Code, Amp, and Kiro.

## Repo Structure

```txt
apps/cli                 Bun CLI, daemon, scanner, apply engine, OpenTUI console
apps/web                 GitHub auth/account screen for CLI token issuing
packages/backend/convex  Convex schema, Better Auth integration, sync functions
packages/ui              Shared shadcn primitives for the web account page
```

## Local Development

```bash
bun install
```

Build the CLI binary locally:

```bash
bun run cli:build
```

During development, run the CLI directly:

```bash
bun run cli -- --help
bun run cli -- status
bun run cli -- scan
```

## Convex and Auth Setup

Create/configure the Convex project:

```bash
bun run dev:setup
```

Set backend env vars in Convex:

```txt
SITE_URL=https://your-ccsync-web-url
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Set web env vars in `apps/web/.env`:

```txt
VITE_CONVEX_URL=https://elated-rat-35.convex.cloud
VITE_CONVEX_SITE_URL=https://elated-rat-35.convex.site
```

Then run the web app and backend when developing:

```bash
bun run dev
```

Use the web account page to sign in with GitHub and create a CLI token.

## CLI Usage

```bash
ccsync init
ccsync status
ccsync daemon start
ccsync daemon pause
ccsync daemon resume
ccsync tui
ccsync push
ccsync pull
```

`ccsync init` stores local config at `~/.config/ccsync/config.json` with mode `0600`. The hosted Convex backend and web account URL are the defaults. The raw CLI token is not stored; the CLI stores its SHA-256 hash, which acts as the daemon credential.

## Custom Skills

Installed/global skills sync as lightweight references by default to keep manifests tiny. To sync actual skill file contents, mark the skill as custom with one of these:

- Put it under a `custom-skills` directory.
- Add an empty `.ccsync-custom` file in the skill root.
- Add `ccsync: custom` to the skill `SKILL.md`.

## Daemon Behavior

The daemon uses `fs.watch` on detected global agent paths, then debounces local pushes for 20 seconds by default. It also polls Convex every 60 seconds for remote revisions and applies newer manifests locally. Last write wins for the MVP, with command output showing what was created, updated, skipped, or failed.

## Validation

Useful local checks:

```bash
bun run --cwd apps/cli check-types
bun run --cwd apps/web build
bunx convex codegen --typecheck=enable
bun run check-types
```
