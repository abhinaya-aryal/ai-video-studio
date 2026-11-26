export type GuideGroup = "Start here" | "Build" | "Ship" | "Reference";

export interface GuideDetail {
  label: string;
  text: string;
}

export interface GuideStep {
  id: string;
  group: GuideGroup;
  title: string;
  summary: string;
  bullets: string[];
  details: GuideDetail[];
  note?: string;
  where: string;
  href: string;
  cta: string;
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: "welcome",
    group: "Start here",
    title: "Build a video in three stages",
    summary:
      "AI Video Studio turns a rough idea into a storyboard, a consistent element library, generated clips, and a Kdenlive-ready export. Everything runs locally against your own API keys, and every screen in the app is covered by this manual.",
    bullets: [
      "Stage 1 shapes the story, style, element roster, and scene breakdown.",
      "Stage 2 locks the look with element images, keyframes, and voiceover.",
      "Stage 3 generates clips, manages takes, and exports an editable project.",
    ],
    details: [
      {
        label: "Projects",
        text: "The home page lists every story project. A project owns one video: its story, elements, scenes, assets, jobs, and exports.",
      },
      {
        label: "Storyboard Studio",
        text: "Opening a project shows three tabs: Story & Scenes, Elements & Keyframes, and Video & Export. You can move between them at any time; nothing is lost when you switch.",
      },
      {
        label: "Quick Clip",
        text: "A one-shot workspace for a single clip without a storyboard. It writes into a hidden internal project so recent results stay available.",
      },
      {
        label: "Local-first",
        text: "SQLite metadata lives in data/, and all media lives under projects/. Nothing is uploaded except temporary OSS files needed by the provider.",
      },
      {
        label: "This guide",
        text: "Press ? anywhere outside a text field, use the How it works button in the sidebar, or the ? icon in the mobile header. Use the arrow keys or Back and Next to move between steps.",
      },
    ],
    where: "Start from Projects in the sidebar",
    href: "/",
    cta: "Browse projects",
  },
  {
    id: "setup",
    group: "Start here",
    title: "Install and configure the app",
    summary:
      "The app runs on Node 20 or newer with Bun as the package manager. Copy the example environment file, add your key, restart the server, and verify the connection before spending credits.",
    bullets: [
      "Run bun install, copy .env.example to .env.local, add QWEN_API_KEY, then run bun run dev.",
      "The app opens on http://localhost:3000 and reads configuration only on the server.",
      "Restart the dev server after any environment edit; values are read lazily at request time.",
    ],
    details: [
      {
        label: "Commands",
        text: "bun install installs dependencies. bun run dev starts Next.js on Node. bun run build and bun run start create and serve the production build. bun run test runs Vitest. bun run lint runs ESLint. bun run db:generate writes Drizzle migrations into drizzle/.",
      },
      {
        label: "Provider key",
        text: "QWEN_API_KEY is required for generation. QWEN_KEY_TYPE accepts auto, token_plan, or standard. With auto, keys starting with sk-sp- are treated as token-plan keys and routed to token-plan.<region>.maas.aliyuncs.com.",
      },
      {
        label: "Region and workspace",
        text: "QWEN_REGION is ap-southeast-1 or cn-beijing and applies to token-plan routing. Standard DashScope keys can also use QWEN_WORKSPACE_ID. QWEN_BASE_URL overrides the resolved endpoint for advanced setups.",
      },
      {
        label: "Models",
        text: "Model choice lives in Settings → Models, where the synced token list and Auto presets live. No model environment variables remain.",
      },
      {
        label: "Text provider",
        text: "TEXT_PROVIDER is qwen or openai_compat. openai_compat requires OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_MODEL; OPENAI_COMPAT_API_KEY is optional for local servers. Refinement and prompt polishing use this provider.",
      },
      {
        label: "Job tuning",
        text: "MAX_CONCURRENT_JOBS defaults to 2 and accepts 1 to 16. JOB_POLL_INTERVAL_MS defaults to 10000 and accepts 1000 to 120000 milliseconds between provider status checks.",
      },
      {
        label: "Storage paths",
        text: "DATA_DIR defaults to data and holds studio.db. PROJECTS_DIR defaults to ~/projects and holds one folder per project slug, including story.md, elements/, scenes/, and export_kdenlive/.",
      },
      {
        label: "Secrets",
        text: "Keys belong only in .env.local. They are never written to SQLite, never bundled into client code, and API responses only return masked previews. .env, data/, projects/, and .superpowers/ are gitignored.",
      },
    ],
    note: "If the app shows a missing-key banner, edit .env.local and restart the server before generating.",
    where: "Settings → Provider Status",
    href: "/settings/providers",
    cta: "Check provider status",
  },
  {
    id: "provider-status",
    group: "Start here",
    title: "Verify the provider connection",
    summary:
      "Provider Status is a read-only view of the server configuration plus live connectivity checks, so you can confirm routing and model IDs before queueing work.",
    bullets: [
      "Shows the masked key, resolved key type, region, endpoint, and role resolution.",
      "Test Qwen, Test OpenAI-Compat, and Test All report success or a readable error.",
      "Usage for the last 7 days is listed below the provider cards.",
    ],
    details: [
      {
        label: "Key preview",
        text: "The page shows a masked value such as sk-sp-****cdef plus badges for the detected key type and region. The full key never leaves the server.",
      },
      {
        label: "Endpoint",
        text: "The resolved base URL is displayed. A key and URL mismatch warning appears when a token-plan key is paired with a standard DashScope endpoint, or the reverse.",
      },
      {
        label: "Models",
        text: "Each role is listed with its mode, resolved model, and source. Model choice lives in Settings → Models, not in the environment.",
      },
      {
        label: "Text provider",
        text: "The active text provider is shown. When it is openai_compat, the base URL, model, and masked key are listed; otherwise refinement uses Qwen through the compatible endpoint.",
      },
      {
        label: "Connection tests",
        text: "Each test sends a minimal request to the relevant provider. Failures surface the mapped error code and message, which is the fastest way to catch a wrong region, revoked key, or unavailable model.",
      },
    ],
    note: "A configured key can still fail with 401, 403, or 429. Check the test result before assuming the app is broken.",
    where: "Settings → Provider Status",
    href: "/settings/providers",
    cta: "Open provider status",
  },
  {
    id: "models",
    group: "Start here",
    title: "Sync models and choose a role",
    summary:
      "The app lists every model your token can use and stores the list in SQLite. Pick a model for each role, or turn on Auto. Nothing is preselected.",
    bullets: [
      "Sync models calls the provider metadata endpoint. It runs no model and spends no tokens.",
      "Roles are text_refine, text_polish, image, video, and audio. Each is Manual or Auto.",
      "Auto offers Quality, Balanced, and Economy presets. Every role can still be overridden.",
    ],
    details: [
      {
        label: "Sync models",
        text: "The first load with an empty registry syncs automatically. Press Sync models any time to pick up a new release. Discovered rows show a Token badge; manual rows survive sync and keep their rules.",
      },
      {
        label: "Roles",
        text: "text_refine drives story refinement, text_polish drives prompt polish, image drives element images and keyframes, video drives clips and Quick Clip, and audio drives voiceover. A project can override the video role, and a request can override any role.",
      },
      {
        label: "Auto presets",
        text: "Quality prefers the highest tier, Balanced trades cost against quality, and Economy prefers cheap models. Relative tiers come from model ID signals because the provider returns no prices. The resolved model and its reason appear on each row.",
      },
      {
        label: "No default",
        text: "A fresh database has no selection. Until a role resolves, the matching action stays disabled and the API returns 409 MODEL_NOT_SELECTED. Manual selections that disappear from the token fail with MODEL_UNAVAILABLE instead of silently switching.",
      },
      {
        label: "Capability rules",
        text: "Discovered IDs inherit rules from their family. Rules opens a JSON editor for media slots, caps, durations, and resolutions. Saving marks the row as edited so a later sync leaves it alone.",
      },
      {
        label: "Usage",
        text: "Chat responses record input, output, and total tokens. Media jobs record one unit per image or clip when the provider sends no usage block. Totals appear here and on Provider Status for the last 7 days.",
      },
    ],
    note: "Syncing models and reading usage never spend tokens. Only generation calls do.",
    where: "Settings → Models",
    href: "/settings/models",
    cta: "Open models",
  },
  {
    id: "projects",
    group: "Start here",
    title: "Create and open projects",
    summary:
      "The dashboard lists your story projects newest first, with the latest one featured. New Project captures everything the studio inherits: idea, style, output shape, and default model.",
    bullets: [
      "Click any project card to open its Storyboard Studio.",
      "New Project needs a title; every other field can start empty and be edited later.",
      "If no key is configured, a warning banner links you to Provider Status.",
    ],
    details: [
      {
        label: "Project card",
        text: "Shows aspect ratio and resolution, the title, the folder slug, a two-line synopsis from the rough idea or refined story, the default video model, and the last update date. The newest project spans two columns and carries a Latest badge.",
      },
      {
        label: "Title and idea",
        text: "Title is required and becomes the project name; the slug is derived from it. Rough Idea is optional here and can be written or rewritten in Stage 1.",
      },
      {
        label: "Style",
        text: "Pick a Style Preset or Custom / None, and optionally prefill the Style Bible. Built-in presets are Cinematic, Anime, Documentary, Product, and Epic Hindu Mythology 3D. A preset copies its Style Bible into the project at creation time.",
      },
      {
        label: "Output settings",
        text: "Aspect is 16:9, 9:16, or 1:1. Resolution is 480P, 720P, or 1080P. Video Model lists every registered video model and falls back to wan3.0-video. Scenes inherit these defaults.",
      },
      {
        label: "Empty state",
        text: "With no projects, the page offers Create First Project and points to Quick Clip for a single shot.",
      },
    ],
    note: "Each project card has a delete button (visible on hover or keyboard focus). Confirming removes the project and its scenes, elements, assets, and job history from the app. The project folder on disk is intentionally left untouched, and the hidden Quick Clips project cannot be deleted.",
    where: "Projects → New Project",
    href: "/",
    cta: "Open Projects",
  },
  {
    id: "stage-1",
    group: "Build",
    title: "Stage 1 · Story and scene breakdown",
    summary:
      "Stage 1 is where the video is planned. Write the rough idea, let Auto-Refine draft the story, Style Bible, element roster, and scenes, then edit anything the model got wrong.",
    bullets: [
      "Auto-Refine calls the text provider and replaces the storyboard when scenes or elements already exist, after confirmation.",
      "The target scene count accepts 1 to 30; leave it blank to let the model decide.",
      "Save Story & Style Bible keeps manual edits; Continue to Stage 2 appears once scenes exist.",
    ],
    details: [
      {
        label: "Rough Idea",
        text: "Describe the concept, characters, setting, and arc. Auto-Refine is disabled until this field has text.",
      },
      {
        label: "Target scene count",
        text: "An optional number from 1 to 30. Empty means automatic. The refiner aims for that count but the final scene list is always editable.",
      },
      {
        label: "Auto-Refine",
        text: "Produces a refined story, a Style Bible, the element roster (characters, props, locations), and numbered scenes with visual prompts, camera direction, audio mode, duration, and video mode. Unknown element references are reported as warnings.",
      },
      {
        label: "Rebuild confirmation",
        text: "If scenes or elements already exist, the app asks before replacing them. Existing keyframes, clips, voiceovers, and take history become orphaned and must be regenerated.",
      },
      {
        label: "Story and Style Bible",
        text: "Both textareas are editable. The Save button is enabled only when something changed, and saving does not touch scenes or elements.",
      },
      {
        label: "Element roster",
        text: "Lists every character, prop, and location with counts. Elements can be added or deleted here; sheets and scene links are managed in later stages.",
      },
      {
        label: "Scenes",
        text: "Each scene appears as a SceneCard in order. Add Scene creates a 5 second scene with ambient_only audio and omni_reference video mode. Reorder with the arrow buttons and delete with the trash button.",
      },
    ],
    note: "Running Auto-Refine again after generating media is destructive to the storyboard; the confirmation dialog spells out how many scenes and elements will be replaced.",
    where: "Project → Story & Scenes",
    href: "/",
    cta: "Start with a project",
  },
  {
    id: "style-presets",
    group: "Build",
    title: "Style Bibles and presets",
    summary:
      "The Style Bible is the visual contract for the whole project. It feeds refinement, prompt polishing, element images, keyframes, and video prompts, and it can be saved as a reusable preset.",
    bullets: [
      "Save as Preset stores the current Style Bible under a name for future projects.",
      "Built-in presets are Cinematic, Anime, Documentary, Product, and Epic Hindu Mythology 3D; custom presets can be deleted.",
      "Selecting a preset at project creation copies its text; later edits stay local to the project.",
    ],
    details: [
      {
        label: "Style Bible field",
        text: "Describe palette, lighting, lens, texture, and aesthetic rules. Keep it specific: every generated image and clip inherits this language.",
      },
      {
        label: "Save as Preset",
        text: "Available from Stage 1 and from Settings → Style Presets. Requires a preset name and non-empty Style Bible text. Names are unique.",
      },
      {
        label: "Manage presets",
        text: "Settings → Style Presets lists every preset with a Built-in badge where applicable. Custom presets have a delete button; built-ins are read-only.",
      },
      {
        label: "Where it is used",
        text: "Auto-Refine, AI Polish, element image generation, keyframe generation, and video request prompts all include the Style Bible or its distilled rules.",
      },
    ],
    where: "Settings → Style Presets",
    href: "/settings/presets",
    cta: "Manage style presets",
  },
  {
    id: "elements",
    group: "Build",
    title: "Build the element roster",
    summary:
      "Elements are the recurring characters, props, and locations that must look the same in every shot. The roster is shared across scenes and drives element images and @Image tags.",
    bullets: [
      "Add elements with a kind, a name, and a visual description.",
      "Deleting an element unlinks it from scenes but leaves existing media untouched.",
      "Reference priority is characters, then props, then locations; extras over the model cap are dropped and reported.",
    ],
    details: [
      {
        label: "Kinds",
        text: "character, prop, and location. Each kind is grouped separately in the roster and counted. Kind affects ordering and the default sheet prompt, not permissions.",
      },
      {
        label: "Fields",
        text: "Name is required and must be unique enough to reference in prompts. Description should cover appearance, materials, colors, and any must-keep details; it is used to generate the element image.",
      },
      {
        label: "Add and delete",
        text: "The inline form adds an element immediately. The trash button on each row deletes it after the API confirms; linked scenes keep their order but lose that reference.",
      },
      {
        label: "Linking and @Image",
        text: "Scenes link elements explicitly in the SceneCard. At request time, linked elements are sent as reference images and the prompt uses @Image N, where N matches the reference order. Characters are numbered before props, then locations.",
      },
      {
        label: "Caps",
        text: "Wan 3.0 accepts at most 10 reference images, 5 reference videos, and 5 reference audio clips. Element sheets count toward the image cap. When a scene links more than the cap allows, the request builder keeps the highest-priority elements and reports the dropped names.",
      },
    ],
    where: "Project → Story & Scenes → Element Roster",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "scenes",
    group: "Build",
    title: "Edit scene cards",
    summary:
      "Every scene is one shot. The card holds the prompt, camera, mode, duration, audio, and element links, and it saves as a single unit so you can revise before generating.",
    bullets: [
      "AI Polish rewrites the visual prompt using the Style Bible, camera direction, and audio mode as context.",
      "Linked elements are passed as references only in omni_reference mode; the links are kept in other modes.",
      "Unsaved changes are flagged; Save Scene is disabled until something changes.",
    ],
    details: [
      {
        label: "Title",
        text: "Editable inline. It names the scene in the keyframe list, take history, shot strip, and export warnings.",
      },
      {
        label: "Visual Prompt",
        text: "The main description of subject, action, lighting, and composition. It is sent to image, keyframe, and video generation. Use @Image 1, @Image 2 to point at linked references in omni mode.",
      },
      {
        label: "Camera Direction",
        text: "Free text such as Slow dolly in, eye-level. It is appended to generation prompts and used as context when polishing.",
      },
      {
        label: "Video Mode",
        text: "text_to_video, first_last_frame, or omni_reference. Changing it here is saved immediately and determines which media slots are available in Stage 3.",
      },
      {
        label: "Duration",
        text: "Seconds for the clip. Defaults to 5 and is validated against the selected model's supported range when generating.",
      },
      {
        label: "Audio Mode",
        text: "ambient_only for soundscape and SFX with no speech, narration for voiceover, dialogue for character speech, and silent for no generated audio. If the model lacks native audio, the UI warns that output is silent.",
      },
      {
        label: "Audio Script",
        text: "Narration, dialogue, or SFX direction for the scene. Used by native audio generation and prefilled into the optional TTS text.",
      },
      {
        label: "Linked Elements",
        text: "Pick roster elements to attach. Unknown or deleted IDs are flagged, and you can remove them. Order controls @Image numbering after the character, prop, location priority sort.",
      },
      {
        label: "Card actions",
        text: "Move up, move down, delete, and Save Scene. Deleting a scene removes its assets from the storyboard and leaves files on disk.",
      },
    ],
    where: "Project → Story & Scenes → Scenes",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "element-sheets",
    group: "Build",
    title: "Stage 2 · Element images",
    summary:
      "Each element needs one canonical image. Generating or uploading a single image gives every keyframe and clip a consistent visual anchor, while the video model handles poses and expressions.",
    bullets: [
      "Generation prompts pre-fill with the element description, story context, and project Style Bible, and can be edited as a whole.",
      "Upload accepts one image and makes it the active image immediately.",
      "Each element keeps one canonical image. A new generation or upload replaces the previous image and file.",
    ],
    details: [
      {
        label: "Generation prompt",
        text: "Pre-filled with the canonical prompt, element description, story context, and Style Bible. Edit any part directly before generating, or click Reset to restore the default prompt.",
      },
      {
        label: "Generate Image",
        text: "Sends the full prompt from the editor directly to the image model. The button shows Generating while the job runs and disables duplicate submissions.",
      },
      {
        label: "Reference image",
        text: "Choose No reference, This element (the current image), or another element that already has an image. A selected image is sent to the model as a visual anchor for style and identity.",
      },
      {
        label: "Upload",
        text: "Choose one image file from disk. The file is copied into the project's elements/ folder, replaces the previous image, and becomes the active reference. Uploads do not call the provider.",
      },
      {
        label: "No image yet",
        text: "Shows a placeholder. Keyframes and clips can still generate from the description, but consistency improves once an image exists.",
      },
      {
        label: "Retry",
        text: "A failed image job exposes a retry button on the card. Retries reuse the same parameters and replace the previous image on success.",
      },
    ],
    where: "Project → Elements & Keyframes → Element Images",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "keyframes",
    group: "Build",
    title: "Stage 2 · First and last keyframes",
    summary:
      "Keyframes are still images that anchor a shot. First/last-frame video mode animates between them, and the first keyframe doubles as the shot thumbnail in the filmstrip.",
    bullets: [
      "Generate First Frame and Generate Last Frame are independent per scene.",
      "Generate All Keyframes reviews scenes, total duration, resolution, and model before queueing.",
      "Element caps apply here too; dropped extras are reported after the batch is queued.",
    ],
    details: [
      {
        label: "First Frame",
        text: "Required for first_last_frame mode. Generated from the scene prompt, camera direction, Style Bible, linked element images, and any custom prompt. A failed job can be retried without touching the scene.",
      },
      {
        label: "Last Frame",
        text: "Optional. When present, first_last_frame animates from the first keyframe to the last. Without it, the model continues from the first frame using the prompt.",
      },
      {
        label: "Batch confirmation",
        text: "Generate All Keyframes opens a summary with scene count, total seconds, resolution, and model. Confirm queues one job per scene and closes the dialog.",
      },
      {
        label: "Dropped elements",
        text: "If a scene links more elements than the image cap permits, the extra names are dropped in priority order and shown in a toast. Regenerate after trimming links to include them.",
      },
      {
        label: "Scene list",
        text: "Each scene row shows its first and last thumbnails, job state, retry controls, and the prompt used. Scenes with no keyframes show generate buttons.",
      },
    ],
    where: "Project → Elements & Keyframes → Scene Keyframes",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "voiceover",
    group: "Build",
    title: "Stage 2 · Optional voiceover (TTS)",
    summary:
      "Generate standalone narration or dialogue tracks with Qwen TTS. Voiceover is optional and independent of the clips, so you can add it later or leave it for Kdenlive.",
    bullets: [
      "Enter the exact narration or dialogue text; generation is disabled without it.",
      "Voice is optional; leave it blank for the model default, or name a voice such as Cherry.",
      "Generated audio becomes the scene's active audio asset and is included in exports.",
    ],
    details: [
      {
        label: "Text",
        text: "The script to synthesize. It defaults from the scene Audio Script where available but can differ from the on-screen dialogue direction.",
      },
      {
        label: "Voice",
        text: "Optional voice identifier passed to the TTS model. Leave empty to use the provider default.",
      },
      {
        label: "Generate and retry",
        text: "Generate TTS queues an audio job for the scene and disables while active. Failed jobs show Retry and the mapped provider error.",
      },
      {
        label: "Active audio",
        text: "The newest successful voiceover becomes active. Export copies the active voiceover per scene next to its clip.",
      },
    ],
    where: "Project → Elements & Keyframes → Optional Voiceover",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "stage-3",
    group: "Build",
    title: "Stage 3 · Clips and takes",
    summary:
      "Stage 3 turns scenes into video. Review the shot order, choose a media mode per scene, generate one clip or all of them, and promote the best take.",
    bullets: [
      "Shot Strip shows the ordered filmstrip using active clips, or first keyframes as fallback.",
      "Generate Clip is per scene; Generate All Clips uses a batch confirmation dialog.",
      "Take History keeps every version so you can compare and switch the active take.",
    ],
    details: [
      {
        label: "Shot Strip",
        text: "Horizontal thumbnails numbered #01, #02, and so on, each marked Clip or Keyframe with its duration. Click a shot to jump to its scene card.",
      },
      {
        label: "Generate Clip",
        text: "Queues a video job with the scene prompt, camera direction, duration, resolution, audio mode, selected model, and the media allowed by the current mode.",
      },
      {
        label: "Generate All Clips",
        text: "The confirmation lists scene count, total duration, resolution, and model. One job per scene is queued, and jobs are throttled by MAX_CONCURRENT_JOBS.",
      },
      {
        label: "Take History",
        text: "Every successful clip is a take with a version label such as v1, v2, a timestamp, and a preview. Set Active chooses the take used by the shot strip and export.",
      },
      {
        label: "Dropped elements",
        text: "When linked references exceed the model caps, the request drops the lowest-priority extras and reports their names after queueing.",
      },
      {
        label: "Job feedback",
        text: "Status badges move through QUEUED, PENDING, RUNNING, DOWNLOADING, READY, and FAILED. Failed jobs show the error and a Retry button.",
      },
    ],
    where: "Project → Video & Export",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "media-modes",
    group: "Build",
    title: "Media modes, caps, and OSS rules",
    summary:
      "Media modes are mutually exclusive. Text-to-video takes no media, first/last frame takes frames but no references, and omni-reference takes references but no frames. The UI disables every slot that would violate the rule.",
    bullets: [
      "text_to_video ignores all input media; the prompt alone drives the shot.",
      "first_last_frame needs a first frame and cannot mix with reference media.",
      "omni_reference takes images, videos, and audio, but no first or last frames.",
    ],
    details: [
      {
        label: "text_to_video",
        text: "Uses the prompt, camera direction, duration, resolution, and audio mode only. Frames and reference slots are disabled with an explanatory tooltip.",
      },
      {
        label: "first_last_frame",
        text: "Requires a first_frame image, taken from the Stage 2 first keyframe or uploaded in Stage 3. last_frame is optional. reference_image, reference_video, reference_audio, file, and link are disabled.",
      },
      {
        label: "omni_reference",
        text: "Accepts reference_image, reference_video, and reference_audio. Linked element images are added as reference images automatically, then uploads. Name them with @Image 1, @Image 2 in the prompt. first_frame and last_frame are disabled.",
      },
      {
        label: "Wan 3.0 caps",
        text: "At most 10 reference_image, 5 reference_video, 5 reference_audio, 1 first_frame, and 1 last_frame. Requests that exceed a cap keep higher-priority items and report the rest as dropped.",
      },
      {
        label: "Temporary OSS",
        text: "Video and audio always upload through temporary OSS. Images use OSS when a file is larger than 2 MB or when a request carries more than one image; a single small image can stay Base64.",
      },
      {
        label: "OSS header",
        text: "Any request containing an oss:// URL sends X-DashScope-OssResourceResolve: enable so the provider resolves the temporary resource.",
      },
      {
        label: "Model capability gating",
        text: "Slots are also disabled when the selected model does not advertise that media type or has reached its own count limit. Hover the disabled slot to read the reason.",
      },
    ],
    note: "If Stage 3 says first/last frame mode requires an active First Keyframe, generate one in Stage 2, upload a first frame in Stage 3, or switch the scene to another mode.",
    where: "Project → Video & Export → Media Mode",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "export",
    group: "Ship",
    title: "Export to Kdenlive",
    summary:
      "Export assembles the current storyboard into an editable Kdenlive project. It always rebuilds from active takes and current scene order, so the folder matches what you see in the studio.",
    bullets: [
      "Rebuild Export rewrites export_kdenlive/ and removes stale files.",
      "Missing active clips are listed by scene title before you download.",
      "Download ZIP packages the latest export; project.kdenlive downloads on its own too.",
    ],
    details: [
      {
        label: "Rebuild Export",
        text: "Copies each scene's active video clip and active voiceover into PROJECTS_DIR/<slug>/export_kdenlive/, writes story.md, and generates a starter project.kdenlive timeline when clips exist.",
      },
      {
        label: "Export folder",
        text: "The panel prints the absolute export directory. Media names follow scene order so the timeline and the files stay aligned.",
      },
      {
        label: "Missing clips",
        text: "Scenes without an active video clip are listed by title. The export still succeeds with the available media, but those scenes are absent from the timeline.",
      },
      {
        label: "Exported files",
        text: "The panel lists every file in the export, including the .kdenlive file, story.md, clips, and voiceovers. Use the file badges to confirm what shipped.",
      },
      {
        label: "Download ZIP",
        text: "Streams a ZIP of export_kdenlive/ named <slug>-kdenlive.zip. The ZIP reflects the last rebuild; rebuild after changing takes or scene order.",
      },
      {
        label: "Finish in Kdenlive",
        text: "Import project.kdenlive, then add titles, music, grading, and transitions. story.md travels with the project as a shot-by-shot reference.",
      },
    ],
    note: "Rebuild after every take switch, reorder, or voiceover change; the ZIP is a snapshot, not a live link.",
    where: "Project → Video & Export → Kdenlive Export",
    href: "/",
    cta: "Open a project",
  },
  {
    id: "quick-clip",
    group: "Reference",
    title: "Quick Clip, field by field",
    summary:
      "Quick Clip is the shortest path to one generated shot. It skips the storyboard but uses the same models, media rules, and job system, and keeps a history of recent clips.",
    bullets: [
      "Write a prompt, polish it if useful, choose model and output shape, then attach media for the mode.",
      "Generation is disabled until the prompt has text and the selected mode has its required media.",
      "Recent clips poll every 3 seconds, preview inline, and expose Retry on failures.",
    ],
    details: [
      {
        label: "Prompt",
        text: "Describe subject, action, lighting, and camera movement. In omni_reference mode, refer to uploads as @Image 1, @Image 2, matching the upload order.",
      },
      {
        label: "Polish Prompt",
        text: "Sends the prompt to the configured text provider and replaces the textarea with the polished version, plus Camera and Audio lines. Both this and project scene polish build the prompt from six dimensions: framing and motion, style, lighting, location, action, and text/audio. Requires a non-empty prompt.",
      },
      {
        label: "Model",
        text: "Lists available video models from the synced registry. Nothing is preselected; choose a model or let Auto resolve the role. Changing the model updates the supported resolutions, duration range, and media slots.",
      },
      {
        label: "Output shape",
        text: "Audio Mode is ambient_only, narration, dialogue, or silent. Resolution is model-dependent, commonly 480P, 720P, and 1080P. Ratio is 16:9, 9:16, or 1:1. Duration offers 3, 5, 8, 10, 15, 20, and 30 seconds within the model's 2 to 30 second range.",
      },
      {
        label: "Media mode",
        text: "text_to_video, first_last_frame, or omni_reference with the same exclusivity rules as the studio. Uploads are written into the hidden quick-clip project before submission.",
      },
      {
        label: "Generate Clip",
        text: "Queues the job and returns immediately. The button shows a spinner while the request is accepted; progress appears in Recent Quick Clips.",
      },
      {
        label: "Recent Quick Clips",
        text: "A history list of every quick-clip video job with status, model, time, and error. Select one to preview it in the player; failed jobs have Retry. Jobs poll every 3 seconds.",
      },
      {
        label: "Storage",
        text: "Quick clips live in the hidden _quick-clips project so files remain available across visits. They are excluded from the Projects dashboard.",
      },
    ],
    note: "If the submit button is disabled with Attach a First Frame or switch mode to submit, the scene is in first_last_frame mode without a first frame.",
    where: "Quick Clip in the sidebar",
    href: "/quick-clip",
    cta: "Try Quick Clip",
  },
  {
    id: "settings",
    group: "Reference",
    title: "Custom models and presets",
    summary:
      "Settings has three pages: Provider Status for connection checks, Custom Models for registering model IDs, and Style Presets for reusable looks.",
    bullets: [
      "Custom Models adds a model ID, display name, modality, and family, then makes it selectable in model pickers.",
      "Style Presets creates, lists, and deletes custom Style Bibles; built-ins stay read-only.",
      "Provider Status never writes configuration; environment changes require a restart.",
    ],
    details: [
      {
        label: "Model ID",
        text: "The exact provider model identifier, for example wan3.5-video. It is unique across the registry and is what API requests send.",
      },
      {
        label: "Display name",
        text: "A human label such as Wan 3.5 Video. It appears in the registry list; pickers currently show the model ID.",
      },
      {
        label: "Modality",
        text: "video, image, audio, or text. Project and Quick Clip model pickers filter to video. The studio uses image for sheets and keyframes, audio for TTS, and text for refinement.",
      },
      {
        label: "Family",
        text: "wan3, wan2.7, qwen-image, qwen-tts, or text. Family selects the capability profile that supplies media slots, duration range, resolutions, and native-audio support.",
      },
      {
        label: "Registry list",
        text: "Each row shows modality and family with a delete button. Refresh re-reads the list. Deleting a custom model does not delete projects that already reference its ID.",
      },
      {
        label: "Presets page",
        text: "Create a preset with a unique name and Style Bible text. Built-in presets carry a Built-in badge and cannot be deleted; custom rows have a trash button.",
      },
    ],
    where: "Settings → Custom Models / Style Presets",
    href: "/settings/models",
    cta: "Manage custom models",
  },
  {
    id: "jobs",
    group: "Reference",
    title: "Jobs, statuses, and retries",
    summary:
      "Every generation is a background job. The server owns the queue, polls the provider, downloads results, and survives a restart; the client only displays progress.",
    bullets: [
      "QUEUED waits for a slot, PENDING waits for the provider, RUNNING is in progress, DOWNLOADING fetches the result, READY is saved, FAILED can be retried.",
      "The UI polls every 3 seconds; the server checks provider status every JOB_POLL_INTERVAL_MS.",
      "Concurrency is capped by MAX_CONCURRENT_JOBS, default 2, and throttled requests retry with exponential backoff up to 3 attempts.",
    ],
    details: [
      {
        label: "QUEUED",
        text: "Stored locally and waiting for a free concurrency slot. Nothing has been sent to the provider yet.",
      },
      {
        label: "PENDING",
        text: "Submitted to the provider and waiting for it to accept or start the task.",
      },
      {
        label: "RUNNING",
        text: "The provider is generating. Long video jobs can stay here for several minutes; do not resubmit.",
      },
      {
        label: "DOWNLOADING",
        text: "The provider finished and the server is saving the result into the project folder.",
      },
      {
        label: "READY",
        text: "The asset is saved, the project refreshes, and the result appears as a take, sheet, keyframe, voiceover, or quick clip.",
      },
      {
        label: "FAILED",
        text: "The job stopped with an error code and message. The badge and inline error show the reason, and a Retry action requeues it with the same parameters.",
      },
      {
        label: "Resume",
        text: "On server start the runner resumes unfinished jobs, so a dev-server restart does not lose queued or running work.",
      },
      {
        label: "Typical failures",
        text: "Missing or invalid key, wrong key/region pairing, quota or 429 throttling, a model that does not support the requested media combination, a duration or resolution outside the model range, or an unsafe file path.",
      },
    ],
    note: "429 responses are retried automatically with exponential backoff for up to 3 attempts. If the job still fails, wait before retrying to avoid burning quota.",
    where: "Any job badge or the job queue",
    href: "/settings/providers",
    cta: "Check provider status",
  },
  {
    id: "data",
    group: "Reference",
    title: "Data, backups, shortcuts, and glossary",
    summary:
      "Everything the studio knows lives in two local locations. Backing them up copies your whole studio; deleting them resets it. This step also defines the terms used across the app.",
    bullets: [
      "data/studio.db holds projects, elements, scenes, assets, jobs, custom models, and presets.",
      "projects/<slug>/ holds story.md, elements/, scenes/, and export_kdenlive/.",
      "Press ? to toggle this guide, and use the left and right arrow keys to move between steps.",
    ],
    details: [
      {
        label: "SQLite",
        text: "data/studio.db uses better-sqlite3 and Drizzle. It stores metadata only: titles, prompts, modes, links, job state, and file paths. Keep the server on Node so the native binding works.",
      },
      {
        label: "Project folders",
        text: "PROJECTS_DIR/<slug>/story.md is the written treatment. elements/ holds element images and uploads. scenes/ holds keyframes, clips, and voiceovers. export_kdenlive/ holds the latest export.",
      },
      {
        label: "Quick clips",
        text: "Quick Clip jobs and files belong to the hidden _quick-clips project under PROJECTS_DIR. They are never listed on the Projects dashboard.",
      },
      {
        label: "Backups",
        text: "Stop the server, then copy DATA_DIR and PROJECTS_DIR together. Restoring both restores projects, history, and media. Copying only the database leaves media links broken.",
      },
      {
        label: "Secrets",
        text: "Environment files are not part of a backup of the studio and should be stored separately. Never commit .env.local, data/, or projects/.",
      },
      {
        label: "Shortcuts",
        text: "Press ? outside an input, textarea, or select to open or close this guide. Left and right arrow keys move between steps while the guide is focused.",
      },
      {
        label: "Glossary",
        text: "Style Bible: the project's visual rules. Element: a recurring character, prop, or location. Sheet: the canonical image for an element. Keyframe: a still that anchors a shot. Take: one generated clip version; the active take is what exports. Job: a queued provider request.",
      },
      {
        label: "Defaults",
        text: "New projects use 16:9 and 720P with no video model preselected; choose one per project or rely on the global video role. New scenes use 5 seconds, ambient_only audio, and omni_reference video. Built-in presets are Cinematic, Anime, Documentary, Product, and Epic Hindu Mythology 3D.",
      },
    ],
    where: "Local disk and this guide",
    href: "/",
    cta: "Back to projects",
  },
];