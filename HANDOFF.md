# Project Handoff — AI Video Studio

**Last Updated:** 2026-11-25  
**Current Phase:** Brainstorming complete -> Design specification written -> **Awaiting user approval before writing the implementation plan**  
**Primary Spec:** [`docs/superpowers/specs/2026-11-25-ai-video-studio-design.md`](./docs/superpowers/specs/2026-11-25-ai-video-studio-design.md)

---

## 1. Where We Stopped

- Completed product discovery, Alibaba Cloud Model Studio / DashScope / Wan 3.0 API research, architectural selection, and an independent engineering review ("Builder Check").
- Updated the full design document with all resolved questions at `docs/superpowers/specs/2026-11-25-ai-video-studio-design.md`.
- **No implementation plan or application code has been written yet.**

---

## 2. Locked-In Decisions & Requirements

- **Purpose & Audience:** Personal, local-first AI video studio designed cleanly so it can be open-sourced later. **Not** a general-purpose chatbot.
- **UI Paradigm:** **Guided Storyboard Studio** (Stage 1: Story & Character Bible -> Stage 2: Character Sheets & Keyframes -> Stage 3: Video + Audio Generation & Export) plus a **Quick Clip** workspace for one-off generations.
- **No Built-In Video Stitching:** User will assemble/edit final cuts externally in **Kdenlive**. The app saves and exports cleanly numbered clips/assets into `projects/<slug>/export_kdenlive/`.
- **Story & Prompt Intelligence:** Automatically refines rough user ideas into a cohesive story, Style Bible, Character Roster, and editable Scene Cards (plus per-scene "AI Polish Prompt").
- **Unified Video + Audio (Wan 3.0 Native Audio):** Video and audio are generated together by Wan 3.0, with a UI **Audio Mode** selector per scene:
  - `Ambient / BGM Only`
  - `Narration`
  - `Character Dialogue`
  - `Silent` (`audio: false`)
  - *(Plus an optional standalone TTS action using `qwen-audio-3.0-tts-plus` if a separate `.mp3` track is ever needed for Kdenlive.)*
- **Character & Style Consistency:** Project-level Character Roster where users can generate (`wan2.7-image-pro` / `qwen-image-3.0`) or upload **Character Reference Sheets**, which automatically attach to Stage 2 scene keyframe generation and Stage 3 Omni-Reference video generation.
- **Providers & Models:**
  - **QwenCloud-first:** Supports **Token Plan (`sk-sp-*`)** and **Standard Model Studio (`sk-*`)** across Singapore (`ap-southeast-1`), Beijing (`cn-beijing`), and custom base URLs.
  - **Video Models:** Primary focus on **Wan 3.0** (`wan3.0-video`, `wan3.0-video-prime`), while also supporting **Wan 2.7** (`wan2.7-t2v`, `wan2.7-i2v`, `wan2.7-r2v`) and upcoming/custom model IDs via a data-driven capability catalog.
  - **Pluggable Extensibility:** Includes an **OpenAI-compatible text provider** slot (OpenAI, OpenRouter, DeepSeek, Ollama) for story refining and clean TypeScript adapter interfaces for adding future video/image providers.
- **Tech Stack (Chosen):** **Option A — Unified Next.js Full-Stack App** (Next.js App Router, TypeScript, Tailwind CSS, SQLite via Drizzle/`better-sqlite3`, local `projects/` directory on disk).

---

## 3. Verified Alibaba Cloud / Wan 3.0 Technical Notes

These constraints were verified against Alibaba Cloud Model Studio docs and are already captured in the design spec:

1. **Token Plan (`sk-sp-*`) Isolation:**
   - Must use `https://token-plan.{region}.maas.aliyuncs.com/...` (`ap-southeast-1` or `cn-beijing`), **not** `dashscope.aliyuncs.com` (mixing causes `401 InvalidApiKey`).
   - Verified to support Text (`/compatible-mode/v1/chat/completions`), Image (`/api/v1/services/aigc/multimodal-generation/generation`), Video (`/api/v1/services/aigc/video-generation/video-synthesis` + `/api/v1/tasks/{task_id}`), and TTS (`/api/v1/services/audio/tts/SpeechSynthesizer`).
2. **Wan 3.0 Mode & Media Rules (`wan3.0-video` / `wan3.0-video-prime`):**
   - `input.media[]` supports `first_frame`, `last_frame`, `reference_image` (<=10), `reference_video` (<=5, 1–15s, <=15s total, MP4/MOV, >=16fps, <=100MB), `reference_audio` (<=5, 1–15s, <=15s total, WAV/MP3, <=15MB), `file`, and `link`.
   - **Mutually exclusive:** `first_frame`/`last_frame` **cannot** be combined with `reference_*`, `file`, or `link` in the same request.
   - **Local media transport:** Images accept Base64 data URIs (`data:<mime>;base64,...`) or `oss://`. **Video and audio references do NOT accept Base64**—they must be uploaded via DashScope's temporary OSS upload flow (`/api/v1/uploads?action=getPolicy` -> multipart OSS POST -> `oss://...` with header `X-DashScope-OssResourceResolve: enable`).
3. **24-Hour Expiry:** DashScope output URLs expire after ~24 hours, so the backend must auto-download finished images/audio/MP4s into `projects/<slug>/` as soon as a task completes.

---

## 4. Open Calls to Confirm With the User

Before starting implementation, confirm the user approves `docs/superpowers/specs/2026-11-25-ai-video-studio-design.md`, including these 4 minor design calls:
1. One QwenCloud profile defaults to all roles, with optional per-role provider mixing in Settings.
2. "Test Connection" verifies via `GET /compatible-mode/v1/models` (with a `max_tokens: 1` fallback ping) and checks `sk-sp-` vs. endpoint/region mismatches.
3. Local images use Base64 data URIs (or temp OSS), while local `reference_video`/`reference_audio` automatically use DashScope temporary OSS upload.
4. Standalone `qwen-audio-3.0-tts-plus` TTS is kept as an optional per-scene action since Wan 3.0 generates audio natively.

---

## 5. Exact Next Steps (From Any Device)

1. **Pull the repo** on the office machine (`docs/superpowers/specs/2026-11-25-ai-video-studio-design.md` and `HANDOFF.md`). Verify `node -v` (built with Node 26 on the home machine; any modern Node 20+ LTS should work).
2. **Tell the AI assistant:**
   > "Read `HANDOFF.md` and `docs/superpowers/specs/2026-11-25-ai-video-studio-design.md`. I approve the design doc (or here are my tweaks: ...). Proceed to the implementation plan."
3. **Assistant workflow from there:**
   - Invoke `superpowers:writing-plans` to generate the step-by-step implementation plan in `docs/superpowers/plans/`.
   - Scaffold the Next.js + TypeScript + SQLite project and build incrementally with tests.
