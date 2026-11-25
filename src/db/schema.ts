import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const ELEMENT_KINDS = ["character", "prop", "location"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const AUDIO_MODES = [
  "ambient_only",
  "narration",
  "dialogue",
  "silent",
] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];

export const VIDEO_MODES = [
  "text_to_video",
  "first_last_frame",
  "omni_reference",
] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const ASSET_TYPES = ["image", "video", "audio"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_ROLES = [
  "element_sheet",
  "keyframe_first",
  "keyframe_last",
  "video_clip",
  "voiceover",
  "quick_clip",
] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

export const JOB_MODALITIES = ["image", "video", "audio"] as const;
export type JobModality = (typeof JOB_MODALITIES)[number];

export const JOB_STATUSES = [
  "QUEUED",
  "PENDING",
  "RUNNING",
  "DOWNLOADING",
  "READY",
  "FAILED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CUSTOM_MODEL_MODALITIES = [
  "image",
  "video",
  "audio",
  "text",
] as const;
export type CustomModelModality = (typeof CUSTOM_MODEL_MODALITIES)[number];

export const stylePresets = sqliteTable("style_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  styleBible: text("style_bible").notNull(),
  isBuiltin: integer("is_builtin").notNull().default(0),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  roughIdea: text("rough_idea").notNull().default(""),
  refinedStory: text("refined_story").notNull().default(""),
  styleBible: text("style_bible").notNull().default(""),
  stylePresetId: text("style_preset_id").references(() => stylePresets.id, {
    onDelete: "set null",
  }),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  resolution: text("resolution").notNull().default("720P"),
  defaultVideoModel: text("default_video_model")
    .notNull()
    .default("wan3.0-video"),
  isHidden: integer("is_hidden").notNull().default(0),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at")
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const referenceElements = sqliteTable(
  "reference_elements",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ELEMENT_KINDS }).notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    activeImagePath: text("active_image_path"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_reference_elements_project_id").on(table.projectId),
  ],
);

export const scenes = sqliteTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    visualPrompt: text("visual_prompt").notNull().default(""),
    cameraDirection: text("camera_direction").notNull().default(""),
    audioMode: text("audio_mode", { enum: AUDIO_MODES })
      .notNull()
      .default("ambient_only"),
    audioScript: text("audio_script").notNull().default(""),
    duration: integer("duration").notNull().default(5),
    videoMode: text("video_mode", { enum: VIDEO_MODES })
      .notNull()
      .default("omni_reference"),
    linkedElementIdsJson: text("linked_element_ids_json")
      .notNull()
      .default("[]"),
    activeKeyframeFirstAssetId: text("active_keyframe_first_asset_id"),
    activeKeyframeLastAssetId: text("active_keyframe_last_asset_id"),
    activeVideoAssetId: text("active_video_asset_id"),
    activeAudioAssetId: text("active_audio_asset_id"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_scenes_project_order").on(table.projectId, table.orderIndex),
  ],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sceneId: text("scene_id").references(() => scenes.id, {
      onDelete: "set null",
    }),
    elementId: text("element_id").references(() => referenceElements.id, {
      onDelete: "set null",
    }),
    type: text("type", { enum: ASSET_TYPES }).notNull(),
    role: text("role", { enum: ASSET_ROLES }).notNull(),
    version: integer("version").notNull().default(1),
    filePath: text("file_path").notNull(),
    prompt: text("prompt").notNull().default(""),
    paramsJson: text("params_json").notNull().default("{}"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_assets_project_id").on(table.projectId),
    index("idx_assets_scene_id").on(table.sceneId),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sceneId: text("scene_id").references(() => scenes.id, {
      onDelete: "set null",
    }),
    elementId: text("element_id").references(() => referenceElements.id, {
      onDelete: "set null",
    }),
    modality: text("modality", { enum: JOB_MODALITIES }).notNull(),
    modelId: text("model_id").notNull(),
    role: text("role", { enum: ASSET_ROLES }).notNull(),
    requestJson: text("request_json").notNull(),
    externalTaskId: text("external_task_id"),
    status: text("status", { enum: JOB_STATUSES })
      .notNull()
      .default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    resultAssetId: text("result_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("idx_jobs_project_status").on(table.projectId, table.status),
    index("idx_jobs_status").on(table.status),
  ],
);

export const customModels = sqliteTable("custom_models", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  modality: text("modality", { enum: CUSTOM_MODEL_MODALITIES }).notNull(),
  family: text("family").notNull(),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
});

export type StylePreset = typeof stylePresets.$inferSelect;
export type NewStylePreset = typeof stylePresets.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ReferenceElement = typeof referenceElements.$inferSelect;
export type NewReferenceElement = typeof referenceElements.$inferInsert;

export type Scene = typeof scenes.$inferSelect;
export type NewScene = typeof scenes.$inferInsert;

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type CustomModel = typeof customModels.$inferSelect;
export type NewCustomModel = typeof customModels.$inferInsert;
