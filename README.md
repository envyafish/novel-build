# Novel Build

AI-assisted novel writing, local-first.

## Requirements

- Node 22.5+ (uses built-in `node:sqlite` behind `--experimental-sqlite`).
  Tested on Node 25.
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.0.0 --activate`)

## Quick start

```bash
pnpm install
pnpm dev
```

This starts the Fastify server on `127.0.0.1:4317` and Vite on `5173`. Open http://127.0.0.1:5173.

## Configuration

AI providers live in `~/.novel/config.json` (created with mode 0600):

```json
{
  "providers": [
    { "id": "openai", "label": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-..." }
  ],
  "defaultProviderId": "openai"
}
```

If no provider is configured, the app uses a `fake` provider that returns the string `FAKE-RESPONSE` — useful for development.

## Project storage

Each project lives under `~/Novels/<slug>/`:

```
~/Novels/<slug>/
├── novel.db            (SQLite, project metadata — actually shared in index.db at ~/.novel/)
├── manuscripts/<vol-slug>/<chap-slug>/<scene-slug>.md
└── .snapshots/<sha256>.md.z    (zlib-compressed, content-addressed)
```

The web front-end is a Vite + React + TipTap SPA bound to localhost; API keys are server-side only and never reach the browser.

## Layout

```
apps/server    Fastify + node:sqlite
apps/web       Vite + React + TipTap
packages/shared shared TS types + prompts
```

## Tests

```bash
pnpm -r test         # vitest across all packages
pnpm --filter @novel/web test:e2e   # Playwright (requires server running)
```

## Scope

This is **v0** of an AI novel-writing tool. Out of scope for v0:

- Character / worldbuilding / timeline databases
- AI consistency checks
- Collaboration
- Cross-device sync
- Publish / export
- Desktop packaging
- Snapshot diff UI
