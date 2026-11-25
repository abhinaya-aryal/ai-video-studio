# AI Video Studio — Design Specification

**Date:** 2026-11-25 (revised same day after plan review)  
**Status:** Approved by user, revisions folded in  
**Repository:** `https://github.com/abhinaya-aryal/ai-video-web` (public). Run from any local clone; no machine-specific paths.

---

## 1. Intent & Why

A local-first, modern web studio for creating AI-assisted videos end-to-end. It centers on **Alibaba Cloud Model Studio (QwenCloud / DashScope)**, can be extended to other AI providers, and is built for someone new to generative media APIs.

Instead of exposing raw API parameters or a generic chat box, the studio:
- turns rough story ideas into structured, model-ready scenes;
- lets the user create reusable **Reference Elements** (characters, props, locations), inspired by WonderClip's consistent-element model, for visual consistency;
- generates keyframes and video clips with synchronized audio via **Wan 3.0** (plus Wan 2.7 and future models);
- saves every asset on disk so the user can assemble the final cut in **Kdenlive**.

The repo is public on GitHub, so it must be open-source-clean from day 1.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Video-first Guided Storyboard Studio:** rough idea -> auto-refined story, Style Bible, Reference Elements & Scene Cards -> reference sheets & scene keyframes -> Wan video generation (with native audio modes) -> clean Kdenlive-ready project folder.
- **Quick Clip Mode:** a lightweight workspace for one-off clips (Text-to-Video, First/Last Frame, or Omni-Reference) without a multi-scene storyboard.
- **Automatic Story & Prompt Refining:** expand rough ideas into cohesive stories, camera/motion cues, audio/dialogue/narration instructions, and scene breakdowns. Every step stays editable.
- **Unified Video + Audio with Audio Mode controls:** per scene, choose **Ambient / BGM Only**, **Narration**, **Character Dialogue**, or **Silent**. Optional standalone TTS (`qwen-audio-3.0-tts-plus`) when a separate `.mp3` track is wanted in Kdenlive.
- **Consistent Element Library (WonderClip-inspired):** project-level reference sheets of kind `character`, `prop`, or `location`, generated or uploaded. They feed into scene keyframes and Wan Omni-Reference calls, and the prompt refers to them by position as `@Image N`.
- **Reusable Style Presets (WonderClip "templates"):** built-in presets (Cinematic, Anime, Documentary, Product) plus "Save Style Bible as Preset" so a look can be reused across projects.
- **Batch with guardrails:** "Generate All Keyframes / Clips" shows a confirmation with clip count and total seconds, runs under a concurrency cap, and retries throttled requests with backoff.
- **First-class QwenCloud support (including Token Plan):** **Token Plan (`sk-sp-*`)** and **Standard (`sk-*`)** keys across Singapore (`ap-southeast-1`) and Beijing (`cn-beijing`), custom base URLs, and a "Test Connection" check.
- **Future-ready model catalog & pluggable providers:** Wan 3.0 (`wan3.0-video`, `wan3.0-video-prime`) by default, plus Wan 2.7 (`wan2.7-t2v`, `wan2.7-i2v`, `wan2.7-r2v`) and user-added custom model IDs through a data-driven capability registry. An **OpenAI-compatible text provider** (OpenAI, OpenRouter, DeepSeek, Ollama) is available for story refining.
- **Automatic local persistence:** download every generated image, audio file, and MP4 as soon as its task completes, before DashScope's ~24h URLs expire.
- **Open-source & agent-ready from day 1:**
  - `README.md` and `AGENTS.md` (cross-tool standard);
  - `.gemini/settings.json` so Gemini CLI reads `AGENTS.md`, and a `CLAUDE.md` that imports it (no symlinks, which break on Windows clones);
  - `.env.example`; zero secrets in the repo, database, or browser.

### Non-Goals
- **No built-in video stitching / NLE timeline.** Final assembly happens in Kdenlive. The app may optionally write a starter `.kdenlive` project with clips laid out in order.
- **No general-purpose chatbot UI.** Text LLMs only refine stories, keep elements and style consistent, break down scenes, and polish prompts.
- **No infinite canvas, multi-user auth, cloud hosting, or billing.**

### Anti-Goals
- Exposing API keys in browser JavaScript or storing them in SQLite.
- Letting users send invalid Wan payloads (e.g. `first_frame`/`last_frame` mixed with `reference_*`, more than 10 reference images) and waiting on avoidable API errors.
- Losing generated media to 24h URL expiry.
- Unbounded batch generation that silently burns quota.

---

## 3. Technical & Platform Constraints

1. **Configuration via environment (`.env.local`, template `.env.example`):**
   - All provider credentials and endpoint settings come from environment variables only: key, key type, region, workspace ID, base URL override, default models, text-provider choice, and OpenAI-compatible settings.
   - Paths (`DATA_DIR`, `PROJECTS_DIR`) and job-runner limits (`MAX_CONCURRENT_JOBS`, `JOB_POLL_INTERVAL_MS`) are also environment-driven, so tests can point at temp directories.
   - Config is read lazily and validated with `zod` in one module (`src/lib/config.ts`). Invalid config surfaces as a clear message in Settings and in server logs.
   - Non-secret user data lives in SQLite: projects, scenes, elements, assets, jobs, custom model IDs, and style presets.

2. **DashScope / QwenCloud authentication & endpoints:**
   - **Token Plan (`sk-sp-*`):** always routes to `https://token-plan.{region}.maas.aliyuncs.com` (`ap-southeast-1` or `cn-beijing`). Standard `dashscope` endpoints reject these keys with `401 InvalidApiKey`. Supported paths:
     - Text: `/compatible-mode/v1/chat/completions`
     - Image: `/api/v1/services/aigc/multimodal-generation/generation`
     - Video: `/api/v1/services/aigc/video-generation/video-synthesis` plus `/api/v1/tasks/{task_id}`
     - TTS: `/api/v1/services/audio/tts/SpeechSynthesizer`
   - **Standard (`sk-*` / `sk-ws-*`):** routes to `https://{workspaceId}.{region}.maas.aliyuncs.com`, or `https://dashscope-intl.aliyuncs.com` (Singapore) / `https://dashscope.aliyuncs.com` (Beijing).
   - All provider calls run on the Next.js server.

3. **Wan video request schema (Wan 3.0 and Wan 2.7):**
   - **Async flow:** submit with `POST .../video-synthesis` plus header `X-DashScope-Async: enable`, then poll `GET /api/v1/tasks/{task_id}`.
   - **Shared input schema:** both families use `input.prompt` + `input.media[]` items of shape `{ type, url }`. Families differ in which `type`s each model ID accepts:
     - **`wan3.0-video` / `-prime`:** `first_frame`, `last_frame`, `reference_image` (≤10), `reference_video` (≤5, 1–15s each, ≤15s total, MP4/MOV, ≥16fps, ≤100MB), `reference_audio` (≤5, 1–15s each, ≤15s total, WAV/MP3, ≤15MB), `file`, `link`.
     - **Wan 2.7:** separate model IDs per mode. `wan2.7-t2v` takes no frame media, `wan2.7-i2v` takes `first_frame` (and `last_frame` if supported), and `wan2.7-r2v` takes reference media.
     - The exact accepted types per Wan 2.7 ID are captured in the capability catalog and **must be re-verified against current Model Studio docs during Task 3**.
   - **Mutual exclusion:** `first_frame`/`last_frame` cannot be combined with `reference_*`, `file`, or `link`. The UI and the server validator both enforce this.
   - **Reference tagging:** reference images are referred to in the prompt by position (`@Image 1`, `@Image 2`, ...), matching the order of `reference_image` items. The exact tag syntax is verified in Task 3, and the prompt compiler owns the mapping.
   - **Reference cap:** when a scene links more than 10 elements, keep characters first, then props, then locations (in link order within each kind), and show the user which elements were dropped.
   - **Media transport:**
     - **Images:** DashScope temporary `oss://` URLs are preferred for multi-image or >2MB payloads, to keep request bodies small. Base64 data URIs (`data:<mime>;base64,...`, non-alpha JPEG/PNG/WEBP/BMP, ≤20MB) are used for small single images. Base64 is built server-side at request time only and is never stored or sent to LLM prompts.
     - **Video & audio:** never Base64. Always use the temporary upload flow: `GET /api/v1/uploads?action=getPolicy&model=<model>` -> multipart POST to the policy OSS host -> `oss://...`. Any request containing an `oss://` URL is sent with header `X-DashScope-OssResourceResolve: enable`.
   - **Parameters:** `duration` (2–30s, or `-1` for smart), `resolution` (`480P` / `720P` / `1080P`), `ratio` (`16:9`, `9:16`, `1:1`, `adaptive`, ...), `audio` (boolean), `prompt_extend` (boolean).
   - **Billing note (unverified):** cost depends on model, output duration, and resolution. Base64 vs. OSS affects request size, not output pricing. The batch confirmation shows clip count × seconds × resolution, not currency.

4. **Image & audio endpoints:**
   - **Image** (`wan2.7-image`, `wan2.7-image-pro`, `qwen-image-3.0`): multi-image references go in `input.messages[0].content[]`. Responses may be synchronous (`output.choices[0].message.content[0].image`) or async (`task_id`), and both are handled by the job runner.
   - **TTS** (`qwen-audio-3.0-tts-plus`, `cosyvoice-*`): responses may be binary audio or JSON `{ output: { audio: { url } } }`, and both are handled.
   - Per-model maximum reference-image counts for image models are kept in the catalog and verified in Task 3.

5. **Expiring outputs & error mapping:**
   - Results are downloaded immediately on completion.
   - Known DashScope error codes map to friendly messages on the scene card. Examples: `DataInspectionFailed` (content moderation), `Throttling` / HTTP 429 (retried with exponential backoff, max 3 attempts), `InvalidApiKey`, `InvalidParameter`.

---

## 4. Approaches Considered

1. **Option A — Unified Next.js full-stack app (chosen):** Next.js App Router + TypeScript, React + Tailwind CSS + shadcn/ui, SQLite (`better-sqlite3` + Drizzle ORM with `drizzle-kit` migrations), and a local `projects/` directory. One runtime, no CORS problems, typed adapters end-to-end. **Bun** is the package manager and script runner. Next.js itself runs on Node (≥20), because `better-sqlite3` is a Node native addon.
2. **Option B — Vite React + Python FastAPI:** rejected because it needs two runtimes with no local ML inference to justify it.
3. **Option C — Frontend-only SPA:** ruled out by CORS and API key exposure.

---

## 5. System Architecture & User Flows

### 5.1 High-Level Components

1. **Config (`src/lib/config.ts`):** loads and validates environment variables lazily, exposes typed `AppConfig`, and masks keys for display.

2. **Provider Registry & Model Capability Catalog (`src/lib/providers/`):**
   - **Interfaces:**
     - `TextRefinerProvider`: `chat(...)`, `testConnection()`
     - `ImageProvider`: `generateImage(...)`
     - `VideoProvider`: `submitVideoTask(...)`, `getTaskStatus(...)`
     - `AudioProvider`: `synthesizeSpeech(...)`
   - **Built-in implementations:**
     - `QwenCloud`: Token Plan / Standard routing, temporary OSS upload, and a Wan payload builder driven by catalog capabilities.
     - `OpenAICompatibleText`.
   - **Catalog:** per-model capabilities (allowed media types, max reference counts, resolutions, duration range, native audio), merged with custom model IDs from SQLite.
   - **Role assignment:** QwenCloud serves image/video/audio. Text uses `TEXT_PROVIDER=qwen|openai_compat`.

3. **Settings (`/settings`):**
   - Read-only status of the configured providers, with masked keys.
   - "Test Connection": `GET /compatible-mode/v1/models`, falling back to a `max_tokens: 1` chat ping. Warns when an `sk-sp-` key points at a non-`token-plan` URL.
   - "Add Custom Model ID" form.
   - Style preset manager.
   - Changing credentials means editing `.env.local` and restarting. Settings explains this.

4. **Guided Storyboard Studio (`/projects/[id]`):**
   - **Project Setup:** title, rough idea, style preset, aspect ratio (`16:9`, `9:16`, `1:1`), resolution (`720P`, `1080P`, `480P`), default video model.
   - **Stage 1 — Story, Elements & Scene Breakdown:** "Auto-Refine Story & Scenes" produces:
     1. a polished story + Style Bible;
     2. Reference Elements (`kind`, name, visual description);
     3. ordered Scene Cards. Each card has: title, linked elements (by name, resolved to IDs on save), visual prompt, camera/motion, Audio Mode (`ambient_only`, `narration`, `dialogue`, `silent`), audio script, duration (2–30s), and video mode (`text_to_video`, `first_last_frame`, `omni_reference`).

     Every field is editable, cards can be reordered, added, or deleted, and each card has "AI Polish Prompt".
   - **Stage 2 — Reference Elements & Scene Keyframes:**
     - Generate a reference sheet (`wan2.7-image-pro` / `qwen-image-3.0`) or upload one for each element.
     - Generate start (and optional end) keyframes per scene or with "Generate All", auto-attaching linked element sheets up to the image model's reference cap.
     - Optional standalone TTS voiceover per scene (collapsed by default).
   - **Stage 3 — Video + Audio & Kdenlive Export:**
     - **Request building:** each scene compiles into a Wan request via a pure function, `buildSceneVideoRequest`. It adds the Audio Mode cue, `@Image N` element tags, and the reference cap, and enforces mutual exclusion.
     - **Omni-Reference mode:** element sheets attach as `reference_image`, alongside any uploaded `reference_video`/`reference_audio`.
     - **First/Last Frame mode:** Stage 2 keyframes attach as `first_frame`/`last_frame`. Reference slots are disabled, with a tooltip explaining why.
     - **Batch generation:** "Generate All Clips" asks for confirmation first, then runs through a queue capped at `MAX_CONCURRENT_JOBS`.
     - **Job status:** badges go `QUEUED` -> `PENDING` -> `RUNNING` -> `DOWNLOADING` -> `READY` / `FAILED` and persist across reloads.
     - **Takes & preview:** per-scene take history with an "active take" selector, and a **Shot Strip Overview** to check visual continuity.
     - **Kdenlive Export:** rebuilds `export_kdenlive/` from the current scene order and active takes every time it runs (removing stale files). It shows the folder path, offers a ZIP download, and optionally writes a starter `project.kdenlive` file.

5. **Quick Clip Studio (`/quick-clip`):** prompt -> optional Auto-Refine -> Audio Mode -> First/Last Frame **or** reference assets -> render. Output is saved under a hidden `_quick-clips` project row, at `projects/_quick-clips/`.

6. **Job Runner (`src/lib/jobs/`):**
   - One process-wide singleton (stored on `globalThis` so dev hot-reload doesn't duplicate it), started from Next.js `instrumentation.ts`, which also resumes in-flight jobs on boot.
   - Handles image, video, and audio jobs with a concurrency cap, 429 backoff, idempotent downloads, and error-code mapping.
   - Clients poll `/api/jobs`.

7. **Local Storage:**
   - **SQLite** at `${DATA_DIR}/studio.db`, migrated via `drizzle-kit`. Tables: `projects`, `reference_elements`, `scenes`, `assets`, `jobs`, `custom_models`, `style_presets`. No credentials are stored.
   - **Disk** (`${PROJECTS_DIR}/<slug>/`):
     ```text
     projects/
       my-cyberpunk-short/
         story.md
         elements/
           character_kai_v1.png
           prop_katana_v1.png
           location_neon_alley_v1.png
         scenes/
           01_opening_rain/
             keyframe_first_v1.png
             clip_v1.mp4
             voiceover_v1.mp3
         export_kdenlive/          # Rebuilt on each export from active takes
           01_opening_rain.mp4
           02_neon_alley.mp4
           project.kdenlive        # optional starter project
     ```

---

## 6. Decisions Left to the Builder

- Exact shadcn/ui components and layout proportions (dark-mode-first studio look).
- Exact Drizzle columns and indices.
- System prompts and JSON-repair retry wording for the refiner.
- Minimal `.kdenlive` (MLT XML) structure. It must be verified by opening it in Kdenlive. If it can't be made reliable, ship the numbered clips only.
