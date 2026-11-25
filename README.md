# AI Video Studio (`ai-video-web`)

A local-first AI Video Studio built with Next.js App Router, SQLite, and QwenCloud / DashScope models (Wan 3.0 / 2.7, Qwen Image, Qwen TTS) featuring a Consistent Element Library, Guided Storyboard Studio, Quick Clip workspace, and Kdenlive-ready exports.

## Requirements

- **Node.js ≥ 20** (Next.js runs on Node so native SQLite bindings via `better-sqlite3` work reliably)
- **Bun** (package manager & script runner)

## Quickstart

```bash
bun install
cp .env.example .env.local
# Edit .env.local and add your QWEN_API_KEY (and optional overrides)
bun run dev
```

Open `http://localhost:3000`.

Useful commands:

- `bun run dev` — Start local development server
- `bun run build` — Create production build
- `bun run test` — Run test suite (`vitest run`)
- `bun run lint` — Run ESLint
- `bun run db:generate` — Generate Drizzle SQLite migrations into `drizzle/`

## Token Plan vs Standard Keys

Configure `QWEN_API_KEY`, `QWEN_KEY_TYPE`, and `QWEN_REGION` in `.env.local`:

- **Token Plan (`sk-sp-...`):** When `QWEN_KEY_TYPE=auto` (default), keys starting with `sk-sp-` are automatically detected as `token_plan` and routed to the Token Plan endpoint for your `QWEN_REGION` (`ap-southeast-1` or `cn-beijing`).
- **Standard DashScope (`sk-...`):** Standard keys route to DashScope regional endpoints and optionally accept `QWEN_WORKSPACE_ID`.
- **Custom OpenAI-Compatible Text Provider:** Set `TEXT_PROVIDER=openai_compat` along with `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`, and optional `OPENAI_COMPAT_API_KEY` to use a local or third-party OpenAI-compatible text endpoint for script/prompt refinement.

## Studio Pages

- **Projects Dashboard (`/`):** View existing projects, create new projects with a built-in or custom style preset, and jump to Quick Clip or Settings.
- **Quick Clip (`/quick-clip`):** Direct single-shot Wan video generation without creating a full project. Supports prompt polishing, audio mode selection, text-to-video, first/last frame, and omni-reference uploads with live job polling and inline video preview.
- **Settings (`/settings`):** Inspect masked provider keys, key type, region, resolved base URL, and key/URL mismatch warnings; test Qwen and OpenAI-compatible connections; register custom models; and manage style presets.

## Kdenlive Workflow

Generated assets live under `${PROJECTS_DIR}/<slug>/`. Exporting a project rebuilds `export_kdenlive/` directly from the current scene order and active takes (plus an optional starter `project.kdenlive` timeline file and downloadable archive) so exported clips always match your latest storyboard edits without stale files.

## Security Note

- Store API keys **only** in `.env.local` (never in `.env.example`, SQLite, or client-side code).
- `.env`, `.env.local`, `data/`, `projects/`, and `.superpowers/` are gitignored so credentials and generated media stay local.
- Server responses only expose masked key previews (e.g. `sk-sp-****cdef`).
