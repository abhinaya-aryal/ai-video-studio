# AGENTS.md — AI Video Studio (`ai-video-web`)

Canonical instructions for coding agents working in this repository.
`CLAUDE.md` imports this file (`@AGENTS.md`), and `.gemini/settings.json` points Gemini CLI here. Do not replace these with symlinks.

## Architecture Map

Unified Next.js App Router application (local-first; all provider calls, OSS uploads, job polling, and downloads run server-side):

- `src/app/` — Next.js App Router pages, layouts, and API route handlers (`src/app/api/*`).
- `src/lib/config.ts` — Lazy `zod`-validated environment configuration (`getConfig()`) and `maskApiKey()`.
- `src/lib/storage/paths.ts` — Safe `PROJECTS_DIR` path resolution (`UnsafePathError`), slugification, project folder scaffolding, and `story.md` writer.
- `src/db/` — SQLite via `better-sqlite3` + Drizzle ORM (`${DATA_DIR}/studio.db`) and `drizzle-kit` migrations (`drizzle/`). Stores non-secret project, element, scene, asset, job, custom model, and style preset state.
- `src/lib/providers/` — Model capability catalog (`catalog.ts`), QwenCloud / DashScope endpoint routing (`qwen-endpoints.ts`), Wan request validation & prompt builder (`wan-payload.ts`), shared provider types (`types.ts`), and *(planned Task 4)* QwenCloud / OpenAI-compatible client adapters and temporary OSS upload.
- `src/jobs/` *(planned Task 6)* — `globalThis` singleton background job runner started via `instrumentation.ts`.
- `src/export/` *(planned Task 7)* — Kdenlive-ready export builder (`export_kdenlive/` + optional starter `project.kdenlive` + zip archive).
- `tests/` — Vitest unit and integration suites (`environment: "node"`, `@/*` -> `./src/*`).
- `docs/superpowers/` — Design spec and implementation plan (read-only reference).
- Runtime directories (gitignored): `${DATA_DIR}` (`./data`) and `${PROJECTS_DIR}` (`./projects/<slug>/`).

## Global Constraints

- **Package manager:** Bun (`bun install`, `bun add`, `bun run`, `bunx`). Commit `bun.lock`; never commit `package-lock.json`.
- **Runtime stays Node:** `bun run dev` / `bun run build` launch Next.js under Node (never pass `--bun` to Next.js), because `better-sqlite3` is a Node native addon. Keep `"better-sqlite3"` in `trustedDependencies` and `"engines": { "node": ">=20" }` in `package.json`.
- **Public repo & secrets:** Never commit `.env`, `.env.local`, `data/`, `projects/`, or `.superpowers/`. Never store credentials in SQLite, expose unmasked keys in API responses (use `maskApiKey()`), or bundle secrets into client code.
- **Config access:** Read env vars only through `getConfig()` in `src/lib/config.ts`, lazily (so tests can mutate `process.env` before calling) and validated with `zod`.
- **Token Plan routing:** An `sk-sp-` key must route to `https://token-plan.{region}.maas.aliyuncs.com` (`ap-southeast-1` | `cn-beijing`).
- **Wan media & OSS rules:**
  - `first_frame` / `last_frame` are never combined with `reference_*`, `file`, or `link`.
  - Wan 3.0 limits: `<= 10` `reference_image`, `<= 5` `reference_video`, `<= 5` `reference_audio`.
  - Video/audio always use temporary OSS. Images use OSS when `> 2MB` or when a request has more than one image; otherwise Base64.
  - Any request containing `oss://` must send `X-DashScope-OssResourceResolve: enable`.
- **Reference cap order:** characters, then props, then locations (link order within each kind). Prompt tags use `@Image N`, matching `reference_image` order.
- **Job statuses & limits:** `QUEUED`, `PENDING`, `RUNNING`, `DOWNLOADING`, `READY`, `FAILED`. Concurrency `<= MAX_CONCURRENT_JOBS` (default `2`). Throttling/429 retries use exponential backoff (max 3 attempts).
- **Doc sync rule:** Every task that changes architecture, commands, or environment variables MUST update `AGENTS.md`, `README.md`, and `.env.example` in the same commit.

## Commands

- `bun install` — Install dependencies.
- `bun run dev` — Start Next.js dev server (Node runtime).
- `bun run build` — Production build (`next build`).
- `bun run start` — Serve production build (`next start`).
- `bun run test` — Run Vitest test suite (`vitest run`).
- `bun run lint` — Run ESLint.
- `bun run db:generate` — Generate Drizzle SQLite migrations into `drizzle/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
