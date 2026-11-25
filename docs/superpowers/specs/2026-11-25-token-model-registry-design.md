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
- Offer an Auto mode that picks a quality-first combination from the token's list.
- Block generation with a clear message while a required slot has no selection.
- Infer media rules for discovered IDs and let the user correct them.
- Remove the four model environment variables and `getConfig().qwen.models`.

## Non-goals

- Cost or credit optimisation. The models endpoint returns no pricing data.
- Live capability discovery. The endpoint returns IDs only.
- Provider-side model management such as fine-tunes or deployments.
- Discovery for the OpenAI-compatible text provider. `OPENAI_COMPAT_MODEL` continues to apply when `TEXT_PROVIDER=openai_compat`.
- Changing the model recorded on existing assets and jobs.

## Decisions

| Topic | Decision |
| --- | --- |
| Selection surface | Global selections per slot in Settings, with existing per-project and per-request overrides. |
| Fresh install | No selection and no fallback model. Actions stay blocked until the user syncs and picks. |
| Registry storage | Persist discovered models in SQLite. Sync on demand plus once when the registry is empty. |
| Unknown models | Store and list them with conservative rules: text-to-video, text-to-image, TTS. |
| Auto | Opt-in mode, resolved at read time from the available list using tier lists and `providerCreatedAt`. |
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
| `slot` | text | Primary key: `text`, `image`, `video`, `audio` |
| `mode` | text | `auto` or `manual` |
| `model_id` | text, nullable | Required for `manual`, null for `auto` |
| `updated_at` | integer | Set on every write |

A fresh database has no rows. Selections do not cascade from any constant.

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

Auto resolves against rows where `available = 1` and `ignored = 0`. It walks a tier list per slot and picks the first match.

| Slot | Tier order |
| --- | --- |
| video | `wan3.0-video`, `wan3.0-video-prime`, `wan2.7-r2v`, `wan2.7-i2v`, `wan2.7-t2v`, then newest by `provider_created_at` |
| image | `qwen-image-3.0-pro`, `wan2.7-image-pro`, `wan2.7-image`, `qwen-image-3.0`, then newest |
| audio | `qwen-audio-3.0-tts-plus`, then newest TTS-capable audio |
| text | `qwen3.8-max`, `qwen4-max`, `qwen3.7-max`, `deepseek-v4-pro`, `glm-5.3`, then newest |

The tier lists are constants in `src/lib/providers/model-selection.ts`. Auto picks up new releases through the newest-ID fallback, so a sync can change the resolved model without user action. The Models page and Provider Status show the resolved ID and the tier or fallback that produced it.

Large language model quality is subjective and the endpoint exposes no benchmarks. The tier order is a deliberate, reviewable product choice that the user can override per slot.

## Resolution order

One function, `resolveSlotModel(slot, options)` in `src/lib/providers/model-selection.ts`, serves every route:

1. Explicit model from the request.
2. Project override when the slot is `video` and the project has `default_video_model`.
3. Saved selection: manual ID or Auto resolution.
4. No selection: throw `ModelSelectionError` with `code = MODEL_NOT_SELECTED`.

Additional failures:

- Manual ID with `available = 0`: `MODEL_UNAVAILABLE`.
- ID that does not fit the slot, such as an ASR model for voiceover: `MODEL_UNSUPPORTED`.
- ID that no longer exists in the registry: `MODEL_UNAVAILABLE`.

The resolver never falls back to a constant. That rule is what "no default" means in this design.

When `TEXT_PROVIDER=openai_compat`, the text slot is not consulted. `getTextChat` uses `OPENAI_COMPAT_MODEL` as it does today, and the Models page disables the text slot with that explanation.

## Gating and UX

| Surface | Behavior when a slot is unresolved |
| --- | --- |
| Dashboard | Setup banner lists unresolved slots with a link to Settings, plus a Sync button when the registry is empty. |
| New Project | Video model starts empty and reads "Inherit global selection". Creating a project without it stores `NULL`. |
| Quick Clip | Model select shows "Select a model". Submit stays disabled with a reason tooltip until a model resolves. |
| Stage 2 | Reference sheet and keyframe buttons use the image slot. Voiceover uses the audio slot. Each action shows its slot's reason when unset. |
| Stage 3 | Scene model uses the project override, then the video slot. Generate buttons stay disabled until it resolves. |
| Provider Status | Shows slot, mode, resolved ID, and source. The four env rows disappear. |

A manual selection that becomes unavailable does not silently switch to Auto. The UI flags it and asks for a new pick, so generated work does not change models without notice.

Selection changes affect new jobs only. Existing assets keep the model recorded on their job rows.

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
      "reason": "Tier 1: wan3.0-video"
    }
  ],
  "lastSyncedAt": 1795620082486,
  "syncWarning": null
}
```

### `POST /api/settings/models/sync`

No body. Returns the sync counts. Requires a configured key and returns `409 API_KEY_MISSING` otherwise.

### `PUT /api/settings/models/selections`

```json
{ "updates": [{ "slot": "video", "mode": "auto" }] }
```

```json
{
  "updates": [
    { "slot": "text", "mode": "manual", "modelId": "qwen3.8-max" }
  ]
}
```

Validates the slot enum, the mode, availability, modality, and TTS capability. Returns the new `selections` and `resolved` arrays.

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
- `src/app/api/settings/models/sync/route.ts`
- `src/app/api/settings/models/selections/route.ts`
- `src/app/api/settings/models/[id]/route.ts`
- `drizzle/` migration for the schema changes

Modified:

- `src/db/schema.ts`, `src/db/index.ts` (quick-clips project without a model)
- `src/lib/config.ts`
- `src/lib/providers/catalog.ts`, `text.ts`, `qwen-client.ts`
- `src/app/api/settings/models/route.ts`
- `src/app/api/settings/status/route.ts`
- `src/app/api/generate/batch/route.ts`, `tts/route.ts`, `keyframe/route.ts`, `video/route.ts`, `element-sheet/route.ts`
- `src/app/api/projects/route.ts`
- `src/app/settings/models/page.tsx`, `src/app/settings/providers/page.tsx`
- `src/app/page.tsx`, `src/app/quick-clip/page.tsx`
- `src/components/studio/Stage2Elements.tsx`, `Stage3Video.tsx`
- `src/lib/guide.ts`, `README.md`, `AGENTS.md`, `.env`, `.env.example`

## Migration

One Drizzle migration:

1. Add the six `custom_models` columns with defaults (`source = 'manual'`, `available = 1`, `ignored = 0`, `capabilities_edited = 0`, timestamps null).
2. Create `model_selections`.
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
- Auto tier resolution and newest-ID fallback for each slot.
- No-selection error carries the slot.
- Unavailable and unsupported selections fail with the right code.
- Sync preserves `capabilities_json` when `capabilities_edited = 1`.
- Sync marks missing discovered rows unavailable without deleting them.
- Project inheritance: null override resolves to the global slot.

Route:

- `GET /api/settings/models` with an empty registry triggers one sync when a key exists.
- `PUT` selections validates modality and TTS capability.
- `DELETE` ignores discovered rows and deletes manual rows.

Existing suites to update: `tests/config.test.ts` (no model fields), `tests/guide.test.ts` (env key list), `tests/setup-docs.test.ts` (README env table).

Commands: `bun run lint`, `bun run test`, `bun run build`.

Manual pass:

1. Delete `data/studio.db`, start the server, open the dashboard. The banner appears and no default model is shown anywhere.
2. Open Settings → Models. Sync returns 21 models. Auto resolves each slot and shows the reason.
3. Create a project without a video model. Open Stage 3 and confirm generation is disabled with the video-slot reason.
4. Pick a manual video model, generate a scene, then mark it unavailable in the database and confirm new generation fails with `MODEL_UNAVAILABLE`.
5. Edit a discovered model's capabilities, sync again, confirm the edit survives.

## Risks

| Risk | Mitigation |
| --- | --- |
| Token list is narrower than the catalog, so `wan2.7-t2v` and similar IDs disappear from pickers. | Manual custom models remain available. The docs state that discovery reflects the token. |
| The tier list encodes subjective quality. | Every slot can be overridden. The resolved ID and reason are visible. |
| A stale list hides a newly released model. | Sync button, last-synced timestamp, and the Auto newest-ID fallback. |
| Rebuilding `projects` can lose data if the migration is wrong. | Drizzle generates the rebuild; the verification pass compares project counts and overrides before and after. |
| Text refinement stops working on a fresh install. | The gating message links directly to the text slot, and Auto resolves it in one click. |

## Rollout

1. Ship the schema migration and inference.
2. Ship discovery, selections, and resolution.
3. Switch the generate routes and pages to the resolver.
4. Remove the env variables and update docs in the same commit, per the repository doc sync rule.