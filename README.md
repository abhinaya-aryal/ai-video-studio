# AI Video Studio (`ai-video-web`)

A local-first AI video studio built with Next.js App Router, SQLite, and Alibaba Cloud Model Studio (Qwen and Wan). It ships a guided three-stage storyboard studio, a consistent element library, a Quick Clip workspace, and a flat media folder ready for Kdenlive. All provider calls, uploads, job polling, and downloads run on your machine.

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

Open `http://localhost:3000`. Configuration is read lazily on the server, so restart the dev server after editing `.env.local`. Project media is written to `~/projects/<slug>/` by default; set `PROJECTS_DIR` to change it. Before generating, open **Settings → Models**, press **Sync models**, then choose a model per role or turn on Auto.

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
| `PROJECTS_DIR` | No | `~/projects` | Any writable path. `~` expands to your home directory; relative paths resolve from the repo root | Root for project media. Each project gets `<slug>/` containing `story.md`, flat media files, `elements/`, and `scenes/`. Changing it hides existing media from the app until you move the folders. |

`PROJECTS_DIR` points outside the repository by default, so generated footage stays out of git. Set it to an absolute path if you want a different drive, for example `PROJECTS_DIR=/mnt/media/ai-video`. Creating a project whose slug already exists on disk adds a short suffix instead of writing into that folder.

### Provider key and routing

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `QWEN_API_KEY` | Yes for generation | empty | DashScope key `sk-...` or Token Plan key `sk-sp-...` | Server-side credential for Qwen and Wan calls. It is never stored in SQLite, never sent to the browser, and API responses only return a masked preview. |
| `QWEN_KEY_TYPE` | No | `auto` | `auto`, `token_plan`, `standard` | How to route the key. `auto` treats keys starting with `sk-sp-` as `token_plan` and all other keys as `standard`. `token_plan` forces the Token Plan host; `standard` forces DashScope or workspace routing. |
| `QWEN_REGION` | No | `ap-southeast-1` | `ap-southeast-1`, `cn-beijing` | Region for Token Plan and workspace hosts. It also selects the standard DashScope host. |
| `QWEN_WORKSPACE_ID` | No | empty | Model Studio workspace ID | Standard keys only. When set, requests go to `https://<workspace-id>.<region>.maas.aliyuncs.com` instead of the shared DashScope host. |
| `QWEN_BASE_URL` | No | empty | Full `https://` URL | Hard override for every Qwen and DashScope request. It wins over key type, region, and workspace routing. Use it only for a proxy or gateway that speaks the same API. |

### Model selection

Models are not configured through environment variables. The app reads the model list that your API key can access, stores it in SQLite, and you choose a model per role in **Settings → Models**. See [Models](#models).

### Text provider

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `TEXT_PROVIDER` | No | `qwen` | `qwen`, `openai_compat` | Provider used for refinement and polish. `qwen` uses the model selected for the text roles. `openai_compat` uses the three variables below. |
| `OPENAI_COMPAT_BASE_URL` | When `TEXT_PROVIDER=openai_compat` | empty | Full `https://` or `http://` URL | Base URL of an OpenAI-compatible endpoint, for example `http://localhost:11434/v1`. |
| `OPENAI_COMPAT_MODEL` | When `TEXT_PROVIDER=openai_compat` | empty | Model ID accepted by that endpoint | Text model name used for refinement and polish. |
| `OPENAI_COMPAT_API_KEY` | No | empty | Any bearer token string | Optional credential for that endpoint. Media generation still uses `QWEN_API_KEY`. |

### Job runner

| Variable | Required | Default | Accepted values | Purpose |
| --- | --- | --- | --- | --- |
| `MAX_CONCURRENT_JOBS` | No | `3` | Integer 1–16 | Maximum provider jobs running at once. Raise it for faster batches; lower it if you hit rate limits. |
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

## Model catalog, sync, and adding newer models

The token decides which models the app can use. **Sync models** imports every ID the provider lists. Capability rules still come from family templates in `src/lib/providers/catalog.ts`, because the metadata endpoint returns IDs only. Each profile supplies allowed media types, per-slot caps, duration range, resolutions, and native-audio support. The studio uses that profile to enable media slots and validate requests.

### Built-in capability templates

These IDs ship with hand-checked rules. Sync adds them when the token offers them, and manual entries can reuse the same families.

| Modality | Built-in model IDs | Notes |
| --- | --- | --- |
| Video | `wan3.0-video`, `wan3.0-video-prime`, `wan2.7-t2v`, `wan2.7-i2v`, `wan2.7-r2v` | `wan3` handles all media modes in one model. The `wan2.7` entries are split by mode: text-to-video, first/last frame, and reference-to-video. |
| Image | `wan2.7-image-pro`, `wan2.7-image`, `qwen-image-3.0` | Used for element images and keyframes. |
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

1. Open **Settings → Models** and press **Sync models**. If the token can use the ID, it appears with inferred rules.
2. If Sync does not return it, find the exact ID in the sources above and add it manually with a modality and family. Manual rows appear in pickers immediately; no restart is needed.
3. Check the request shape on the model page. If it differs from its family, open **Rules** on the model row and edit the capability JSON. Saving marks the row as edited, so later syncs leave your rules alone.
4. If the provider changed parameter names, media types, or the response format, update `src/lib/providers/types.ts`, `src/lib/providers/qwen-client.ts`, and `src/lib/providers/wan-payload.ts` as needed.
5. Choose the model for the role in **Settings → Models**, or set it as a project override. Changes apply to new jobs only.
6. Verify on **Settings → Provider Status** with **Test Qwen**, then run one small job and watch it reach `READY`.

Docs may list IDs the app has not modeled yet. For example, the catalog ships `qwen-image-3.0`, while the current token also offers `qwen-image-3.0-pro`. Sync imports the pro ID with the `qwen-image` family rules; widen the rules in the editor only after confirming the model accepts them.

## Recommended workflow

Setup once, then follow three stages per project:

1. **Create a project** with an idea, style preset, aspect ratio, resolution, and default video model.
2. **Stage 1, Story & Scenes:** write the rough idea, run Auto-Refine, then edit the story, Style Bible, elements, and scene prompts.
3. **Stage 2, Elements & Keyframes:** generate or upload one image per element, generate first and last keyframes, and optionally add TTS voiceover.
4. **Stage 3, Video & Assets:** choose a media mode per scene, generate clips, promote the best take, then open the project folder and drag the flat files into Kdenlive.

Quick Clip skips the project and generates one shot with the same models and media rules.

The in-site guide covers every field, mode, status, limit, and asset artifact. It opens with `?` or the sidebar button.

## Models

Open **Settings → Models** to choose models. Nothing is preselected. Until each role resolves, the matching action stays blocked and the API returns `409 MODEL_NOT_SELECTED`.

### Sync

**Sync models** calls `GET /compatible-mode/v1/models` with your key and stores every ID the token can use. This is a metadata call: it invokes no model and spends no tokens. The app also syncs once when the registry is empty. The list shows a relative cost tier and whether each row came from the token or from a manual entry.

A model the token does not list can still be added manually with its modality and family. Manual rows survive sync and keep their rules.

### Roles

| Role | Used by |
| --- | --- |
| `text_refine` | Story refinement and the connection test |
| `text_polish` | Prompt polish |
| `image` | Element images and scene keyframes |
| `video` | Scene clips and Quick Clip |
| `audio` | Voiceover |

Each role is **Manual** (one model) or **Auto**. A project can override the video role, and a request can override any role.

### Auto presets

| Preset | Text refine | Text polish | Image | Video | Audio |
| --- | --- | --- | --- | --- | --- |
| Quality | Highest tier | Highest tier | High tier | High tier | Best TTS |
| Balanced | Mid tier, newest | Cheapest usable | Mid tier | Any capable, mid first | Best TTS |
| Economy | Cheap tier | Cheapest usable | Cheap tier | Cheapest capable | Best TTS |

Cost tiers come from model ID signals (`prime`, `max`, `pro` are high; `flash`, `turbo`, `air` are low) because the provider returns no prices. The resolved model and its reason appear in the UI. Auto picks up a newer model that matches the tier on the next sync.

### Usage

Chat responses carry token counts. Media jobs record one unit per image or clip when the provider sends no usage block. **Settings → Models** and **Settings → Provider Status** show totals for the last 7 days; `GET /api/settings/usage?range=today|7d|30d&projectId=...` backs both. Usage is observation only: no hard caps and no change to retry behavior.

## Prompt refinement

Auto-Refine and the **Polish Prompt** buttons share one prompt framework. Every scene prompt is built from six dimensions, in order:

1. Shot framing and motion
2. Style, with a concrete reference world instead of "cinematic"
3. Lighting source and quality
4. Location, in one concise phrase
5. Action, with a specific subject and event
6. Text and audio, including an explicit `No text.` or audio direction

The refiner also uses technical camera terms (`dolly zoom`, `rack focus`, `low-angle orbit`, `OTS`, `locked off`) and keeps 4 to 6 core elements so details do not compete. Audio follows the selected mode: `silent` becomes `Silent.`, `ambient_only` names the acoustic environment and a foreground sound, and `narration` or `dialogue` writes the spoken line.

Polish returns three fields. Quick Clip appends Camera and Audio lines to the prompt textarea. Project scene cards write the visual prompt, camera direction, and audio script into their matching fields.

## Studio and data layout

| Path | Contents |
| --- | --- |
| `data/studio.db` | Projects, elements, scenes, asset records, jobs, custom models, and style presets. |
| `~/projects/<slug>/story.md` | The written treatment, rewritten on every media sync. |
| `~/projects/<slug>/<flat media files>` | One flat copy of every generated keyframe, clip, voiceover, and element image, ready to drag into Kdenlive. |
| `~/projects/<slug>/.project-media.json` | Manifest of the flat files the app wrote, used to prune replaced assets. |
| `~/projects/<slug>/elements/` | Internal source folder for generated and uploaded element images. |
| `~/projects/<slug>/scenes/` | Internal source folder for keyframes, clips, and voiceover files. |
| `~/projects/_quick-clips/` | Hidden project that stores Quick Clip jobs and media. |

Back up `DATA_DIR` and `PROJECTS_DIR` together while the server is stopped. Restoring only the database breaks media paths. Jobs resume automatically when the server starts.

## Project media folder

Every generated keyframe, clip, voiceover, and element image is copied into `PROJECTS_DIR/<slug>/` as a flat file as soon as its job finishes, and element uploads land there too. Filenames combine the scene slug and asset version, for example `01-lights-camera_clip_v2.mp4` or `element_character_kira-voss_v1.png`, so alternate takes are never overwritten. `story.md` and `.project-media.json` are refreshed at the same time. Open the folder in your file manager and drag the assets into Kdenlive to build the edit yourself. The app only deletes flat files it wrote and that no longer match an asset row, such as a replaced element image.

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
| `UnknownModelError` | The model ID is neither built in nor registered | Sync models, or add it manually in Settings → Models. |
| `409 MODEL_NOT_SELECTED` | No model is chosen for that role | Open Settings → Models, pick a model or turn on Auto for the role. |
| `409 MODEL_UNAVAILABLE` | The chosen model is no longer offered to the token | Sync, then pick an available model. |
| Sync returns zero models | The token has no model access, or the key/region pair is wrong | Check Provider Status and the key type. |
| Job stays `RUNNING` for a long time | Provider is still generating | Wait. Reference-image generation and video can take several minutes. Image tasks that stay pending or running beyond 15 minutes are failed, and video tasks after 60 minutes. Do not resubmit. |
| Jobs stay `QUEUED` and nothing starts | A crashed or duplicate process left jobs in `DOWNLOADING` | Stop every extra `next dev` / `next start` process for the same `DATA_DIR`. The runner repairs stuck jobs on the next tick. |
| Output has no audio | The selected model does not support native audio | Pick a native-audio video model, or keep `silent` audio mode. |
| Media missing from the project folder | The flat sync could not copy a file | Generate or upload another asset to trigger a re-sync, and check that `PROJECTS_DIR` is writable. |
| Configuration error on startup | A value violates the Zod schema | Check ranges for `MAX_CONCURRENT_JOBS`, `JOB_POLL_INTERVAL_MS`, and required OpenAI-compatible fields. |