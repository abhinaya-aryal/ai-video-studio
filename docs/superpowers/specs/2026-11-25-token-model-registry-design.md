# Token-driven model registry

Date: 2026-11-25
Status: Awaiting review

## Problem

The studio reads four model defaults from environment variables: `QWEN_TEXT_MODEL`, `QWEN_IMAGE_MODEL`, `QWEN_VIDEO_MODEL`, and `QWEN_TTS_MODEL`. Changing a model means editing `.env.local`, restarting the server, and knowing the model ID in advance. The hardcoded catalog in `src/lib/providers/catalog.ts` has the same problem: a new release needs a code change before anyone can use it.

Every Token Plan and DashScope key can already list the models it may call:

```
GET {resolved base}/compatible-mode/v1/models
```

A probe with the current Token Plan key returned 21 IDs across video, image, audio, and text, including `wan3.0-video`, `qwen-image-3.0-pro`, `qwen-audio-3.0-tts-plus`, and several text models. The provider, not the repository, decides what the token can use.

## Goals

- Discover models from the configured token and list them in the UI.
- Let the user select models in the app, with no model selected on a fresh install.
- Offer an Auto mode with Quality, Balanced, and Economy presets that trade quality against token spend.
- Split text work into a refine role and a cheaper polish role.
- Record provider token usage per job and surface totals per project and per day.
- Block generation with a clear message while a required slot has no selection.
- Infer media rules for discovered IDs and let the user correct them.
- Remove the four model environment variables and `getConfig().qwen.models`.

## Non-goals

- Currency-accurate pricing. The models endpoint returns no billing data, so cost tiers are relative heuristics.
- Hard token caps or changes to retry behavior. Usage tracking observes spend; it does not enforce budgets.
- Live capability discovery. The endpoint returns IDs only.
- Provider-side model management such as fine-tunes or deployments.
- Discovery for the OpenAI-compatible text provider. `OPENAI_COMPAT_MODEL` continues to apply when `TEXT_PROVIDER=openai_compat`.
- Changing the model recorded on existing assets and jobs.

## Provider calls and token cost

Only generation consumes tokens. The feature adds two kinds of calls, neither of which bills tokens:

- `GET /compatible-mode/v1/models` returns model metadata. It is a control-plane request, like listing files, and never invokes a model.
- `/api/settings/usage` reads local SQLite rows and calls no provider.

Auto resolution, capability inference, and selection validation run in process. This feature adds no polling or scheduled provider call. The one automatic sync fires only when a key exists and the registry is empty.

## Decisions

| Topic | Decision |
| --- | --- |
| Selection surface | Global selections per role in Settings, with existing per-project and per-request overrides. |
| Fresh install | No selection and no fallback model. Actions stay blocked until the user syncs and picks. |
| Registry storage | Persist discovered models in SQLite. Sync on demand plus once when the registry is empty. |
| Unknown models | Store and list them with conservative rules: text-to-video, text-to-image, TTS. |
| Auto | Opt-in mode with Quality, Balanced, and Economy presets, resolved at read time from the available list. Balanced is the preset default, not a model default. |
| Text roles | Separate `text_refine` and `text_polish` slots so polish can use a cheaper model. |
| Usage | Record provider token counts per job; show totals per project and per day. Observation only. |
| Env model vars | Removed from config, env files, and docs. |

## Data model

### `custom_models` (extended)

The existing table becomes the single registry for manual and discovered models.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key, unchanged |
| `model_id` | text | Unique, unchanged |
| `display_name` | text | Defaults to the model ID for discovered rows |
| `modality` | text | `video`, `image`, `audio`, `text` |
| `family` | text | Existing family enum plus inference result |
| `capabilities_json` | text | Capability patch, unchanged |
| `source` | text | `manual` for existing rows and user entries, `discovered` for sync results |
| `provider_created_at` | integer, nullable | Provider `created` value, used by Auto |
| `last_seen_at` | integer, nullable | Last sync that returned this ID |
| `available` | integer | `1` while the token lists it, `0` after it disappears |
| `ignored` | integer | `1` hides a discovered model from pickers |
| `capabilities_edited` | integer | `1` stops sync from overwriting `capabilities_json` |

### `model_selections` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `slot` | text | Primary key: `text_refine`, `text_polish`, `image`, `video`, `audio` |
| `mode` | text | `auto` or `manual` |
| `model_id` | text, nullable | Required for `manual`, null for `auto` |
| `updated_at` | integer | Set on every write |

A fresh database has no rows. Selections do not cascade from any constant.

### `model_preferences` (new)

Singleton row that stores Auto behavior.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key, always `1` |
| `auto_preset` | text | `quality`, `balanced`, or `economy`; default `balanced` |
| `updated_at` | integer | Set on write |

The preset applies only while a slot uses `mode = auto`. It never supplies a model on its own.

### `usage_events` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key |
| `job_id` | text, nullable | Generate job that produced the usage |
| `project_id` | text, nullable | For project totals |
| `modality` | text | `text`, `image`, `video`, `audio` |
| `model_id` | text | Resolved model ID |
| `input_tokens` | integer, nullable | From the provider `usage` block |
| `output_tokens` | integer, nullable | From the provider `usage` block |
| `total_tokens` | integer, nullable | From the provider `usage` block |
| `units` | integer, nullable | Media fallback: images, clips, or audio seconds |
| `created_at` | integer | Epoch ms |

Indexes on `created_at` and `project_id` support the daily and project queries.

### `projects.default_video_model`

Becomes nullable with no default. `NULL` means "inherit the global video slot". Existing rows keep their stored value, which continues to act as a project override.

## Discovery

`POST /api/settings/models/sync` performs the call server-side:

1. Resolve the base URL with `resolveQwenBaseUrl(getConfig().qwen)`.
2. Call `GET {base}/compatible-mode/v1/models` with `Authorization: Bearer <key>`.
3. Parse `data[].id` and `data[].created`.
4. For each ID: infer modality, family, and capabilities, then upsert by `model_id`. New rows get `source = discovered`, `available = 1`, `display_name = id`, and `capabilities_json` from inference. Existing rows update `last_seen_at`, `provider_created_at`, and `available = 1`. Sync leaves `capabilities_json` untouched when `capabilities_edited = 1`. A row with `source = manual` keeps its source and capabilities; sync only refreshes its timestamps and availability.
5. Mark discovered rows absent from the response with `available = 0`. Keep the rows, selections, and edits. Manual rows stay available.
6. Return `{ added, updated, unavailable, total, lastSyncedAt }`.

`GET /api/settings/models` runs the same sync when a key exists and no discovered row exists yet. A failed provider call returns the existing list plus a warning; it never clears the registry or the selections.

The Models page shows the last sync time and a Sync button. Sync is the only provider call this feature adds.

## Capability inference

The inference function returns `{ modality, family, patch }`, then merges the family template from `catalog.ts`. Rules match on the lowercased ID, first match wins.

| Pattern | Modality | Family | Initial rules |
| --- | --- | --- | --- |
| `wan3.0-video` | video | `wan3` | Full Wan 3.0 template |
| `wan2.7-t2v` | video | `wan2.7` | Text-to-video |
| `wan2.7-i2v` | video | `wan2.7` | First and last frame |
| `wan2.7-r2v` | video | `wan2.7` | Reference image, video, audio |
| starts with `wan` and contains `image` | image | `wan2.7` | Wan image template |
| contains `image` and starts with `qwen-image` | image | `qwen-image` | Reference-image template |
| contains `audio` and contains `tts` | audio | `qwen-tts` | TTS-capable |
| contains `audio` and contains `asr` | audio | `qwen-tts` | Listed, `ttsCapable: false` |
| contains `audio` and contains `realtime` | audio | `qwen-tts` | Listed, `ttsCapable: false` |
| anything else | text | `text` | Text template |

Unmatched video IDs receive `allowedMediaTypes: []`, `durations: { min: 2, max: 15 }`, and the standard resolutions, which is text-to-video only. Unmatched image IDs receive a single reference-image allowance. The capability editor can widen either.

`ttsCapable: false` models appear in the audio list, disabled, with the reason "Not usable for voiceover". The audio slot accepts only TTS-capable models. The existing capability patch schema needs a `ttsCapable` boolean field so the flag survives edits.

Manual custom models keep their existing behavior. A manual row may override a discovered ID; `source` records the latest writer, and `capabilities_edited` protects it from sync.

## Auto policy

Auto resolves against rows where `available = 1` and `ignored = 0`, using the preset stored in `model_preferences`. When several models fit a tier, the newest `provider_created_at` wins.

Cost tiers come from a maintained heuristic because the endpoint exposes no prices:

| Tier | ID signals |
| --- | --- |
| High | `prime`, `max`, `pro`, `-r2v` |
| Mid | `plus`, base names, `i2v`, `t2v` |
| Low | `flash`, `turbo`, `air` |

A curated override map in `src/lib/providers/model-selection.ts` handles IDs that break the pattern. The UI labels the result as a relative tier, never as currency.

| Role | Quality | Balanced | Economy |
| --- | --- | --- | --- |
| `text_refine` | Highest tier, newest | Strong mid tier, newest | Low tier, newest |
| `text_polish` | Highest tier, newest | Low tier, newest | Lowest tier, newest |
| `image` | High tier | Mid tier | Low tier |
| `video` | High tier | Any capable, prefer mid | Any capable, lowest tier |
| `audio` | Any TTS-capable, prefer `qwen-audio-3.0-tts-plus` | Same | Same |

On the current token, Balanced resolves to `qwen3.8-max` for refine, `qwen3.6-flash` or `deepseek-v4-flash` for polish, `wan2.7-image-pro` for image, `wan3.0-video` for video, and `qwen-audio-3.0-tts-plus` for audio.

The preset default is Balanced. Auto remains opt-in, so no model is chosen until the user turns it on. A sync can change the resolved model when a new release matches the tier; the Models page and Provider Status show the resolved ID and the rule that produced it.

Model quality is subjective and the endpoint exposes no benchmarks. The tier lists are a deliberate, reviewable product choice, and every role can be overridden manually.

## Resolution order

One function, `resolveSlotModel(slot, options)` in `src/lib/providers/model-selection.ts`, serves every route:

1. Explicit model from the request.
2. Project override when the slot is `video` and the project has `default_video_model`.
3. Saved selection: manual ID or Auto resolution.
4. No selection: throw `ModelSelectionError` with `code = MODEL_NOT_SELECTED`.

Callers pick the role they need: story refinement and the connection test use `text_refine`; prompt polish uses `text_polish`; reference sheets and keyframes use `image`; voiceover uses `audio`; clips use `video`.

Additional failures:

- Manual ID with `available = 0`: `MODEL_UNAVAILABLE`.
- ID that does not fit the slot, such as an ASR model for voiceover: `MODEL_UNSUPPORTED`.
- ID that no longer exists in the registry: `MODEL_UNAVAILABLE`.

The resolver never falls back to a constant. That rule is what "no default" means in this design.

When `TEXT_PROVIDER=openai_compat`, the text roles are not consulted. `getTextChat` uses `OPENAI_COMPAT_MODEL` as it does today, and the Models page disables both text rows with that explanation.

## Gating and UX

| Surface | Behavior when a slot is unresolved |
| --- | --- |
| Dashboard | Setup banner lists unresolved slots with a link to Settings, plus a Sync button when the registry is empty. |
| New Project | Video model starts empty and reads "Inherit global selection". Creating a project without it stores `NULL`. |
| Quick Clip | Model select shows "Select a model". Submit stays disabled with a reason tooltip until a model resolves. |
| Stage 2 | Reference sheet and keyframe buttons use the image slot. Voiceover uses the audio slot. Each action shows its slot's reason when unset. |
| Stage 3 | Scene model uses the project override, then the video slot. Generate buttons stay disabled until it resolves. |
| Provider Status | Shows role, mode, resolved ID, and source, plus the Usage card. The four env rows disappear. |

A manual selection that becomes unavailable does not silently switch to Auto. The UI flags it and asks for a new pick, so generated work does not change models without notice.

Selection changes affect new jobs only. Existing assets keep the model recorded on their job rows.

## Models page

Settings → Models becomes the single models surface. The sidebar label changes from "Custom Models" to "Models".

- Header: Sync button, last-synced time, and a warning when no key is configured.
- Auto card: a Quality / Balanced / Economy segmented control, a "Use Auto for all" action, and the resolved combo with each role's reason and relative cost tier.
- Role rows for `text_refine`, `text_polish`, `image`, `video`, and `audio`, each with an Auto/Manual toggle and a model select. Models that cannot serve the role are disabled with the reason.
- Model table grouped by modality, with badges for Token or Manual source, cost tier, availability, and ignored state. The capability editor opens from each row.
- Usage card: today, 7-day, and 30-day totals, split by modality, with top models and per-project totals. This card reads local rows only.

Provider Status shows the same role resolution and links to this page. Stage 3's export panel shows the project's lifetime token total.

## API

### `GET /api/settings/models`

Returns:

```json
{
  "models": [
    {
      "id": "0f9c1c2e-...",
      "modelId": "wan3.0-video",
      "displayName": "wan3.0-video",
      "modality": "video",
      "family": "wan3",
      "source": "discovered",
      "available": true,
      "ignored": false,
      "capabilitiesEdited": false,
      "capabilities": {}
    }
  ],
  "selections": [
    { "slot": "video", "mode": "auto", "modelId": null }
  ],
  "resolved": [
    {
      "slot": "video",
      "modelId": "wan3.0-video",
      "source": "auto",
      "reason": "Balanced tier 2: newest capable video"
    }
  ],
  "autoPreset": "balanced",
  "lastSyncedAt": 1795620082486,
  "syncWarning": null
}
```

### `POST /api/settings/models/sync`

No body. Returns the sync counts. Requires a configured key and returns `409 API_KEY_MISSING` otherwise. This calls the metadata endpoint only and spends no tokens.

### `PUT /api/settings/models/selections`

```json
{ "updates": [{ "slot": "video", "mode": "auto" }] }
```

```json
{
  "updates": [
    { "slot": "text_polish", "mode": "manual", "modelId": "qwen3.6-flash" }
  ]
}
```

Validates the slot enum (`text_refine`, `text_polish`, `image`, `video`, `audio`), the mode, availability, modality, and TTS capability. Returns the new `selections` and `resolved` arrays.

### `PUT /api/settings/models/preferences`

```json
{ "autoPreset": "economy" }
```

Accepts `quality`, `balanced`, or `economy`. Returns the new `resolved` array so the UI can show the changed combo immediately.

### `GET /api/settings/usage`

Query: `range=today|7d|30d` (default `today`), optional `projectId`.

```json
{
  "range": "7d",
  "totals": { "inputTokens": 41200, "outputTokens": 9800, "totalTokens": 51000 },
  "byModality": [
    { "modality": "text", "totalTokens": 51000, "events": 12 }
  ],
  "topModels": [
    { "modelId": "qwen3.8-max", "totalTokens": 30100, "events": 4 }
  ],
  "byProject": [
    { "projectId": "abc", "title": "Night Courier", "totalTokens": 21000 }
  ]
}
```

Reads SQLite only. It never calls the provider.

### `PATCH /api/settings/models/:id`

`:id` is the `custom_models` row ID, not the provider model ID. The UI already receives it from `GET /api/settings/models`.

```json
{
  "displayName": "Wan 3 Video",
  "ignored": false,
  "capabilities": { "maxCounts": { "reference_image": 5 } },
  "resetCapabilities": false
}
```

Writes `capabilities_edited = 1` when `capabilities` is present. `resetCapabilities: true` clears the flag and re-runs inference.

### `DELETE /api/settings/models/:id`

Deletes manual rows. Sets `ignored = 1` for discovered rows so the next sync does not re-expose them. A separate `PATCH { "ignored": false }` unhides.

### Errors

| Code | Status | Meaning |
| --- | --- | --- |
| `MODEL_NOT_SELECTED` | 409 | No selection for the slot |
| `MODEL_UNAVAILABLE` | 409 | Selected ID is missing or no longer offered |
| `MODEL_UNSUPPORTED` | 422 | Model cannot serve the slot or the requested media mode |
| `API_KEY_MISSING` | 409 | Sync attempted without `QWEN_API_KEY` |

All four include `slot` where applicable.

## Files

New:

- `src/lib/providers/model-inference.ts`
- `src/lib/providers/model-selection.ts`
- `src/lib/usage/record.ts` (usage extraction and storage helpers)
- `src/app/api/settings/models/sync/route.ts`
- `src/app/api/settings/models/selections/route.ts`
- `src/app/api/settings/models/preferences/route.ts`
- `src/app/api/settings/models/[id]/route.ts`
- `src/app/api/settings/usage/route.ts`
- `drizzle/` migration for the schema changes

Modified:

- `src/db/schema.ts`, `src/db/index.ts` (quick-clips project without a model)
- `src/lib/config.ts`
- `src/lib/providers/catalog.ts`, `text.ts`, `qwen-client.ts`, `openai-text.ts`
- `src/lib/refiner/story-refiner.ts` (role selection and usage callback)
- `src/lib/jobs/runner.ts`, `persist.ts` (record media usage)
- `src/app/api/settings/models/route.ts`
- `src/app/api/settings/status/route.ts`
- `src/app/api/refine/route.ts`, `src/app/api/polish/route.ts` (role selection)
- `src/app/api/generate/batch/route.ts`, `tts/route.ts`, `keyframe/route.ts`, `video/route.ts`, `element-sheet/route.ts`
- `src/app/api/projects/route.ts`
- `src/app/settings/models/page.tsx`, `src/app/settings/providers/page.tsx`
- `src/app/page.tsx`, `src/app/quick-clip/page.tsx`
- `src/components/studio/Stage2Elements.tsx`, `Stage3Video.tsx`, `ExportPanel.tsx`
- `src/lib/guide.ts`, `README.md`, `AGENTS.md`, `.env`, `.env.example`

## Migration

One Drizzle migration:

1. Add the six `custom_models` columns with defaults (`source = 'manual'`, `available = 1`, `ignored = 0`, `capabilities_edited = 0`, timestamps null).
2. Create `model_selections`, `model_preferences`, and `usage_events` with their indexes.
3. Rebuild `projects` so `default_video_model` is nullable with no default, preserving existing values and indexes. SQLite requires the table-rebuild approach that drizzle-kit generates.

`getDb()` already runs migrations on open, so an existing `studio.db` upgrades on the next server start. No manual step.

## Removal of env model variables

Delete from `src/lib/config.ts`: the four schema fields, their `emptyToUndefined` plumbing, and `qwen.models` from `AppConfig`. Delete the four lines from `.env` and `.env.example`. Update `README.md`, `AGENTS.md`, and the guide text. A leftover value in a user's env file becomes inert; no error is raised because the schema reads explicit fields.

`OPENAI_COMPAT_MODEL` stays.

## Security

- The API key stays server-side. Sync runs in a route handler and never returns the key.
- Discovered IDs and capabilities are not secrets.
- The sync route accepts no URL or key from the client, so it cannot be pointed at another host.
- Capability edits and selections pass through Zod validation.

## Testing

Unit:

- Inference matrix: `wan3.0-video`, `wan2.7-r2v`, `qwen-image-3.0-pro`, `qwen-audio-3.0-tts-plus`, `qwen-audio-3.0-asr-flash`, unknown video, unknown text.
- Auto resolution for each preset and role, including newest-ID fallback.
- Cost-tier inference from ID signals and the override map.
- No-selection error carries the role.
- Unavailable and unsupported selections fail with the right code.
- Sync preserves `capabilities_json` when `capabilities_edited = 1`.
- Sync marks missing discovered rows unavailable without deleting them.
- Project inheritance: null override resolves to the global video role.
- Usage recording stores provider token counts, falls back to units for media, and never throws when usage is absent.
- Usage aggregation groups by day, modality, model, and project.

Route:

- `GET /api/settings/models` with an empty registry triggers one sync when a key exists.
- `PUT` selections validates modality and TTS capability.
- `PUT` preferences changes the Auto preset and re-resolves.
- `DELETE` ignores discovered rows and deletes manual rows.
- `GET /api/settings/usage` returns totals without a provider call.

Existing suites to update: `tests/config.test.ts` (no model fields), `tests/guide.test.ts` (env key list), `tests/setup-docs.test.ts` (README env table).

Commands: `bun run lint`, `bun run test`, `bun run build`.

Manual pass:

1. Delete `data/studio.db`, start the server, open the dashboard. The banner appears and no default model is shown anywhere.
2. Open Settings → Models. Sync returns the token's models. Auto resolves each role and shows the reason.
3. Switch Auto to Economy and confirm the text and image roles change; switch back to Balanced.
4. Create a project without a video model. Open Stage 3 and confirm generation is disabled with the video-role reason.
5. Pick a manual video model, generate a scene, then mark it unavailable in the database and confirm new generation fails with `MODEL_UNAVAILABLE`.
6. Edit a discovered model's capabilities, sync again, confirm the edit survives.
7. Run a refinement, confirm the Usage card increments, and confirm the models list itself adds no usage row.

## Risks

| Risk | Mitigation |
| --- | --- |
| Token list is narrower than the catalog, so `wan2.7-t2v` and similar IDs disappear from pickers. | Manual custom models remain available. The docs state that discovery reflects the token. |
| Cost tiers are a heuristic because the endpoint has no prices. | The UI labels them relative tiers, a curated override map handles outliers, and manual selection is always available. |
| The tier list encodes subjective quality. | Every role can be overridden. The resolved ID and reason are visible. |
| Usage data is incomplete when a provider response omits `usage`. | Media falls back to units, text records only when tokens are present, and a missing block never fails a job. |
| A stale list hides a newly released model. | Sync button, last-synced timestamp, and the Auto newest-ID fallback. |
| Rebuilding `projects` can lose data if the migration is wrong. | Drizzle generates the rebuild; the verification pass compares project counts and overrides before and after. |
| Text refinement stops working on a fresh install. | The gating message links directly to the text role, and Auto resolves it in one click. |

## Rollout

1. Ship the schema migration, inference, and cost tiers.
2. Ship discovery and the registry sync.
3. Ship selections, presets, and the resolver, then switch the generate and refine routes.
4. Ship usage recording and the Models and Provider Status panels.
5. Remove the env variables and update docs in the same commit, per the repository doc sync rule.