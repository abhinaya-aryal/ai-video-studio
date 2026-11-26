CREATE TABLE `model_preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`auto_preset` text DEFAULT 'balanced' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_selections` (
	`slot` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`model_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`project_id` text,
	`modality` text NOT NULL,
	`model_id` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`units` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_usage_events_created_at` ON `usage_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_project_id` ON `usage_events` (`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`rough_idea` text DEFAULT '' NOT NULL,
	`refined_story` text DEFAULT '' NOT NULL,
	`style_bible` text DEFAULT '' NOT NULL,
	`style_preset_id` text,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`resolution` text DEFAULT '720P' NOT NULL,
	`default_video_model` text,
	`is_hidden` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`style_preset_id`) REFERENCES `style_presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "slug", "title", "rough_idea", "refined_story", "style_bible", "style_preset_id", "aspect_ratio", "resolution", "default_video_model", "is_hidden", "created_at", "updated_at") SELECT "id", "slug", "title", "rough_idea", "refined_story", "style_bible", "style_preset_id", "aspect_ratio", "resolution", "default_video_model", "is_hidden", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
ALTER TABLE `custom_models` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_models` ADD `provider_created_at` integer;--> statement-breakpoint
ALTER TABLE `custom_models` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `custom_models` ADD `available` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_models` ADD `ignored` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_models` ADD `capabilities_edited` integer DEFAULT 0 NOT NULL;