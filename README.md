# AI Video Studio (`ai-video-web`)

A local-first AI video studio built with Next.js App Router, SQLite, and Alibaba Cloud Model Studio (Qwen and Wan). It ships a guided three-stage storyboard studio, a consistent element library, a Quick Clip workspace, and Kdenlive-ready exports. All provider calls, uploads, job polling, and downloads run on your machine.

The app also contains a complete in-site manual. Press `?` (or use **How it works** in the sidebar) for the field-by-field workflow guide.

## Requirements

- **Node.js 20 or newer.** Next.js must run on Node because `better-sqlite3` is a native addon. Do not pass `--bun` to Next.js.
- **Bun** for installing packages and running scripts.

## Quickstart

```bash
bun install
cp .env.example .env.local
# Edit .env.local and add QWEN_API_KEY
bun run dev
```

Open `http://localhost:3000`. Configuration is read lazily on the server, so restart the dev server after editing `.env.local`.

## Commands

| Command | What it does |
| --- | --- |
| `bun install` | Install dependencies. |
| `bun run dev` | Start the Next.js dev server on Node. |
| `bun run build` | Create a production build. |
| `bun run start` | Serve the production build. |
| `bun run test` | Run the Vitest suite. |
| `bun run lint` | Run ESLint. |
| `bun run db:generate` | Generate Drizzle SQLite migrations into `drizzle/`. |

## Environment variables

`src/lib/config.ts` reads these variables through a Zod schema. Empty values fall back to the listed default. A value outside the accepted range makes configuration invalid, and the app reports it on **Settings → Provider Status** and in API errors.

### Paths

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `DATA_DIR` | No | `./data` | Any writable path, absolute or relative to the repo root | Directory for `studio.db` (SQLite metadata). Changing it after first run points the app at a new, empty database unless you move the old file. |
| `PROJECTS_DIR` | No | `./projects` | Any writable path, absolute or relative to the repo root | Root for project media. Each project gets `<slug>/` containing `story.md`, `elements/`, `scenes/`, and `export_kdenlive/`. Changing it hides existing media from the app until you move the folders. |

### Provider key and routing

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `QWEN_API_KEY` | Yes for generation | empty | DashScope key `sk-...` or Token Plan key `sk-sp-...` | Server-side credential for Qwen and Wan calls. It is never stored in SQLite, never sent to the browser, and API responses only return a masked preview. |
| `QWEN_KEY_TYPE` | No | `auto` | `auto`, `token_plan`, `standard` | How to route the key. `auto` treats keys starting with `sk-sp-` as `token_plan` and all other keys as `standard`. `token_plan` forces the Token Plan host; `standard` forces DashScope or workspace routing. |
| `QWEN_REGION` | No | `ap-southeast-1` | `ap-southeast-1`, `cn-beijing` | Region for Token Plan and workspace hosts. It also selects the standard DashScope host. |
| `QWEN_WORKSPACE_ID` | No | empty | Model Studio workspace ID | Standard keys only. When set, requests go to `https://<workspace-id>.<region>.maas.aliyuncs.com` instead of the shared DashScope host. |
| `QWEN_BASE_URL` | No | empty | Full `https://` URL | Hard override for every Qwen and DashScope request. It wins over key type, region, and workspace routing. Use it only for a proxy or gateway that speaks the same API. |

### Model selection

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `QWEN_TEXT_MODEL` | No | `qwen-plus` | Any text model ID known to the app | Story refinement and prompt polishing when `TEXT_PROVIDER=qwen`. |
| `QWEN_IMAGE_MODEL` | No | `wan2.7-image-pro` | Any image model ID known to the app | Element reference sheets and scene keyframes. |
| `QWEN_VIDEO_MODEL` | No | `wan3.0-video` | Any video model ID known to the app | Default model for new projects and for Quick Clip. Each project can override it later. |
| `QWEN_TTS_MODEL` | No | `qwen-audio-3.0-tts-plus` | Any audio or TTS model ID known to the app | Standalone voiceover generation in Stage 2. |

A model ID must exist in the built-in catalog (`src/lib/providers/catalog.ts`) or be registered as a custom model. Otherwise the job fails with `UnknownModelError`. See [Model catalog and adding newer models](#model-catalog-and-adding-newer-models).

### Text provider

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `TEXT_PROVIDER` | No | `qwen` | `qwen`, `openai_compat` | Provider used for refinement and polish. `qwen` uses `QWEN_TEXT_MODEL` through the DashScope compatible endpoint. `openai_compat` uses the three variables below. |
| `OPENAI_COMPAT_BASE_URL` | When `TEXT_PROVIDER=openai_compat` | empty | Full `https://` or `http://` URL | Base URL of an OpenAI-compatible endpoint, for example `http://localhost:11434/v1`. |
| `OPENAI_COMPAT_MODEL` | When `TEXT_PROVIDER=openai_compat` | empty | Model ID accepted by that endpoint | Text model name used for refinement and polish. |
| `OPENAI_COMPAT_API_KEY` | No | empty | Any bearer token string | Optional credential for that endpoint. Media generation still uses `QWEN_API_KEY`. |

### Job runner

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `MAX_CONCURRENT_JOBS` | No | `2` | Integer 1–16 | Maximum provider jobs running at once. Raise it for faster batches; lower it if you hit rate limits. |
| `JOB_POLL_INTERVAL_MS` | No | `10000` | Integer 1000–120000 | How often the server asks the provider for task status. The browser polls the local job list every 3 seconds regardless. Lower values detect completion sooner and make more provider requests. |

### Routing rules

The app resolves one base URL for every provider request:

1. `QWEN_BASE_URL` wins when set.
2. A Token Plan key (`sk-sp-...`) or `QWEN_KEY_TYPE=token_plan` goes to `https://token-plan.<region>.maas.aliyuncs.com`.
3. A standard key with `QWEN_WORKSPACE_ID` goes to `https://<workspace-id>.<region>.maas.aliyuncs.com`.
4. A standard key without a workspace goes to `https://dashscope-intl.aliyuncs.com` for `ap-southeast-1` or `https://dashscope.aliyuncs.com` for `cn-beijing`.

Pairing a Token Plan key with a DashScope host, or a standard key with a Token Plan host, returns `401 InvalidApiKey`. Provider Status shows a key and URL mismatch warning when it detects that pairing.

### Example configurations

Token Plan in Singapore:

```dotenv
QWEN_API_KEY=sk-sp-your-key
QWEN_KEY_TYPE=auto
QWEN_REGION=ap-southeast-1
QWEN_VIDEO_MODEL=wan3.0-video
```

Standard DashScope key in Beijing with a workspace:

```dotenv
QWEN_API_KEY=sk-your-key
QWEN_KEY_TYPE=standard
QWEN_REGION=cn-beijing
QWEN_WORKSPACE_ID=your-workspace-id
```

Local text model with Qwen media:

```dotenv
QWEN_API_KEY=sk-your-key
TEXT_PROVIDER=openai_compat
OPENAI_COMPAT_BASE_URL=http://localhost:11434/v1
OPENAI_COMPAT_MODEL=qwen3.5:8b
```

## Model catalog and adding newer models

The app resolves a model in two steps. It checks custom models in SQLite first, then the built-in catalog. Each entry supplies a capability profile: allowed media types, per-slot caps, duration range, resolutions, and native-audio support. The studio uses that profile to enable or disable media slots and validate requests.

### Built-in IDs

| Modality | Built-in model IDs | Notes |
| --- | --- | --- |
| Video | `wan3.0-video`, `wan3.0-video-prime`, `wan2.7-t2v`, `wan2.7-i2v`, `wan2.7-r2v` | `wan3` handles all media modes in one model. The `wan2.7` entries are split by mode: text-to-video, first/last frame, and reference-to-video. |
| Image | `wan2.7-image-pro`, `wan2.7-image`, `qwen-image-3.0` | Used for element sheets and keyframes. |
| Audio | `qwen-audio-3.0-tts-plus` | Used for voiceover. |
| Text | `qwen-plus`, `qwen-max`, `qwen-turbo` | Used for refinement and polish. |

### Capability profiles by family

| Family | Modality | Media and limits | Other defaults |
| --- | --- | --- | --- |
| `wan3` | Video | `first_frame` 1, `last_frame` 1, `reference_image` 10, `reference_video` 5, `reference_audio` 5 | 2–30 seconds, 480P/720P/1080P, native audio |
| `wan2.7` | Video | Mode-specific: no media for `wan2.7-t2v`, first and last frames for `wan2.7-i2v`, references for `wan2.7-r2v` | 2–15 seconds, 480P/720P/1080P, native audio |
| `wan2.7` | Image | Up to 9 `reference_image` | 1024*1024, 1280*720, 720*1280, 1920*1080, 1080*1920 |
| `qwen-image` | Image | Up to 3 `reference_image` | 1024*1024, 1280*720, 720*1280 |
| `qwen-tts` | Audio | No input media | No duration or resolution options |
| `text` | Text | No input media | No duration or resolution options |

The family you pick when registering a custom model selects one of these templates. Family names outside this list fall back by modality: video to `wan3`, image to `qwen-image`, audio to `qwen-tts`, text to `text`.

### Where to find newer models

Use the official Model Studio sources, not blog posts or reseller pages:

- **Recommended models, all modalities:** [https://www.alibabacloud.com/help/en/model-studio/models](https://www.alibabacloud.com/help/en/model-studio/models)
- **Newly released models:** [https://www.alibabacloud.com/help/en/model-studio/newly-released-models](https://www.alibabacloud.com/help/en/model-studio/newly-released-models)
- **Wan 3.0 model page:** [https://www.alibabacloud.com/help/en/model-studio/wan3-0-video](https://www.alibabacloud.com/help/en/model-studio/wan3-0-video)
- **Wan 3.0 API reference:** [https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference](https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference)
- **Model Plaza, browse and compare every ID:** [https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/market](https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/market)
- **Video model list:** [https://docs.modelstudio.console.alibabacloud.com/en/model-studio/model-list-video-generation](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/model-list-video-generation)
- **Image models:** [https://www.alibabacloud.com/help/en/model-studio/image-model](https://www.alibabacloud.com/help/en/model-studio/image-model)
- **TTS models:** [https://www.alibabacloud.com/help/en/model-studio/tts-model](https://www.alibabacloud.com/help/en/model-studio/tts-model)

Copy the exact API model ID, not the display name. IDs are case-sensitive and often include a version suffix.

### Steps to adopt a newer model

1. Find the exact ID in the sources above.
2. Check the request shape on the model page and API reference. Confirm the media slots, caps, duration range, resolutions, and whether audio is native.
3. Open **Settings → Custom Models** and add the ID, a display name, the modality, and the closest family. The app writes the model to SQLite and lists it in model pickers immediately; no restart is needed.
4. If the model needs different limits from its family template, edit the template in `src/lib/providers/catalog.ts`. The Custom Models form does not expose per-model capability overrides, so a new API shape or a different cap requires a code change.
5. If the provider changed parameter names, media types, or the response format, update `src/lib/providers/types.ts`, `src/lib/providers/qwen-client.ts`, and `src/lib/providers/wan-payload.ts` as needed.
6. Point `QWEN_VIDEO_MODEL`, `QWEN_IMAGE_MODEL`, `QWEN_TTS_MODEL`, or `QWEN_TEXT_MODEL` at the new ID, or choose it as a project default. Environment changes require a restart.
7. Verify on **Settings → Provider Status** with **Test Qwen**, then run one small job and watch it reach `READY`.

Docs may list IDs the app has not modeled yet. For example, the catalog currently ships `qwen-image-3.0`, while the public model list also shows `qwen-image-3.0-pro`, and the current TTS family includes newer `qwen-audio-3.1-*` IDs. Register those through Custom Models only after confirming they accept the request shape used by the matching family.

## Recommended workflow

Setup once, then follow three stages per project:

1. **Create a project** with an idea, style preset, aspect ratio, resolution, and default video model.
2. **Stage 1, Story & Scenes:** write the rough idea, run Auto-Refine, then edit the story, Style Bible, elements, and scene prompts.
3. **Stage 2, Elements & Keyframes:** generate or upload reference sheets, generate first and last keyframes, and optionally add TTS voiceover.
4. **Stage 3, Video & Export:** choose a media mode per scene, generate clips, promote the best take, then rebuild and download the Kdenlive export.

Quick Clip skips the project and generates one shot with the same models and media rules.

The in-site guide covers every field, mode, status, limit, and export artifact. It opens with `?` or the sidebar button.

## Studio and data layout

| Path | Contents |
| --- | --- |
| `data/studio.db` | Projects, elements, scenes, asset records, jobs, custom models, and style presets. |
| `projects/<slug>/story.md` | The written treatment for the export. |
| `projects/<slug>/elements/` | Reference sheets and uploaded element images. |
| `projects/<slug>/scenes/` | Keyframes, clips, and voiceover files. |
| `projects/<slug>/export_kdenlive/` | The latest Kdenlive export, including `project.kdenlive` and `story.md`. |
| `projects/_quick-clips/` | Hidden project that stores Quick Clip jobs and media. |

Back up `DATA_DIR` and `PROJECTS_DIR` together while the server is stopped. Restoring only the database breaks media paths. Jobs resume automatically when the server starts.

## Kdenlive export

**Rebuild Export** rewrites `export_kdenlive/` from the current scene order and active takes. It copies each scene's active clip and voiceover, writes `story.md`, and generates a starter `project.kdenlive` timeline when clips exist. Scenes without an active clip are listed in the panel so you can generate them before shipping. **Download ZIP** packages the latest rebuild.

## Security

- Store keys only in `.env.local`. Never commit `.env`, `.env.local`, `data/`, `projects/`, or `.superpowers/`.
- Provider responses expose masked keys only, for example `sk-sp-****cdef`.
- Keep the server on Node. Bun can run scripts, but Next.js and `better-sqlite3` need the Node runtime.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Provider key is not configured | `QWEN_API_KEY` is empty | Add the key to `.env.local` and restart. |
| `401 InvalidApiKey` | Key type and endpoint do not match | Fix `QWEN_KEY_TYPE`, `QWEN_REGION`, `QWEN_WORKSPACE_ID`, or `QWEN_BASE_URL`. Provider Status shows the mismatch warning. |
| `429` or repeated throttling | Too many concurrent jobs | Lower `MAX_CONCURRENT_JOBS`, raise `JOB_POLL_INTERVAL_MS`, and wait before retrying. |
| `UnknownModelError` | The model ID is neither built in nor registered | Add it in Settings → Custom Models or pick a built-in ID. |
| Job stays `RUNNING` for a long time | Provider is still generating | Wait. Video jobs can take several minutes. Do not resubmit. |
| Output has no audio | The selected model does not support native audio | Pick a native-audio video model, or keep `silent` audio mode. |
| Export lists missing scenes | Those scenes have no active take | Generate a clip and click **Set Active**, then rebuild. |
| Configuration error on startup | A value violates the Zod schema | Check ranges for `MAX_CONCURRENT_JOBS`, `JOB_POLL_INTERVAL_MS`, and required OpenAI-compatible fields. |