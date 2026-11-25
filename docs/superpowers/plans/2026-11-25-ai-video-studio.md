# AI Video Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first AI Video Studio (QwenCloud Token Plan/Standard, Wan 3.0/2.7, Qwen Image/TTS) with a WonderClip-inspired Consistent Element Library, Guided Storyboard Studio, Quick Clip workspace, and Kdenlive-ready exports.

**Architecture:** Unified Next.js App Router app. All provider calls, OSS uploads, job polling, and downloads run server-side. Credentials and paths come only from environment variables (`.env.local`, template `.env.example`). SQLite (Drizzle + `drizzle-kit` migrations) stores non-secret project data. Media lives under `${PROJECTS_DIR}/<slug>/`.

**Tech Stack:** Latest stable Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod`, `archiver`, `vitest`, Node.js ≥ 20 (verified on v22.23.4).

**Spec:** [`docs/superpowers/specs/2026-11-25-ai-video-studio-design.md`](../specs/2026-11-25-ai-video-studio-design.md)

## Global Constraints

- **Package manager:** Bun (verified on v1.4.5). Use `bun install`, `bun add`, `bun run`, and `bunx`. Commit `bun.lock`, and never commit `package-lock.json`.
- **Runtime stays Node:** `bun run dev`/`build` launch Next.js under Node (no `--bun` flag), because `better-sqlite3` is a Node native addon. List `better-sqlite3` in `trustedDependencies` in `package.json` so its install script runs. Add `"engines": { "node": ">=20" }`.
- **Public repo:** never commit `.env`, `.env.local`, `data/`, or `projects/`. No credentials in SQLite, in API responses (masked only, e.g. `sk-sp-****cdef`), or in client bundles.
- **Config:** read only through `getConfig()` in `src/lib/config.ts`, lazily (tests can set `process.env` before calling) and validated with `zod`.
- **Agent docs from Task 1:**
  - `AGENTS.md` is the canonical file.
  - `.gemini/settings.json` = `{ "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } }`.
  - `CLAUDE.md` contains `@AGENTS.md`.
  - No symlinks.
  - Every task that changes architecture, commands, or env vars updates `AGENTS.md`, `README.md`, and `.env.example` in the same commit.
- **Token Plan routing:** an `sk-sp-` key must use `https://token-plan.{region}.maas.aliyuncs.com` (`ap-southeast-1` | `cn-beijing`).
- **Wan media rules:**
  - `first_frame` / `last_frame` are never combined with `reference_*`, `file`, or `link`.
  - Wan 3.0 limits: ≤10 `reference_image`, ≤5 `reference_video`, ≤5 `reference_audio`.
  - Video/audio always go through temporary OSS. Images go through OSS when >2MB or when the request has more than one image; otherwise Base64.
  - Any request containing `oss://` sends `X-DashScope-OssResourceResolve: enable`.
- **Reference cap order:** characters, then props, then locations (link order within each kind). Prompt tags are `@Image N`, matching `reference_image` order.
- **Job statuses:** `QUEUED`, `PENDING`, `RUNNING`, `DOWNLOADING`, `READY`, `FAILED`.
- **Job runner limits:** concurrency ≤ `MAX_CONCURRENT_JOBS` (default 2). Throttling/429 retries with exponential backoff, max 3 attempts.

## Review Focus

1. **Refiner returns fenced or malformed JSON:** strip fences, retry once with a repair prompt, then fail with a clear error (Task 5).
2. **`sk-sp-` key with a non-token-plan base URL, or missing env config:** Test Connection and `getConfig` report an actionable message instead of throwing a 500 (Tasks 2, 4).
3. **Scene links more than 10 elements, or the user mixes frames with references:** the request builder caps and orders references, reports dropped elements, and rejects mixes before any API call (Tasks 3, 9).
4. **Scenes reordered or active take changed after clips are generated:** export is rebuilt from current order and takes, with no stale `01_*.mp4` (Task 7).
5. **Server restart or dev hot-reload mid-job:** jobs resume once, with no duplicate pollers or duplicate assets (Task 6).

---

### Task 1: Scaffold, Env Config, Day-1 Docs & Test Runner

**Files:**
- Create (via scaffold): `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/*`, `eslint` config
- Create: `vitest.config.ts`, `.env.example`, `.gitignore` additions, `README.md`, `AGENTS.md`, `CLAUDE.md`, `.gemini/settings.json`
- Create: `src/lib/config.ts`
- Test: `tests/setup-docs.test.ts`, `tests/config.test.ts`

**Interfaces:**
- Produces: `getConfig(): AppConfig` and `maskApiKey(key: string): string` in `src/lib/config.ts`.
- `AppConfig` fields:
  - `dataDir`, `projectsDir`
  - `qwen: { apiKey?, keyType: 'token_plan' | 'standard', region: 'ap-southeast-1' | 'cn-beijing', workspaceId?, baseUrlOverride?, models: { text, image, video, tts } }`
  - `textProvider: 'qwen' | 'openai_compat'`
  - `openaiCompat?: { baseUrl, apiKey?, model }`
  - `jobs: { maxConcurrent, pollIntervalMs }`
- Produces: `bun run dev | build | test` (`test` = `vitest run`). Task 2 adds `db:generate` (`drizzle-kit generate`).

- [ ] **Step 1: Scaffold in a temp dir and copy in (the repo already has `docs/`, `HANDOFF.md`, `.git`)**

```bash
TMP=$(mktemp -d)
bunx create-next-app@latest "$TMP/app" --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-bun --skip-install --disable-git --yes
rsync -a --exclude README.md --exclude .git "$TMP/app/" ./
bun install
bun add better-sqlite3 drizzle-orm zod archiver lucide-react
bun add -d drizzle-kit @types/better-sqlite3 @types/archiver vitest
```
Expected: `bun run build` succeeds on the default page. `HANDOFF.md` and `docs/` are untouched.

- [ ] **Step 2: Write failing tests**

`tests/setup-docs.test.ts`:
- `README.md`, `AGENTS.md`, and `CLAUDE.md` exist.
- `CLAUDE.md` contains `@AGENTS.md`.
- `.gemini/settings.json` parses, and `context.fileName` includes `"AGENTS.md"`.
- `.gitignore` contains `.env.local`, `data/`, and `projects/`.
- Every `process.env.X` key referenced in `src/lib/config.ts` appears in `.env.example`.

`tests/config.test.ts`:
- With `QWEN_API_KEY=sk-sp-1234567890abcdef`: `getConfig().qwen.keyType === 'token_plan'`.
- With `QWEN_API_KEY=sk-abc`: `keyType === 'standard'`.
- `QWEN_REGION=mars` throws a zod error whose message names `QWEN_REGION`.
- Defaults:
  - `dataDir` resolves to `<cwd>/data` and `projectsDir` to `<cwd>/projects`
  - `jobs.maxConcurrent === 2`
  - `qwen.models.video === 'wan3.0-video'`
- `maskApiKey('sk-sp-1234567890abcdef') === 'sk-sp-****cdef'`.

- [ ] **Step 3: Run tests, expect FAIL**

Run: `bunx vitest run`
Expected: FAIL (missing files/modules).

- [ ] **Step 4: Implement config, docs, and settings files**

`.env.example` (all commented explanations, no real values):
```bash
DATA_DIR=./data
PROJECTS_DIR=./projects
QWEN_API_KEY=
QWEN_KEY_TYPE=auto            # auto | token_plan | standard (auto = detect sk-sp- prefix)
QWEN_REGION=ap-southeast-1    # ap-southeast-1 | cn-beijing
QWEN_WORKSPACE_ID=            # optional, standard keys only
QWEN_BASE_URL=                # optional override
QWEN_TEXT_MODEL=qwen-plus
QWEN_IMAGE_MODEL=wan2.7-image-pro
QWEN_VIDEO_MODEL=wan3.0-video
QWEN_TTS_MODEL=qwen-audio-3.0-tts-plus
TEXT_PROVIDER=qwen            # qwen | openai_compat
OPENAI_COMPAT_BASE_URL=
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_MODEL=
MAX_CONCURRENT_JOBS=2
JOB_POLL_INTERVAL_MS=10000
```
- `vitest.config.ts`: `@` alias to `./src`, `environment: 'node'`.
- `next.config.ts`: `serverExternalPackages: ['better-sqlite3', 'archiver']`.
- `README.md`: overview, Node ≥ 20, quickstart (`bun install`, `cp .env.example .env.local`, `bun run dev`), Token Plan vs Standard keys, Kdenlive workflow, security note (keys only in `.env.local`).
- `AGENTS.md`: architecture map, the Global Constraints above, commands, and the "update docs in the same commit" rule.

- [ ] **Step 5: Run tests and build, expect PASS**

Run: `bunx vitest run && bun run build`
Expected: PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with env config, AGENTS.md, and test runner"
```

---

### Task 2: SQLite Schema, Migrations & Safe Storage

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `drizzle/` (generated)
- Create: `src/lib/storage/paths.ts`
- Test: `tests/db-and-storage.test.ts`

**Interfaces:**
- Produces `getDb(): DrizzleDb`: a singleton on `globalThis`, keyed by `${dataDir}/studio.db`, that runs `migrate()` on first open. Also `closeDbForTests(): void`.
- Produces `getOrCreateQuickClipProject(): Project` (slug `_quick-clips`).
- Produces in `paths.ts`:
  - `slugify(input: string): string`
  - `resolveInsideProjects(relPath: string): string` (throws `UnsafePathError` when the path escapes `projectsDir`)
  - `ensureProjectDirs(slug: string): { root, elements, scenes, exportDir }`
  - `writeStoryMarkdown(slug: string, md: string): string`
- Produces tables (`snake_case` in DB):
  - `projects`: `id`, `slug` (unique), `title`, `rough_idea`, `refined_story`, `style_bible`, `style_preset_id`, `aspect_ratio`, `resolution`, `default_video_model`, `is_hidden`, timestamps
  - `reference_elements`: `id`, `project_id`, `kind` (`character|prop|location`), `name`, `description`, `active_image_path`, timestamps
  - `scenes`: `id`, `project_id`, `order_index`, `slug`, `title`, `visual_prompt`, `camera_direction`, `audio_mode`, `audio_script`, `duration`, `video_mode`, `linked_element_ids_json`, `active_keyframe_first_asset_id`, `active_keyframe_last_asset_id`, `active_video_asset_id`, `active_audio_asset_id`, timestamps
  - `assets`: `id`, `project_id` (NOT NULL), `scene_id?`, `element_id?`, `type` (`image|video|audio`), `role` (`element_sheet|keyframe_first|keyframe_last|video_clip|voiceover|quick_clip`), `version`, `file_path`, `prompt`, `params_json`, `created_at`
  - `jobs`: `id`, `project_id`, `scene_id?`, `element_id?`, `modality`, `model_id`, `role`, `request_json`, `external_task_id?`, `status`, `attempts`, `error_code?`, `error_message?`, `result_asset_id?`, timestamps
  - `custom_models`: `id`, `model_id` (unique), `display_name`, `modality`, `family`, `capabilities_json`
  - `style_presets`: `id`, `name` (unique), `style_bible`, `is_builtin`

- [ ] **Step 1: Write failing tests**
  1. With `DATA_DIR` and `PROJECTS_DIR` set to tmp dirs, `getDb()` migrates the database and inserts/reads a project, a `reference_elements` row with `kind: 'prop'`, and a scene.
  2. `getOrCreateQuickClipProject()` called twice returns the same id, with `is_hidden = 1`.
  3. `resolveInsideProjects('a/scenes/01_x/clip_v1.mp4')` stays inside `projectsDir`. `resolveInsideProjects('../etc/passwd')` and `resolveInsideProjects('/etc/passwd')` both throw `UnsafePathError`.
  4. `slugify('Opening: Rain!! ')` returns `'opening-rain'`. `slugify('../..')` returns a non-empty safe slug containing no `.` or `/`.
- [ ] **Step 2: Run tests, expect FAIL.** Run: `bunx vitest run tests/db-and-storage.test.ts`
- [ ] **Step 3: Implement the schema and run `bun run db:generate`.** Implement `index.ts` and `paths.ts`, and seed built-in style presets (Cinematic, Anime, Documentary, Product) in the first migration or on first open.
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** `feat: add SQLite schema with migrations and safe project storage`

---

### Task 3: Endpoint Routing, Capability Catalog & Wan Request Builder

**Files:**
- Create: `src/lib/providers/types.ts`, `src/lib/providers/catalog.ts`, `src/lib/providers/qwen-endpoints.ts`, `src/lib/providers/wan-payload.ts`
- Test: `tests/wan-payload-and-routing.test.ts`

**Interfaces:**
- `resolveQwenBaseUrl(cfg: AppConfig['qwen']): string`
- `checkQwenKeyUrl(apiKey: string, baseUrl: string): { ok: true } | { ok: false; warning: string }`
- `ModelCapability`:
  - `{ modelId, modality, family: 'wan3' | 'wan2.7' | 'qwen-image' | 'qwen-tts' | 'text' }`
  - `allowedMediaTypes: MediaType[]`
  - `maxCounts: Partial<Record<MediaType, number>>`
  - `maxReferenceImages?: number` (image models)
  - `durations: { min, max, smart: boolean }`
  - `resolutions: string[]`
  - `nativeAudio: boolean`
- `getModelCapabilities(modelId: string, custom?: CustomModelRow[]): ModelCapability`. Unknown IDs throw `UnknownModelError`.
- `selectReferenceElements(elements: ElementRef[], max: number): { kept: ElementRef[]; dropped: ElementRef[] }`, ordered characters, then props, then locations.
- `compileScenePrompt(input: { visualPrompt; cameraDirection?; audioMode; audioScript?; styleBible?; taggedElements?: { tag: string; name: string; kind: ElementKind }[] }): { prompt: string; audio: boolean }`
- `buildVideoSynthesisPayload(input: { modelId; prompt; audio; media: { type: MediaType; url: string }[]; duration; resolution; ratio; promptExtend?: boolean }, cap: ModelCapability): { body: object; needsOssHeader: boolean }`. Throws `WanValidationError(message)`.

- [ ] **Step 0: Verify the docs.** Confirm against current Alibaba Cloud Model Studio docs:
  - which `media[].type` values each of `wan2.7-t2v`, `wan2.7-i2v`, and `wan2.7-r2v` accepts;
  - the Wan 3.0 `@Image N` reference syntax;
  - the max reference images for `wan2.7-image-pro` and `qwen-image-3.0`;
  - the Standard `sk-*` base URL forms.

  Put the findings into `catalog.ts`, with a source-URL comment per entry. If any value differs from the spec, update the spec in the same commit.
- [ ] **Step 1: Write failing tests**
  1. Token Plan routing: `resolveQwenBaseUrl({ keyType: 'token_plan', region: 'ap-southeast-1' })` returns `'https://token-plan.ap-southeast-1.maas.aliyuncs.com'`. `checkQwenKeyUrl('sk-sp-x', 'https://dashscope.aliyuncs.com').ok === false`, and the warning mentions `token-plan`.
  2. Standard routing: when `workspaceId` is set, the URL contains `{workspaceId}.ap-southeast-1.maas.aliyuncs.com`.
  3. Wan 3.0 validation: `first_frame` + `reference_image` throws `WanValidationError`. 11 `reference_image` items throw. 6 `reference_video` items throw.
  4. OSS header: media with an `oss://` URL gives `needsOssHeader === true`. Plain `data:` URLs give `false`.
  5. Model ID mismatch: for `wan2.7-t2v`, any `first_frame` throws (based on the verified catalog).
  6. Audio modes in `compileScenePrompt`:
     - `silent` gives `audio: false`, and the prompt contains no dialogue cue;
     - `dialogue` with script `Kai: "Run!"` gives `audio: true`, and the prompt contains the line;
     - `taggedElements` `[{ tag: '@Image 1', name: 'Kai', kind: 'character' }]` puts `@Image 1` into the prompt.
  7. Reference cap: `selectReferenceElements` with 8 characters, 3 props, and 2 locations and `max = 10` keeps 8 characters + 2 props, and drops 1 prop + 2 locations.
  8. Unknown models: `getModelCapabilities('my-new-wan')` throws without a custom row, and returns the custom row's capabilities when one exists.
- [ ] **Step 2: Run tests, expect FAIL.** Run: `bunx vitest run tests/wan-payload-and-routing.test.ts`
- [ ] **Step 3: Implement the four files.**
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** `feat: add Qwen routing, capability catalog, and Wan request builder`

---

### Task 4: QwenCloud & OpenAI-Compatible Clients, OSS Upload, Error Mapping

**Files:**
- Create: `src/lib/providers/qwen-oss.ts`, `src/lib/providers/qwen-client.ts`, `src/lib/providers/openai-text.ts`, `src/lib/providers/errors.ts`, `src/lib/providers/text.ts`
- Test: `tests/provider-clients.test.ts`

**Interfaces:** all functions take an injectable `fetchFn: typeof fetch = fetch`.
- `uploadToDashScopeOss({ baseUrl, apiKey, model, filePath, fetchFn }): Promise<string>`: returns `oss://...`.
- `prepareImageMedia({ ..., filePath, imageCountInRequest }): Promise<string>`: uses OSS when the file is >2MB or `imageCountInRequest > 1`, else a Base64 data URI.
- `submitVideoTask({ baseUrl, apiKey, body, needsOssHeader, fetchFn }): Promise<{ taskId: string }>`
- `getTaskStatus({ baseUrl, apiKey, taskId, fetchFn }): Promise<{ status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; resultUrls: string[]; errorCode?: string; errorMessage?: string }>`
- `generateImage(...)`: returns `{ kind: 'sync'; urls: string[] } | { kind: 'async'; taskId: string }`.
- `synthesizeSpeech(...)`: returns `{ kind: 'bytes'; data: Uint8Array; mime: string } | { kind: 'url'; url: string }`.
- `testQwenConnection(cfg): Promise<{ ok: boolean; detail: string }>`
- `chatCompletion({ baseUrl, apiKey, model, messages, fetchFn }): Promise<string>` and `testOpenAIConnection(...)`.
- `getTextChat(): ChatCompletionFn`: picks Qwen compatible-mode or OpenAI-compat based on `TEXT_PROVIDER`.
- `mapProviderError(code: string | undefined, httpStatus: number): { code: string; userMessage: string; retryable: boolean }`

- [ ] **Step 1: Write failing tests (mocked `fetchFn`)**
  1. OSS upload: calls `GET {base}/api/v1/uploads?action=getPolicy&model=wan3.0-video`, then POSTs `FormData` to `policy.upload_host` with key `${upload_dir}/<filename>`, and returns `oss://${upload_dir}/<filename>`.
  2. `prepareImageMedia`: a 1KB file with `imageCountInRequest = 1` returns a `data:image/png;base64,` URI. With `imageCountInRequest = 3`, it returns an `oss://` URL.
  3. `submitVideoTask`: sends `X-DashScope-Async: enable`. It sends `X-DashScope-OssResourceResolve: enable` only when `needsOssHeader` is set.
  4. Connection fallback: when `GET /models` returns 404, `testOpenAIConnection` falls back to a chat completion with `max_tokens: 1`.
  5. Error mapping:
     - `mapProviderError('DataInspectionFailed', 400)` gives `retryable: false` and a message mentioning content moderation;
     - `mapProviderError(undefined, 429)` gives `retryable: true`;
     - `mapProviderError('InvalidApiKey', 401)` mentions `.env.local`.
- [ ] **Step 2: Run tests, expect FAIL.** Run: `bunx vitest run tests/provider-clients.test.ts`
- [ ] **Step 3: Implement the clients.**
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** `feat: add QwenCloud and OpenAI-compatible clients with OSS upload and error mapping`

---

### Task 5: Story & Prompt Refiner

**Files:**
- Create: `src/lib/refiner/story-refiner.ts`
- Test: `tests/story-refiner.test.ts`

**Interfaces:**
- `refineStoryAndScenes({ roughIdea, styleBible?, targetSceneCount?, chat: ChatCompletionFn }): Promise<RefinedStory>`
- `RefinedStory` = `{ refinedStory, styleBible, elements: { kind, name, description }[], scenes: { title, linkedElementNames: string[], visualPrompt, cameraDirection, audioMode, audioScript, duration, videoMode }[] }`, validated with `zod`.
- `polishPrompt({ text, context: { styleBible?, audioMode?, cameraDirection? }, chat }): Promise<{ visualPrompt; cameraDirection; audioScript }>`. This is used by scene cards and Quick Clip.
- `resolveLinkedElementIds(scenes, savedElements: { id, name }[]): { sceneIndex, ids: string[], unknownNames: string[] }[]`: case-insensitive name match.

- [ ] **Step 1: Write failing tests**
  1. Fenced JSON: a valid response wrapped in ```` ```json ```` fences parses correctly.
  2. Repair retry: if the first response is malformed and the second valid, the function succeeds and `chat` was called twice, with a repair prompt containing the zod error.
  3. Hard failure: if both responses are invalid, it throws `RefinerError`.
  4. Value limits: `duration` is clamped to 2–30, and an unknown `audioMode` fails validation.
  5. Name resolution: `resolveLinkedElementIds` maps `'kai'` to Kai's id and reports `'Ghost'` in `unknownNames`.
- [ ] **Step 2: Run tests, expect FAIL.** Run: `bunx vitest run tests/story-refiner.test.ts`
- [ ] **Step 3: Implement the refiner.**
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** `feat: add story refiner with zod validation and repair retry`

---

### Task 6: Job Runner (Queue, Concurrency, Backoff, Resume, Downloads)

**Files:**
- Create: `src/lib/jobs/runner.ts`, `src/lib/jobs/persist.ts`, `src/instrumentation.ts`
- Test: `tests/job-runner.test.ts`

**Interfaces:**
- `enqueueJob(input: { projectId; sceneId?; elementId?; modality: 'image' | 'video' | 'audio'; role: AssetRole; modelId; request: PreparedRequest }): Job`: inserts a row with status `QUEUED`.
- `getRunner(): JobRunner`: a singleton on `globalThis.__aivsRunner`.
- `JobRunner` methods:
  - `tick(): Promise<void>`: submits `QUEUED` jobs while the active count is below `maxConcurrent`, and polls `PENDING`/`RUNNING` jobs.
  - `start(): void`: an interval at `pollIntervalMs`; idempotent.
  - `resume(): void`: re-adopts non-terminal jobs.
- `persistResult(job, source: { url } | { bytes, mime }): Promise<Asset>`:
  - writes the next-version file (`elements/<kind>_<slug>_v{n}.png`, `scenes/<NN>_<slug>/clip_v{n}.mp4`, etc.);
  - inserts an asset row;
  - sets the scene/element active pointer when none is set yet;
  - is idempotent: if the job already has a `result_asset_id`, it returns that asset.
- Dependencies (`submit`, `poll`, `download`) are injectable for tests.
- `src/instrumentation.ts`: `register()` calls `getRunner().resume(); getRunner().start()` when `NEXT_RUNTIME === 'nodejs'`.

- [ ] **Step 1: Write failing tests (fake clock + fake deps)**
  1. Concurrency cap: with `maxConcurrent = 2` and 3 queued jobs, one `tick()` submits exactly 2.
  2. Throttling backoff: a submit that throws a 429 increments `attempts`, keeps the job `QUEUED`, and sets the next-eligible time with exponential backoff. After 3 failed attempts the job becomes `FAILED`, with the mapped message.
  3. Moderation failure: a poll returning `FAILED` with `DataInspectionFailed` marks the job `FAILED` and stores `error_code`.
  4. Successful download: poll `SUCCEEDED` -> `DOWNLOADING` -> file written at `scenes/01_test/clip_v1.mp4`, then `READY` with the asset linked. A second poll of the same job creates no second asset.
  5. Single runner: `getRunner()` called twice returns the same instance, and `start()` twice creates one interval.
  6. Resume after restart: a pre-existing `RUNNING` job is polled after `resume()`, without being resubmitted.
- [ ] **Step 2: Run tests, expect FAIL.** Run: `bunx vitest run tests/job-runner.test.ts`
- [ ] **Step 3: Implement the runner.**
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** `feat: add job runner with concurrency cap, backoff, resume, and local persistence`

---

### Task 7: Kdenlive Export Builder

**Files:**
- Create: `src/lib/export/kdenlive.ts`
- Test: `tests/kdenlive-export.test.ts`

**Interfaces:**
- `rebuildKdenliveExport(projectId: string): Promise<{ dir: string; files: string[]; missingScenes: string[] }>`:
  - clears `export_kdenlive/`;
  - copies each scene's active video take as `${NN}_${sceneSlug}.mp4` (NN = 1-based position in current order, zero-padded to 2);
  - copies active voiceovers as `${NN}_${sceneSlug}_voiceover.mp3`;
  - writes `story.md`.
- `writeKdenliveProject(dir: string, clips: { file: string; durationSec: number }[], opts: { width; height; fps: 25 }): string`:
  - writes a minimal MLT XML `project.kdenlive`;
  - **verified manually by opening it in Kdenlive**. If it doesn't open cleanly, remove it from the export (spec permits).
- `streamExportZip(projectId): ReadableStream`, built with `archiver`.

- [ ] **Step 1: Write failing tests**
  1. Reorder: scenes A, B with clips. Export yields `01_a.mp4` and `02_b.mp4`. After reordering to B, A and exporting again, the folder holds exactly `01_b.mp4` and `02_a.mp4` (no stale files).
  2. Take switch: switching scene A's active take from v1 to v2 makes the exported file's bytes equal v2.
  3. Missing clips: a scene with no active clip appears in `missingScenes` and doesn't break numbering of the others.
  4. Project file: `writeKdenliveProject` output parses as XML and contains each clip filename in order.
- [ ] **Step 2: Run tests, expect FAIL.** Run: `bunx vitest run tests/kdenlive-export.test.ts`
- [ ] **Step 3: Implement the export builder.**
- [ ] **Step 4: Run tests, expect PASS.** Then manually open `project.kdenlive` from a generated sample in Kdenlive and record the result in the commit message.
- [ ] **Step 5: Commit** `feat: add Kdenlive export rebuild, ZIP, and starter project file`

---

### Task 8: API Route Handlers

**Files:**
- Create under `src/app/api/`:
  - `settings/status/route.ts`, `settings/test-connection/route.ts`, `settings/models/route.ts`, `settings/presets/route.ts`
  - `projects/route.ts`, `projects/[id]/route.ts`, `projects/[id]/refine/route.ts`, `projects/[id]/elements/route.ts`, `projects/[id]/scenes/route.ts`, `projects/[id]/export/route.ts`
  - `generate/element-sheet/route.ts`, `generate/keyframe/route.ts`, `generate/video/route.ts`, `generate/tts/route.ts`, `generate/batch/route.ts`, `polish/route.ts`, `upload/route.ts`
  - `jobs/route.ts`, `files/[...path]/route.ts`
- Create: `src/lib/studio/scene-request.ts`
- Test: `tests/scene-request.test.ts`, `tests/api-routes.test.ts`

**Interfaces:**
- `buildSceneVideoRequest(scene, elements, project, cap): Promise<{ payload: PreparedRequest; droppedElements: string[] }>`:
  - a pure-ish function (the OSS/Base64 prep is injected);
  - uses `selectReferenceElements` (cap = catalog `maxCounts.reference_image`), `compileScenePrompt` with `@Image N` tags, and `buildVideoSynthesisPayload`;
  - `first_last_frame` mode uses keyframe assets only.
- `POST /api/generate/batch`:
  - body: `{ projectId, kind: 'keyframes' | 'clips', sceneIds, confirm: boolean }`;
  - when `confirm` is false, returns `{ count, totalSeconds, resolution, model }` without enqueuing;
  - when true, enqueues all.
- Route handlers are thin: zod-validate input, call `src/lib/*`, return JSON. Errors use `{ error: { code, message } }`.

- [ ] **Step 1: Write failing tests**

`scene-request.test.ts`:
- Omni-reference mode with 12 linked elements: 10 `reference_image` items in cap order, `droppedElements.length === 2`, prompt contains `@Image 1`.
- `first_last_frame` mode with linked elements: the payload has `first_frame` and no `reference_image`.
- `first_last_frame` mode with no keyframe asset: throws a message telling the user to generate a keyframe in Stage 2.

`api-routes.test.ts` (import handlers directly, `DATA_DIR`/`PROJECTS_DIR` set to tmp, provider deps mocked):
- `GET /api/settings/status` never contains the raw key string.
- `POST /api/projects` creates the row and directory.
- `POST /api/generate/batch` with `confirm: false` returns the totals and enqueues 0 jobs.
- `GET /api/files/..%2F..%2Fetc%2Fpasswd` returns 400.
- `POST /api/generate/video` with mixed frame + reference input returns 400 with code `WAN_VALIDATION`.
- [ ] **Step 2: Run tests, expect FAIL.**
- [ ] **Step 3: Implement the routes and `scene-request.ts`.**
- [ ] **Step 4: Run `bunx vitest run`, expect PASS.**
- [ ] **Step 5: Commit** `feat: add API routes and scene request builder`

---

### Task 9: UI Shell, Settings & Quick Clip

**Files:**
- Init: `bunx shadcn@latest init` (dark theme), then add `button card dialog input textarea select tabs badge tooltip sonner`
- Create: `src/components/NavSidebar.tsx`, `src/components/JobStatusBadge.tsx`, `src/components/AudioModeSelect.tsx`, `src/components/MediaModePicker.tsx`, `src/hooks/useJobs.ts`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `src/app/settings/page.tsx`, `src/app/quick-clip/page.tsx`
- Create: `src/lib/studio/media-mode.ts`
- Test: `tests/media-mode.test.ts`

**Interfaces:**
- `mediaModeState(mode: VideoMode, cap: ModelCapability, attached: { firstFrame?; lastFrame?; refImages: number; refVideos: number; refAudios: number }): { disabledSlots: MediaType[]; reasons: Record<string, string>; canSubmit: boolean }`: the single source of truth for disabling slots and their tooltips.
- `useJobs(filter)`: polls `/api/jobs` every 3s while any listed job is non-terminal.

- [ ] **Step 1: Write failing tests for `mediaModeState`**
  1. First-frame mode: `reference_image`, `reference_video`, and `reference_audio` are disabled, with a reason mentioning "cannot be combined".
  2. Slot limits: 10 reference images makes the `reference_image` slot disabled (limit reached).
  3. Model capability: for `wan2.7-t2v`, the frame slots are disabled.
- [ ] **Step 2: Run tests, expect FAIL.** Then implement `media-mode.ts`, and run again for PASS.
- [ ] **Step 3: Build the shell and Projects dashboard** (project list, New Project dialog with style preset picker, links to Quick Clip and Settings).
- [ ] **Step 4: Build `/settings`:**
  - provider status (masked keys, key type, region, resolved base URL, mismatch warning);
  - Test Connection buttons;
  - "Edit `.env.local` and restart" guidance when unconfigured;
  - custom model form;
  - style preset list.
- [ ] **Step 5: Build `/quick-clip`:**
  - prompt + Polish;
  - `AudioModeSelect`;
  - `MediaModePicker` (driven by `mediaModeState`);
  - uploads;
  - `JobStatusBadge`;
  - inline preview;
  - mapped error messages.
- [ ] **Step 6: Run `bunx vitest run && bun run build`, expect PASS.**
- [ ] **Step 7: Commit** `feat: add UI shell, settings, and Quick Clip studio` (and update `README.md` with screenshots/usage)

---

### Task 10: Storyboard Stages 1 & 2 (Story, Elements, Keyframes)

**Files:**
- Create: `src/app/projects/[id]/page.tsx`, `src/components/studio/StageTabs.tsx`, `src/components/studio/Stage1Story.tsx`, `src/components/studio/SceneCard.tsx`, `src/components/studio/Stage2Elements.tsx`, `src/components/studio/ElementCard.tsx`, `src/components/studio/BatchConfirmDialog.tsx`

- [ ] **Step 1: Build Stage 1:**
  - Auto-Refine;
  - editable story and Style Bible ("Save as Preset");
  - element roster grouped by kind;
  - Scene Cards with reorder, add, delete, and AI Polish;
  - linked-element chips, with a warning for unknown names.
- [ ] **Step 2: Build Stage 2:**
  - element sheets (generate or upload, version history, set active);
  - per-scene keyframes and "Generate All Keyframes" through `BatchConfirmDialog` (shows count, seconds, model);
  - collapsed optional TTS.
- [ ] **Step 3: Manual check:** run `bun run dev` with a real `.env.local`. Create a project, refine, generate one element sheet and one keyframe, and confirm the files appear under `projects/<slug>/`.
- [ ] **Step 4: Run `bunx vitest run && bun run build`, expect PASS.**
- [ ] **Step 5: Commit** `feat: add storyboard stages 1-2 with element library and keyframes`

---

### Task 11: Storyboard Stage 3 (Video, Shot Strip, Export)

**Files:**
- Create: `src/components/studio/Stage3Video.tsx`, `src/components/studio/ShotStrip.tsx`, `src/components/studio/TakeHistory.tsx`, `src/components/studio/ExportPanel.tsx`

- [ ] **Step 1: Build Stage 3:**
  - per-scene generate with `MediaModePicker`;
  - "dropped elements" notice from `droppedElements`;
  - "Generate All Clips" through `BatchConfirmDialog`;
  - live badges;
  - `TakeHistory` (set active take);
  - `ShotStrip` showing active keyframe/clip thumbnails in order.
- [ ] **Step 2: Build `ExportPanel`:** "Rebuild Export" (calls `/export`), shows the folder path, `missingScenes`, the ZIP download, and a `project.kdenlive` link if present.
- [ ] **Step 3: Manual check:** generate one real clip, reorder scenes, export, and confirm the `export_kdenlive/` contents and Kdenlive import.
- [ ] **Step 4: Run `bunx vitest run && bun run build`, expect PASS.** Update `README.md` (full workflow) and `AGENTS.md`.
- [ ] **Step 5: Commit** `feat: add stage 3 video generation, shot strip, takes, and Kdenlive export`
