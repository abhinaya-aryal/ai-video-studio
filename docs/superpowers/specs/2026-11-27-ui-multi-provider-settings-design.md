# UI-First Multi-Provider Settings & Provider-Independent Text Routing

**Date:** 2026-11-27  
**Status:** Draft — awaiting approval

## Intent & Why

Users should be able to configure the entire AI Video Studio from the web UI without creating or editing `.env.local` or restarting Next.js. In particular, users want to add multiple providers with their own API keys — such as Google Gemini's free API key, Groq, OpenRouter, or custom OpenAI-compatible endpoints alongside QwenCloud/DashScope — and assign any configured text provider + model to **Prompt Polish** or **Story Refine** independently from **Video / Image / Audio**.

## Goals

1. **Zero `.env.local` required:** All provider credentials, endpoints, and runtime app settings (`PROJECTS_DIR`, `MAX_CONCURRENT_JOBS`, `JOB_POLL_INTERVAL_MS`) can be configured and updated live from `Settings → Providers` without restarting the server.
2. **Multiple named providers:** Users can add, edit, test, and remove multiple providers with one-click presets:
   - **QwenCloud / DashScope** (`qwen`): supports video, image, audio (TTS), and text; configures key type (`auto` / `token_plan` / `standard`), region (`ap-southeast-1` / `cn-beijing`), optional workspace ID, and optional base URL override.
   - **Google Gemini** (`gemini` preset, OpenAI-compatible): pre-fills `https://generativelanguage.googleapis.com/v1beta/openai` and common default model (`gemini-2.5-flash`).
   - **Groq** (`groq` preset, OpenAI-compatible): pre-fills `https://api.groq.com/openai/v1` and default model (`llama-3.3-70b-versatile`).
   - **OpenRouter / OpenAI / Custom OpenAI-Compatible** (`openai_compat`): user-supplied base URL, optional API key (for local servers like Ollama), and default model.
3. **Provider-independent prompt polishing & story refining:** `polishPrompt()` and `refineStoryAndScenes()` keep their exact existing prompt framework (6 dimensions, shot/camera/lens/lighting/composition/audio vocabularies, Style Bible, audio directives, Zod validation, and repair retry). `getTextChat({ role })` resolves the provider, API key, base URL, and model assigned to `text_polish` or `text_refine` — no Studio or Quick Clip UI changes required.
4. **Per-role provider + model selection:** In `Settings → Models`, each text role (`Story refine` and `Prompt polish`) can select **any configured provider** and either pick a synced/manual model or enter a model ID for that provider (e.g., Gemini `gemini-2.5-flash` for Prompt Polish while Qwen handles Video/Image/Audio).
5. **Remove `.env.local` from local workspace during verification** so the full setup is tested end-to-end purely through the UI.

## Non-Goals

- Wiring non-Qwen video, image, or TTS protocols (e.g. Gemini Veo/Imagen). Video, image, and TTS continue to use the configured QwenCloud/DashScope provider.
- Multi-user authentication or cloud secret vaults (this remains a local-first single-user desktop studio).

## Anti-Goals

- Storing raw API keys in SQLite (`studio.db`), returning unmasked keys in any API response, or bundling secrets into client code.
- Breaking existing prompt-polishing behavior (vocabulary, Style Bible, audio directives, Quick Clip & SceneCard flows).
- Breaking existing Vitest suites that mutate `process.env` with isolated temporary `DATA_DIR` directories.

## Constraints

- **Secrets isolation (`AGENTS.md`):** API keys are stored in a gitignored, owner-only (`0600`) file `${DATA_DIR}/credentials.json`, never in SQLite and never returned unmasked (always masked via `maskApiKey()`).
- **Non-secret UI settings:** Stored in `${DATA_DIR}/settings.json` (gitignored under `/data/`), read lazily by `getConfig()` with environment variables as fallback when a field is not set in `settings.json`.
- **Single theme & desktop scope:** Nebula-only tokens (`src/styles/theme.css`), no `dark:` classes.
- **Doc sync:** Update `AGENTS.md`, `README.md`, and `.env.example` in the same change.

## Approaches Considered

### Approach 1 — UI Provider Registry + Isolated `data/credentials.json` *(Selected)*
- **Design:** Non-secret app settings and provider definitions live in `${DATA_DIR}/settings.json`; API keys live in `${DATA_DIR}/credentials.json` (`0600`). `getConfig()` merges `settings.json` + `credentials.json` over env fallbacks lazily on every call. `model_selections` gains an optional `providerId` column (or `settings.json` stores role→provider bindings) so `text_polish` and `text_refine` can point at any configured provider + model.
- **Trade-offs:** Clean multi-provider array, instant live updates without server restart, keeps `studio.db` secret-free, and preserves env-based test isolation.

### Approach 2 — UI Writes Directly to `.env.local`
- **Design:** Settings API edits `.env.local` and mutates `process.env`.
- **Trade-offs:** Brittle for an arbitrary list of multiple providers, awkward to model per-provider model lists, and conflicts with Next.js's startup `.env` lifecycle. Rejected.

## Architecture & Design

### 1. Local Settings & Credentials Store (`src/lib/settings/store.ts`)
- `${DATA_DIR}/settings.json` (JSON, validated by Zod):
  ```ts
  {
    version: 1,
    app: {
      projectsDir?: string,
      maxConcurrentJobs?: number,
      jobPollIntervalMs?: number,
    },
    providers: Array<{
      id: string,                // stable slug/UUID, e.g. "qwen-default", "gemini-1"
      name: string,              // display name, e.g. "Google Gemini"
      kind: "qwen" | "openai_compat",
      preset?: "qwen" | "gemini" | "groq" | "openrouter" | "openai" | "custom",
      // Qwen-specific:
      keyType?: "auto" | "token_plan" | "standard",
      region?: "ap-southeast-1" | "cn-beijing",
      workspaceId?: string,
      baseUrl?: string,          // required for openai_compat; optional override for qwen
      defaultModel?: string,     // optional default text model (e.g. "gemini-2.5-flash")
      enabled: boolean,
    }>,
    roleProviders?: {
      text_refine?: { providerId: string; modelId?: string },
      text_polish?: { providerId: string; modelId?: string },
    }
  }
  ```
- `${DATA_DIR}/credentials.json` (JSON, `mode: 0o600`):
  ```ts
  {
    version: 1,
    keys: Record<string, string> // providerId -> raw API key
  }
  ```
- **Precedence:** UI-saved `settings.json` + `credentials.json` take precedence over env vars. If no Qwen provider exists in `settings.json`, `getConfig()` synthesizes one from `QWEN_*` env vars (if present) so existing `.env` setups and tests keep working unchanged.
- **Atomic writes:** Write to a temp file in `DATA_DIR` and rename; enforce `chmod 0o600` on `credentials.json`.

### 2. Provider-Independent Text Routing (`src/lib/providers/text.ts`)
- `getTextChat(cfg, fetchFn, { role, modelId, onUsage })`:
  1. Checks `roleProviders[role]` (for `text_polish` or `text_refine`).
  2. If mapped to an `openai_compat` provider (e.g. Gemini or Groq), resolves its `baseUrl`, its key from `credentials.json`, and `modelId ?? roleBinding.modelId ?? provider.defaultModel`, and returns a `ChatCompletionFn` calling `chatCompletion(...)` **without** Qwen-only `enableThinking`.
  3. If mapped to a `qwen` provider (or unmapped), uses the active Qwen provider's `baseUrl`, key, and `resolveSlotModel(db, role).modelId` with `enableThinking: false`.
- **Gemini JSON-mode compatibility:** Google's OpenAI-compatible endpoint supports `response_format: { type: "json_object" }` and `temperature`, and ignores/accepts standard OpenAI fields — `chatCompletion()` only sends `enable_thinking` when `enableThinking !== undefined` (Qwen only).
- **Usage recording:** `api/polish` and `api/projects/[id]/refine` record `modelId` using the resolved role model (whether Qwen, Gemini, or Groq).

### 3. Settings API Endpoints
- `GET /api/settings/providers` — returns all configured providers (with `hasApiKey` and `maskedApiKey` only, never raw keys), role-provider assignments, app settings (`projectsDir`, `maxConcurrentJobs`, `jobPollIntervalMs`), and built-in provider presets.
- `POST /api/settings/providers` — create a new provider (validates fields, writes key to `credentials.json` if provided).
- `PATCH /api/settings/providers/[id]` — update provider fields; if `apiKey` is omitted/blank, keeps existing stored key; if `clearApiKey: true`, removes it.
- `DELETE /api/settings/providers/[id]` — removes provider and its credential, clearing any `roleProviders` pointing to it.
- `PUT /api/settings/app` — updates `projectsDir`, `maxConcurrentJobs`, `jobPollIntervalMs`, and/or `roleProviders` (`text_refine`, `text_polish`).
- `POST /api/settings/test-connection` — extended to accept `{ providerId }` (tests any configured Qwen or OpenAI-compatible/Gemini/Groq provider via `/models` with `max_tokens: 1` chat fallback) while remaining backwards-compatible with `{ target: "qwen" | "openai_compat" | "all" }`.
- `POST /api/settings/providers/[id]/models` (or `GET`) — fetches available model IDs from a provider's `/models` endpoint on demand so users can pick Gemini/Groq models from a dropdown in the UI without typing IDs by hand.

### 4. UI Changes
- **`Settings → Providers` (`src/app/settings/providers/page.tsx`):**
  - Replace the read-only `.env.local` notice with an interactive **Providers** manager:
    - List of configured providers with status badges, masked API key, base URL, **Test Connection**, **Edit**, and **Delete**.
    - **Add Provider** dialog/form with one-click preset pills (**QwenCloud / DashScope**, **Google Gemini**, **Groq**, **OpenRouter**, **OpenAI**, **Custom OpenAI-Compat**) that pre-fill the base URL and suggested model.
  - Add an **App Settings** panel (`Projects Directory`, `Max Concurrent Jobs`, `Poll Interval (ms)`) with Save button.
  - Keep the **Usage (last 7 days)** card.
- **`Settings → Models` (`src/app/settings/models/page.tsx`):**
  - For **Story refine** and **Prompt polish**, show a **Provider** selector (QwenCloud, Gemini, Groq, etc.) next to the **Model** selector.
  - When a non-Qwen provider is chosen for a text role, allow fetching its live model list or entering a model ID (pre-populated with the provider's `defaultModel`, e.g., `gemini-2.5-flash`).
  - Video, Image, and Voiceover continue to use QwenCloud's synced model registry and Auto presets.

### 5. What's Left to the Builder
- Exact dialog/form layout and toast feedback copy in `Settings → Providers` and `Settings → Models` (using existing Nebula theme tokens and shadcn/ui primitives).
- Updating `tests/config.test.ts`, `tests/provider-clients.test.ts`, `tests/model-settings-routes.test.ts`, and adding unit/route tests for `store.ts`, multi-provider `getTextChat`, and `/api/settings/providers`.
- Updating `AGENTS.md`, `README.md`, `.env.example`, and `src/lib/guide.ts` (keeping `tests/guide.test.ts` green).
- Removing `.env.local` from the local workspace once verified.
