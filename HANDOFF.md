# Project Handoff — AI Video Studio

**Last Updated:** 2026-11-25  
**Current Phase:** Spec approved and revised -> Implementation plan written -> **Awaiting execution-method choice (Subagent-driven vs Native)**  
**Repo:** https://github.com/abhinaya-aryal/ai-video-web (public)  
**Spec:** [`docs/superpowers/specs/2026-11-25-ai-video-studio-design.md`](./docs/superpowers/specs/2026-11-25-ai-video-studio-design.md)  
**Plan:** [`docs/superpowers/plans/2026-11-25-ai-video-studio.md`](./docs/superpowers/plans/2026-11-25-ai-video-studio.md)

---

## 1. Where We Stopped

- The spec was approved, and a plan review surfaced gaps. All fixes are now folded into the spec and the 11-task plan.
- **No application code yet.** Next: choose an execution method, then start Task 1.

## 2. Decisions Made This Session

- **Bun as package manager** (`bun install`, `bun run`, `bunx`, `bun.lock`). Next.js still runs on Node so `better-sqlite3` works.
- **Project/repo name:** `ai-video-web`.
- **Config via env only:** credentials, endpoints, default models, paths, and job limits live in `.env.local`, with `.env.example` committed as the template. Nothing secret goes in SQLite (the repo is public).
- **Agent docs from day 1:**
  - `AGENTS.md` is canonical.
  - `.gemini/settings.json` makes Gemini CLI read it.
  - `CLAUDE.md` imports it with `@AGENTS.md`.
  - No symlinks (they break on Windows clones).
  - `README.md` is kept current with every task.
- **WonderClip-inspired:**
  - Consistent Element Library (`character` / `prop` / `location`).
  - Reusable Style Presets.
  - Batch "Generate All" with a confirmation dialog and concurrency cap.
  - Shot Strip continuity view.
  - Optional starter `project.kdenlive`.
- **Base64:** not a token/billing concern, because images stay on disk and never go into LLM prompts. To keep request bodies small, images use temporary OSS when >2MB or when a request has more than one image. Video/audio always use OSS.
- **Export:** `export_kdenlive/` is rebuilt from the current scene order and active takes on every export, so there are no stale files.
- **Job runner:** a `globalThis` singleton started from `instrumentation.ts`. It handles image, video, and TTS jobs, resumes after restarts, retries throttling with backoff, and maps errors to friendly messages.

## 3. Still To Verify (Plan Task 3, Step 0)

- Which `media[].type` values each of `wan2.7-t2v`, `wan2.7-i2v`, and `wan2.7-r2v` accepts. A web check suggests Wan 2.7 also uses `input.media[]` (not `img_url`).
- The Wan 3.0 `@Image N` reference-tag syntax (third-party guides agree; still to confirm in official docs).
- The max reference images for `wan2.7-image-pro` and `qwen-image-3.0`.
- The default Qwen text model ID (`QWEN_TEXT_MODEL`).

## 4. Next Steps

1. Pick an execution method (Subagent-driven recommended).
2. Execute Task 1 (scaffold via a temp dir plus rsync, because the repo isn't empty).
