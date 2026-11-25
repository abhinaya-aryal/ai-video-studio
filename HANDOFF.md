# Project Handoff — AI Video Studio

**Last Updated:** 2026-11-25  
**Current Phase:** Tasks 1–11 complete; **Final Whole-Branch Review done and all Critical/Important findings fixed** (`c1cbb98`). Suite/lint/build green. **Ready to merge or open a PR — awaiting user consent.**  
**Branch:** `feat/ai-video-studio` (branched from `main`; `HEAD` = `c1cbb98`)  
**Repo:** https://github.com/abhinaya-aryal/ai-video-web (public; local folder rename to `ai-video-web` deferred by user)  
**Spec:** [`docs/superpowers/specs/2026-11-25-ai-video-studio-design.md`](./docs/superpowers/specs/2026-11-25-ai-video-studio-design.md)  
**Plan:** [`docs/superpowers/plans/2026-11-25-ai-video-studio.md`](./docs/superpowers/plans/2026-11-25-ai-video-studio.md)

---

## 1. Where We Stopped

- **Tasks 1–11** are implemented and committed on `feat/ai-video-studio`.
- The interrupted Task 11 review was folded into the **Final Whole-Branch Review** (fresh reviewer, `main..ee1854c`). It found **2 Critical + 3 Important** issues; all five were fixed with RED→GREEN tests in `c1cbb98` (see Section 5).
- The pre-existing `tests/setup-docs.test.ts` failure was fixed in `ee1854c` (anchored `/data/`, `/projects/` assertions).
- All reviewer Minor findings remain deferred (Section 5). No Critical/Important findings are open.

### Commit History (`main..HEAD`)
- `fe8cbe2` — `docs: finalize spec, 11-task Bun plan, and handoff`
- `84a2587` / `0edb64f` — Task 1: Next.js scaffold, env `getConfig()`, `AGENTS.md`, `CLAUDE.md`, `.gemini/settings.json`, `vitest.config.mts`, `bun.lock`
- `cd1accc` — Task 2: SQLite schema, Drizzle migrations (`drizzle/`), safe `PROJECTS_DIR` path helpers
- `791fbd8` / `3c2c91e` — Task 3: Qwen endpoints, capability catalog, Wan payload builder & `@Image N` token-boundary matching
- `3291d8f` — Task 4: QwenCloud & OpenAI-compat clients, OSS upload, error mapping
- `085013d` — Task 5: Story & prompt refiner with Zod validation & one-shot repair retry
- `3c81f99` — Task 6: `JobRunner` (`globalThis.__aivsRunner`), concurrency cap, backoff, resume, `persistResult`, `instrumentation.ts`
- `148e402` / `ce7d4c5` — Task 7: Kdenlive export rebuild, MLT XML generator, ZIP stream with backpressure
- `5da4455` / `3803834` — Task 8: `scene-request.ts`, `route-helpers.ts`, and 19 API route handlers under `src/app/api/`
- `6580ba1` — Task 9: Dark shadcn/ui shell, `NavSidebar`, `useJobs`, `mediaModeState()`, Dashboard (`/`), `/settings`, `/quick-clip`
- `94e603d` / `7a6064e` — Task 10: `/projects/[id]`, `StageTabs`, `Stage1Story`, `SceneCard`, `Stage2Elements`, `ElementCard`, `BatchConfirmDialog`
- `8435059` — Task 11: `Stage3Video`, `ShotStrip`, `TakeHistory`, `ExportPanel`, `StageTabs` wiring, `README.md` & `AGENTS.md` sync
- `ee1854c` — test: align `.gitignore` assertions with anchored `/data/` and `/projects/`
- `c1cbb98` — fix: whole-branch review findings (mode-scoped media, Stage 3 uploads wired to requests, key/URL warning, batch dropped-element notices, destructive re-refine confirmation)

---

## 2. Known Issues & Pending Items

1. **No open Critical/Important findings.** The whole-branch reviewer's verdict was "With fixes"; all five fixes landed in `c1cbb98` and are covered by tests.
2. **Deferred Minor findings:**
   - All Minor findings from Tasks 1–11 (including the four raised in the whole-branch review) are listed in Section 5. The whole-branch review promoted none.
3. **Manual checks skipped in headless/unconfigured workspace:**
   - `kdenlive` is not installed locally (XML was validated via `xmllint` and Vitest); the starter `project.kdenlive` has not been opened in the Kdenlive GUI.
   - `.env.local` with a real `QWEN_API_KEY` is not present locally, so live `bun run dev` generation checks (Tasks 10 & 11 Step 3) and live uploaded-media generation were skipped. Uploaded media is covered by request-builder tests with injected preparers, not by a real provider call.

---

## 3. Current Build & Test State (at `c1cbb98`)

- `bun run build`: **PASS** (0 errors)
- `bun run lint`: **PASS** (0 errors, 0 warnings)
- `bunx vitest run`: **80/80 PASS** (`12/12` files)
- `bunx tsc --noEmit`: **PASS**

---

## 4. Next Steps for Incoming Agent (tool-agnostic)

> [!NOTE]
> `.superpowers/` is git-ignored scratch. It exists on this machine but not in clones. Everything you need is inlined below; the files there are optional extra context.

1. **Orient:** read `AGENTS.md` (canonical rules: Bun for packages, Node runtime, env-only config, doc-sync rule), then the plan (`docs/superpowers/plans/2026-11-25-ai-video-studio.md`) and spec.
2. **Confirm green state:**
   ```bash
   bunx vitest run && bun run lint && bun run build
   ```
3. **Optional live smoke test** (needs a real key): `cp .env.example .env.local`, set `QWEN_API_KEY`, `bun run dev`. Then create a project, refine, generate an element sheet, keyframe, and clip, upload a per-scene first frame and reference media, reorder scenes, export, and check `projects/<slug>/export_kdenlive/`. Open `project.kdenlive` in Kdenlive (not installed in this workspace).
4. **Finish:** merge or open a PR from `feat/ai-video-studio` **only with the user's consent**. Never push without explicit approval.

---

## 5. Deferred Minor Findings (all triaged, none promoted)

> [!NOTE]
> The Final Whole-Branch Review reviewed every row below and promoted none. The last four rows were raised by that review.

| Task | Area | Finding |
|------|------|---------|
| 1 | `tests/config.test.ts` | Add edge cases: `TEXT_PROVIDER=openai_compat` missing URL/model, explicit `QWEN_KEY_TYPE`, non-`sk-` `maskApiKey` |
| 1 | `src/app/globals.css` | Redundant fallback `font-family` on `body` |
| 2 | `tests/db-and-storage.test.ts` | Test `closeDbForTests()` + reopen idempotency on the same `dataDir` |
| 2 | `drizzle.config.ts` | Reads `process.env.DATA_DIR` directly (acceptable for the CLI) |
| 3 | `qwen-endpoints.ts` `checkQwenKeyUrl` | Host check `includes("token-plan.")` is too permissive; use `startsWith` |
| 3 | `catalog.ts` `customRowToCapability` | Malformed `capabilities_json` silently falls back to defaults |
| 3 | `tests/wan-payload-and-routing.test.ts` | Untested validation branches (duration, resolution, empty prompt, audio on non-audio model) |
| 4 | `qwen-client.ts` / `text.ts` | Strip trailing slash before appending `/compatible-mode/v1` |
| 4 | `text.ts` `getTextChat` | Call `checkQwenKeyUrl` to fail fast on key/URL mismatch |
| 4 | tests | Cover `sanitizeErrorText`, `parseProviderErrorResponse`, and the exact 2 MiB boundary |
| 5 | `story-refiner.ts` | `Number.isFinite(targetSceneCount)`; broaden embedded fence regex; guard empty assistant content in the repair turn |
| 5 | `tests/story-refiner.test.ts` | Assert `cameraDirection` and `responseFormat` are passed |
| 6 | `runner.ts` | A retryable download error in `persistResult` marks the job `FAILED` immediately |
| 6 | `persist.ts` | `writeFileSync` runs before the transactional `resultAssetId` recheck |
| 7 | `kdenlive.ts` | Dedupe bin/track entry XML; add a fallback when `slugify()` returns `""` |
| 7 | `tests/kdenlive-export.test.ts` | ZIP content, cancel, and error tests; stricter XML attribute checks |
| 8 | API routes | Shared DELETE-id helper; `refine` silently accepts malformed JSON; `batch` doesn't validate `sceneIds` exist; `upload` doesn't `requireElement` |
| 9 | `quick-clip/page.tsx` | Asset refetch on every 3s poll once a job is READY; changing model doesn't clamp resolution/duration |
| 9 | `settings/page.tsx` | `handleTestConnection` ignores `res.ok`; duplicated fetch logic; 741 lines (split it) |
| 9 | `package.json` | Move `shadcn` to `devDependencies` |
| 10 | `StageTabs.tsx` / `Stage1Story.tsx` | Duplicated project fetch; story/style-bible state doesn't re-sync when `project` changes; large files |
| 11 | `scenes/route.ts`, `refine/route.ts`, `kdenlive.ts` | Export filenames duplicate the scene number (`01_02_neon-alley.mp4`) because scene slugs already start with `NN-`; cosmetic |
| 11 | `project.kdenlive` | Starter MLT file not opened in Kdenlive (not installed); XML validated via `xmllint` + unit tests |
| 11 | `src/lib/config.ts` | Next.js tracing warning from dynamic `path.resolve`; harmless build bloat for local-first use |
| 11 | `Stage3Video.tsx` | Dropped-element notices stay visible until the next generate call (sticky after mode/unlink changes) |

---

## 6. Key Rulings Made During Execution

- `vitest.config.mts` (not `.ts`) keeps test output clean without `"type": "module"`.
- Built-in style presets (Cinematic, Anime, Documentary, Product) are seeded idempotently on first `getDb()`.
- `.gitignore` uses anchored `/data/` and `/projects/` so `src/app/api/projects/` stays tracked.
- Catalog source comments point at the Model Studio docs root. Verified values: Wan 3.0 allows ≤10 ref images, ≤5 ref videos, and ≤5 ref audio, with `@Image N` tags. `wan2.7-image-pro` allows ≤9 ref images and `qwen-image-3.0` allows ≤3. `wan2.7-i2v` uses `input.media[]` with `first_frame`/`last_frame`, and `wan2.7-t2v` takes text only.
- Canonical enums: `AUDIO_MODES = ambient_only | narration | dialogue | silent` and `VIDEO_MODES = text_to_video | first_last_frame | omni_reference`.
- Turbopack prints 2 non-blocking warnings about `path.resolve` in `src/lib/config.ts`, traced via `instrumentation.ts`.
- The interrupted Task 11 per-task review was folded into the required whole-branch review; the reviewer brief carried an explicit Task 11 checklist.
- Whole-branch fixes: mode-scoped attachments in `mediaModeState`; per-scene uploads accepted by `buildSceneVideoRequest` and forwarded by `/api/generate/video` + `/api/generate/batch`; shared `QwenKeyUrlCheck` type; `collectDroppedElementsByScene` for batch notices; `CONFIRM_REQUIRED` (409) + Stage 1 rebuild dialog before destructive Auto-Refine.
- Reviewer "Declined to judge" items were accepted as out of scope: auth/multi-user/cloud/billing, built-in NLE stitching, shadcn layout choices, live provider E2E (no key), model doc re-verification, cost estimates, multi-process runner scaling, and browser `<video>` range behavior.
