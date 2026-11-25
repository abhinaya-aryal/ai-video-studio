# AI Video Studio — Design Specification

**Date:** 2026-11-25  
**Status:** Ready for User Approval  
**Target Directory:** `/home/abhinaya/codes/ai-video-web`

---

## 1. Intent & Why

A local-first, modern web studio for creating AI-assisted videos end-to-end—centered on **Alibaba Cloud Model Studio (QwenCloud / DashScope)** and extensible to other AI providers—built specifically for someone new to generative media APIs.

Instead of exposing raw API parameters or a generic chat box, the studio turns rough story ideas into structured, model-ready scenes, lets the user create reusable **Character & Style Reference Sheets** for visual consistency, generates supporting keyframes and video clips with synchronized audio via **Wan 3.0** (plus Wan 2.7 and future models), and saves every asset neatly on disk so the user can assemble the final cut in **Kdenlive**. The codebase is personal-first today and structured cleanly so it can be open-sourced later.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Video-first Guided Storyboard Studio:** Take a user from a rough idea -> auto-refined story, Character/Style Bible, & Scene Cards -> Character Reference Sheets & Scene Keyframes -> Wan Video Generation (with native synchronized audio modes) -> clean Kdenlive-ready project folder.
- **Quick Clip Mode:** A lightweight tab/workspace for generating one-off video clips (Text-to-Video, First/Last Frame, or Omni-Reference) without creating a multi-scene storyboard.
- **Automatic Story & Prompt Refining:** Automatically expand and polish rough user ideas into cohesive stories, camera/motion cues, audio/dialogue/narration instructions, and consistent scene breakdowns, while allowing the user to review and edit every step.
- **Unified Video + Audio with Clear Audio Mode Controls:** Leverage Wan 3.0's native audio-video generation with a simple UI selector per scene (**Ambient / BGM Only**, **Narration**, **Character Dialogue**, or **Silent**), plus optional standalone TTS track generation (`qwen-audio-3.0-tts-plus`) when the user wants a separate `.mp3` voice track in Kdenlive.
- **Character & Style Consistency:** Generate or upload project-level Character Reference Sheets (and a Style Bible) that automatically feed into scene keyframe generation and Wan 3.0 Omni-Reference video calls.
- **First-class QwenCloud Support (including Token Plan):** Support both **Token Plan (`sk-sp-*`)** and **Standard Model Studio (`sk-*`)** credentials across Singapore (`ap-southeast-1`) and Beijing (`cn-beijing`) regions, plus custom endpoint overrides and a "Test Connection" button.
- **Future-Ready Model Catalog & Pluggable Providers:** Focus primarily on **Wan 3.0** (`wan3.0-video`, `wan3.0-video-prime`), while also supporting **Wan 2.7** (`wan2.7-t2v`, `wan2.7-i2v`, `wan2.7-r2v`) and upcoming models via a data-driven capability registry, plus an **OpenAI-compatible text provider** (OpenAI, OpenRouter, DeepSeek, Ollama) and clean adapter interfaces for future video/image providers.
- **Automatic Local Asset Persistence:** Immediately download generated images, audio, and MP4 clips to disk before DashScope's temporary URLs expire (24 hours), using predictable, Kdenlive-friendly filenames.
- **Open-Source Ready:** Zero hardcoded secrets, `.env.example`, server-side-only key handling, local SQLite storage, and clear setup instructions.

### Non-Goals
- **No built-in video stitching / NLE timeline editor:** Final assembly, transitions, color grading, and multi-track mixing happen externally in Kdenlive.
- **No general-purpose chatbot UI:** Text LLMs exist strictly to refine stories, maintain character/style consistency, break down scenes, and improve visual/motion/audio prompts.
- **No multi-user auth, cloud hosting, or billing:** Single-user local studio (clean enough to self-host or open-source).

### Anti-Goals
- Exposing API keys in browser JavaScript or calling DashScope directly from client code (fails CORS and leaks secrets).
- Letting users trigger invalid Wan 3.0 payloads (e.g., mixing `first_frame`/`last_frame` with `reference_*` assets) and wait on avoidable API errors.
- Losing generated media because temporary DashScope URLs expired after 24 hours.

---

## 3. Technical & Platform Constraints

1. **DashScope / QwenCloud Authentication & Endpoints:**
   - **Token Plan (`sk-sp-*`):** Routes to `https://token-plan.{region}.maas.aliyuncs.com/...` (`ap-southeast-1` or `cn-beijing`), never standard `dashscope` endpoints (which reject `sk-sp-*` with `401 InvalidApiKey`). Verified to support Text (`/compatible-mode/v1/chat/completions`), Image (`/api/v1/services/aigc/multimodal-generation/generation`), Video (`/api/v1/services/aigc/video-generation/video-synthesis`), and TTS (`/api/v1/services/audio/tts/SpeechSynthesizer`).
   - **Standard Pay-As-You-Go (`sk-*` / `sk-ws-*`):** Routes to `https://{workspaceId}.{region}.maas.aliyuncs.com/...` or `https://dashscope-intl.aliyuncs.com/...` (Singapore) / `https://dashscope.aliyuncs.com/...` (Beijing).
   - **Browser CORS & Key Protection:** All provider calls execute on the Next.js server; raw API keys never leave the backend.

2. **Wan 3.0 All-in-One Rules (`wan3.0-video`, `wan3.0-video-prime`):**
   - Async submission (`POST /api/v1/services/aigc/video-generation/video-synthesis` with `X-DashScope-Async: enable`) followed by polling (`GET /api/v1/tasks/{task_id}`).
   - `input.media[]` accepts `first_frame`, `last_frame`, `reference_image` (up to 10), `reference_video` (up to 5, 1–15s each, <=15s total, MP4/MOV, >=16fps, <=100MB), `reference_audio` (up to 5, 1–15s each, <=15s total, WAV/MP3, <=15MB), `file`, and `link`.
   - **Mutually exclusive modes:** `first_frame`/`last_frame` cannot be combined with `reference_*`, `file`, or `link` in the same request. The UI and server validator enforce this cleanly.
   - **Media transport rules:**
     - **Images** (`first_frame`, `last_frame`, `reference_image`): sent as Base64 data URIs (`data:<mime>;base64,...`, non-alpha JPEG/PNG/WEBP/BMP, <=20MB) or DashScope temporary `oss://` URLs.
     - **Video & Audio** (`reference_video`, `reference_audio`): DashScope video endpoints do **not** accept Base64 for video/audio—local files must upload via DashScope's Temporary File Upload flow (`GET /api/v1/uploads?action=getPolicy&model=<model>` -> multipart POST to policy OSS host -> `oss://...` URL, sent with header `X-DashScope-OssResourceResolve: enable`).
   - Parameters: `duration` (`2`–`30`s or `-1` smart), `resolution` (`480P` / `720P` / `1080P`), `ratio` (`16:9`, `9:16`, `1:1`, `adaptive`, etc.), `audio` (boolean), `prompt_extend` (boolean).

3. **Wan 2.7 & Upcoming Video Models:**
   - Unlike Wan 3.0's unified `input.media[]` schema, Wan 2.7 splits T2V/I2V/R2V across separate model IDs (`wan2.7-t2v`, `wan2.7-i2v`, `wan2.7-r2v`) with distinct input fields (e.g., `input.image_url`).
   - Supported via a **Model Capability Matrix & Per-Family Request Serializer**, making Wan 3.0 the default while cleanly adapting Wan 2.7 and future custom/upcoming model IDs (including an "Add Custom Model ID" option in Settings).

4. **QwenCloud Multimodal Image & Audio Endpoints:**
   - **Image (`wan2.7-image`, `wan2.7-image-pro`, `qwen-image-3.0`, etc.):** `POST /api/v1/services/aigc/multimodal-generation/generation` (supports multi-image character/style references in `input.messages[0].content[]`; handles both sync `output.choices[0].message.content[0].image` and async `task_id` polling).
   - **Optional Standalone TTS (`qwen-audio-3.0-tts-plus`, `cosyvoice-*`):** `POST /api/v1/services/audio/tts/SpeechSynthesizer`, handling both direct binary audio bytes and JSON `{ output: { audio: { url } } }` responses.

5. **Expiring Output URLs:** DashScope result URLs expire in ~24 hours; the backend downloads and saves every completed output locally immediately on completion.

---

## 4. Approaches Considered

1. **Option A — Unified Next.js Full-Stack App (Chosen):**
   - *Stack:* Next.js (App Router, TypeScript), React + Tailwind CSS, SQLite (`better-sqlite3` / Drizzle ORM), local `projects/` directory on disk.
   - *Why chosen:* Single runtime (`npm install && npm run dev`), zero CORS issues via Route Handlers, strongly typed provider/model capability adapters end-to-end, and lowest friction when open-sourcing.
2. **Option B — Split Vite React Frontend + Python FastAPI Backend:**
   - *Why not chosen:* Requires managing two runtimes, virtualenvs, and servers without needing local Python ML inference.
3. **Option C — Frontend-only SPA:**
   - *Ruled out:* Blocked by DashScope CORS and exposes secret API keys in browser code.

---

## 5. System Architecture & User Flows

### 5.1 High-Level Components

1. **Provider Registry & Model Capability Matrix (`src/lib/providers/`):**
   - Clean TypeScript interfaces:
     - `TextRefinerProvider`: `refineStory(...)`, `refineScenePrompt(...)`, `testConnection(...)`
     - `ImageProvider`: `generateImage(...)`, `editImage(...)`
     - `VideoProvider`: `submitVideoTask(...)`, `getTaskStatus(...)`
     - `AudioProvider`: `synthesizeSpeech(...)`
   - **Built-in implementations:**
     - `QwenCloudProvider`: Supports Token Plan (`sk-sp-`) and Standard (`sk-`), Singapore/Beijing/Custom base URLs, temporary OSS file upload helper (`oss://` + `X-DashScope-OssResourceResolve: enable`), and per-family video serializers (`wan3` unified schema + `wan2.7` T2V/I2V/R2V schema).
     - `OpenAICompatibleTextProvider`: Any `/v1/chat/completions` endpoint + API key + model ID for story/prompt refining.
   - **Data-driven Model Catalog:** Defines capabilities per model (supported resolutions, max duration, native audio support, supports `first_frame`/`last_frame`, supports `reference_image`/`video`/`audio`, schema family) plus user-added custom model IDs so upcoming Wan/Qwen releases work immediately without code edits.
   - **Per-Role Provider Assignment (Builder Call):** One QwenCloud profile defaults to serving all four roles, while Settings optionally lets the user mix providers per role (e.g., OpenRouter/Ollama for Story Refining + QwenCloud Token Plan for Image/Video).

2. **Settings & Provider Configuration (`/settings`):**
   - Manage provider profiles (`QwenCloud Token Plan`, `QwenCloud Standard`, `OpenAI-Compatible`).
   - Masked API key input stored server-side only; `.env` overrides supported for headless/open-source setups.
   - **"Test Connection" action (Builder Call):** Calls `GET /compatible-mode/v1/models` (falling back to a minimal `max_tokens: 1` chat completion ping if `/models` is unsupported on a given endpoint) and checks region/key prefix compatibility (e.g., warning if an `sk-sp-` key is pointed at a non-`token-plan` URL).

3. **Guided Storyboard Studio (`/projects/[id]`):**
   - **Project Setup:** Title, rough idea/story input, global style/mood preset (Cinematic, Anime, Documentary, Product, etc.), target aspect ratio (`16:9`, `9:16`, `1:1`), default resolution (`720P`, `1080P`, `480P`), and default video model (`wan3.0-video` / `wan3.0-video-prime` / `wan2.7-*` / custom).
   - **Stage 1 — Story, Character Bible & Scene Breakdown:**
     - User enters a rough idea (or pastes a draft) and clicks **Auto-Refine Story & Scenes**.
     - Refiner LLM generates:
       1. A polished story + global **Style Bible**;
       2. A **Character Roster** (each character's name, visual description, wardrobe/features);
       3. Ordered **Scene Cards** with: title, linked characters, visual prompt, camera/motion direction, **Audio Mode** (`ambient_only`, `narration`, `dialogue`, `silent`), audio/speech script (narration line or spoken dialogue + ambient cue), target duration (`2–30s`), and suggested video mode (`text_to_video`, `first_last_frame`, or `omni_reference`).
     - Every field on every Scene Card is editable, reorderable, addable/deletable, and has a one-click **"AI Polish Prompt"** action.
   - **Stage 2 — Character Sheets & Scene Keyframes:**
     - **Character & Style References:** For each character in the roster (or manually added), click **Generate Character Sheet** (`wan2.7-image-pro` / `qwen-image-3.0`) or upload a local reference image. Approved character sheets become the project's consistency anchors.
     - **Scene Keyframes (per scene or "Generate All"):** Generates start frame (and optional end frame) for each scene, **automatically attaching the linked characters' reference images** so character appearance stays consistent across scenes.
     - **Optional Standalone Voiceover Track:** Collapsed/optional per-scene action using `qwen-audio-3.0-tts-plus` if the user specifically wants a separate `.mp3` track for Kdenlive or `reference_audio` guidance.
   - **Stage 3 — Unified Video + Audio Generation & Kdenlive Export:**
     - Each Scene Card compiles the visual prompt + camera direction + selected **Audio Mode** cue into the Wan request (`audio: true` for Ambient Only / Narration / Character Dialogue, `audio: false` for Silent).
     - **Mode & Consistency Handling:**
       - In **Omni-Reference mode** (best when animating directly from character sheets, reference videos, or reference audio): linked Character Reference Images automatically attach as `reference_image` alongside any user-uploaded `reference_video`/`reference_audio`.
       - In **First/Last Frame mode** (best when locking exact Stage 2 keyframe composition): Stage 2's character-consistent keyframe attaches as `first_frame` (and optional `last_frame`), while `reference_*` slots are automatically disabled with a clear tooltip explaining Wan 3.0's mutual-exclusion rule.
     - Live job badges (`PENDING` -> `RUNNING` -> `DOWNLOADING` -> `READY` / `FAILED`) persist across browser reloads via SQLite + background polling.
     - Version history per scene (keep previous takes), inline video/image/audio previews, and **"Kdenlive Export"** showing the clean `export_kdenlive/` folder path + ZIP download.

4. **Quick Clip Studio (`/quick-clip`):**
   - Single-screen generator for rapid one-off clips: rough prompt -> optional **Auto-Refine Prompt** -> pick Audio Mode (`Ambient Only`, `Narration`, `Dialogue`, `Silent`) -> attach `first_frame`/`last_frame` OR `reference_*` assets (including local video/audio uploaded via DashScope temp OSS) -> render and save into `projects/_quick-clips/`.

5. **Local Storage & Kdenlive-Friendly Disk Layout:**
   - **SQLite (`data/studio.db`):** Stores `providers`, `projects`, `characters`, `scenes`, `assets` (versions, prompts, parameters, local file paths), and `jobs` (`task_id`, status, error details, timestamps).
   - **Disk (`projects/<slug>/`):**
     ```text
     projects/
       my-cyberpunk-short/
         story.md                  # Refined story, style bible, & scene prompts
         characters/
           hero_kai_v1.png         # Character reference sheets
         scenes/
           01_opening_rain/
             keyframe_first_v1.png
             clip_v1.mp4           # Video + synchronized audio
             voiceover_v1.mp3      # (optional, if standalone TTS generated)
           02_neon_alley/
             ...
         export_kdenlive/          # Active takes numbered cleanly for Kdenlive import:
           01_opening_rain.mp4
           02_neon_alley.mp4
     ```

---

## 6. Decisions Left to the Builder

- **UI Component Library & Visual Styling:** Choice of Tailwind + shadcn/ui (dark-mode-first studio aesthetic) and exact layout proportions.
- **Database Schema & Migrations:** Exact Drizzle/SQLite table columns, indices, and migration scripts.
- **Background Polling Mechanism:** Server-side polling loop / job runner + SSE or client polling endpoint to stream live job updates to the UI.
- **Key Storage Hardening:** Storing API keys in local SQLite (optionally encrypted with a machine-local secret or `.env` override) with strict API response DTOs that never return raw keys to the client.
- **LLM Structured Output Prompting:** Exact system prompts and JSON schema parsing/retry logic for converting rough ideas into consistent Story + Character Roster + Scene Cards, plus compiling Scene Audio Modes into clean Wan 3.0 prompts.
- **Testing Setup:** Unit tests for provider payload builders (Wan 3.0 `media` mutual-exclusion rules, Wan 2.7 capability mapping, Token Plan vs Standard URL routing, temp OSS upload handling) and job/storage helpers.
