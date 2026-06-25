# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`novel-build` is a **local-first, AI-assisted novel-writing app**. Single author, single machine, files readable by external editors (VS Code, Obsidian). v0 scope is editor + AI generation; the v0 design spec is at `docs/superpowers/specs/2026-06-18-ai-novel-builder-v0-design.md` and the bug/edge-case catalog is at `docs/business-logic.md` — **read these before making non-trivial changes**.

## Requirements

- **Node 22.5+** (uses `node:sqlite` behind `--experimental-sqlite`). Tested on Node 25.
- **pnpm 9** (`corepack enable && corepack prepare pnpm@9.0.0 --activate`).

## Commands

All commands run from the repo root.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Dev (server + web in parallel) | `pnpm dev` |
| Build all packages | `pnpm build` |
| Typecheck all packages | `pnpm typecheck` |
| Run all tests | `pnpm test` |
| Run E2E (needs server running) | `pnpm test:e2e` |

**Run a single test file** (the dev scripts depend on per-package tsx/vm-modules flags):

```bash
# Server (uses --experimental-sqlite --import tsx)
cd apps/server
node --experimental-sqlite --import tsx ./node_modules/vitest/vitest.mjs run src/ai/openai-compatible.test.ts

# Web (uses --experimental-vm-modules)
cd apps/web
node --experimental-vm-modules ./node_modules/vitest/vitest.mjs run src/features/ai/jsonParse.test.ts
```

**Run server standalone** (useful for smoke-testing without the web UI):

```bash
cd apps/server
node --experimental-sqlite --import tsx src/server.ts
# listens on 127.0.0.1:4317 (configurable via PORT/HOST env vars)
```

**AI provider config** lives at `~/.novel/config.json` (mode 0600). If absent, the app falls back to a `fake` provider that returns `FAKE-RESPONSE` — useful when developing without burning API credits.

## Repository layout

```
apps/server        Fastify + node:sqlite, NDJSON streaming, AI provider plugins
apps/web           Vite + React 18 + TipTap (ProseMirror), TanStack Query
packages/shared    Cross-package TS types + the prompt registry (prompts.ts)
```

Three-tier outline (the "骨架"): `volumes → chapters → scenes`. Chapters carry status; scenes carry the actual prose (one `.md` file on disk per scene). Project storage layout is in `README.md` — read it before touching the manuscripts subsystem.

## Architecture essentials

### AI request lifecycle (the hot path)

`POST /api/ai/complete` (`apps/server/src/routes/ai.ts:55`) is the only AI endpoint. It:
1. Zod-validates body (`sceneId?`, `projectId?`, `mode`, `model`, `inputText`, optional `overrideMessages` + `draftId`).
2. Builds context in `apps/server/src/ai/context.ts` — pulls last-scene tail, world summary, outline summary (only for `NEEDS_OUTLINE` modes).
3. Acquires a `StreamLimiter` slot (max **2 concurrent streams**).
4. Streams NDJSON frames back; persists to `ai_drafts` row every ~200ms.
5. `projectId` is the preferred project-resolution key (server uses it directly, no scene JOIN). `sceneId` is optional — only needed for modes that pull scene-specific context (previous scene tail, scene notes, outline). Frontend always passes `projectId`.

### Prompt registry

All AI prompts live in **`packages/shared/src/prompts.ts`** as `MODE_PROMPTS: Record<CompletionMode, ModePrompt>`. Adding a new AI mode requires:
1. Adding the mode to `CompletionMode` union in `packages/shared/src/ai.ts`.
2. Adding the prompt entry in `prompts.ts`.
3. Handling it in `apps/server/src/ai/context.ts` if it needs outline/world context.
4. Updating `apps/web/src/api/client.ts` and any UI consumers.

### Manuscript save flow (the other hot path)

`apps/server/src/manuscripts/service.ts` `saveScene` is the integrity-critical path:
- **baseHash guard** (`scene.content_hash !== input.baseHash` → 422 `external_change`): the disk-vs-DB conflict detection.
- **Atomic write**: `writeManuscript` in `manuscripts/io.ts` does temp + fsync + rename, then registers a 5-second self-write window in `manuscripts/selfWriteRegistry.ts` so `diffScanner.ts` (the 60s external-scan timer in `server.ts`) doesn't false-trigger.
- **Snapshots**: auto-snapshot before writing unless `createSnapshot: false`. Content-addressed (`zlib` compressed) in `~/.novel/<project>/.snapshots/<sha256>.md.z`.
- **`force: true`** skips the baseHash guard. Used by review-apply paths. **Be careful**: it silently overwrites external edits.

### AI extraction → world DB

`apps/web/src/features/ai/autoSyncWorld.ts` runs `consistency_check` mode after every AI scene write, parses JSON, and writes new characters / world elements / timeline / foreshadows / conflicts. **Has an N+1 bug** documented in `business-logic.md` §3.3 (re-lists all entities per character).

### JSON extraction (extracted + generalized)

`apps/web/src/features/ai/jsonParse.ts` is the canonical AI-JSON extractor. Two flavors:
- `parseAiJson<T>(text)` — tolerant, returns `null` on failure (used in `WorldPanel`, `EditorPage` settings flow).
- `extractJson<T>(text)` — strict, throws (used in `StoryArcGenerator` for toast surfacing).
- `stripThinking(text)` — strips `<think>` / `<thinking>` / `<reasoning>` / `【思考】` blocks for defense-in-depth. The provider layer (`apps/server/src/ai/openai-compatible.ts`) also strips these during streaming.

Server has a mirror at `apps/server/src/util/jsonExtract.ts`.

## Conventions and gotchas

- **Route files use `// @ts-nocheck`** at the top. Fastify 4 + `@types/node` 25 + `exactOptionalPropertyTypes` produces noisy inference errors. The runtime is correct; types are deliberately relaxed in routes only.
- **TS imports use `.js` extensions** even though source is `.ts` (NodeNext ESM). Don't drop them.
- **Volumes/chapters/scenes have cascading FKs** (`ON DELETE CASCADE`). Migrations are append-only in `apps/server/src/db/migrations.ts`; **never edit a migration that's already applied** — add a new one.
- **`errors.ts` `apiError()` returns `ApiError`** for known errors; **anything else returns 500**. So e.g. SQLite UNIQUE violations look like `internal_error` to the client (logged as a bug in `business-logic.md` §6.2).
- **`StoryArcGenerator`** replaced `SkeletonGenerator` (mid-2026): uses `plan_story_arc` mode to generate story arc notes in Markdown (saved to `projects.story_arc_notes` via `PATCH /api/projects/:id/story-arc`). No JSON extraction needed — the raw AI output is the final product.
- **Memory** for cross-session context lives in `C:\Users\tunan\.claude\projects\d--projects-novel-build\memory\` on Windows. Read these before working on related areas — they often contain non-obvious project decisions.
- **Pre-existing test failures on Windows**: `world.validation.test.ts`, `outline.test.ts`, `scenes.test.ts` fail with `EBUSY: resource busy or locked, unlink '...index.db-shm'`. This is a known issue with Vitest parallel forks + SQLite temp DBs (verified on `main` HEAD without any of our changes). Not your bug unless you're touching test infra.

## Where things live (quick reference)

| Concern | File |
|---|---|
| AI streaming endpoint | `apps/server/src/routes/ai.ts` |
| AI prompts | `packages/shared/src/prompts.ts` |
| AI context builder | `apps/server/src/ai/context.ts` |
| AI providers | `apps/server/src/ai/openai-compatible.ts`, `apps/server/src/ai/registry.ts` |
| Manuscript save/restore | `apps/server/src/manuscripts/service.ts`, `apps/server/src/manuscripts/io.ts` |
| External-edit detection | `apps/server/src/manuscripts/diffScanner.ts`, `selfWriteRegistry.ts` |
| Snapshots | `apps/server/src/snapshots/store.ts`, `service.ts` |
| Outline CRUD | `apps/server/src/routes/outline.ts`, `apps/server/src/projects/repo.ts` |
| Story arc generator UI | `apps/web/src/features/editor/StoryArcGenerator.tsx` |
| World DB UI | `apps/web/src/features/world/WorldPanel.tsx` |
| Editor + AI panel | `apps/web/src/features/editor/EditorPage.tsx`, `apps/web/src/features/ai/AiPanel.tsx` |
| AI JSON parser (canonical) | `apps/web/src/features/ai/jsonParse.ts` |
| Shared types | `packages/shared/src/types.ts`, `packages/shared/src/ai.ts` |
| Bugs/edge-cases catalog | `docs/business-logic.md` |
| Design spec | `docs/superpowers/specs/2026-06-18-ai-novel-builder-v0-design.md` |