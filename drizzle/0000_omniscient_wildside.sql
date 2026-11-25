CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scene_id` text,
	`element_id` text,
	`type` text NOT NULL,
	`role` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`file_path` text NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`params_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`element_id`) REFERENCES `reference_elements`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_assets_project_id` ON `assets` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_assets_scene_id` ON `assets` (`scene_id`);--> statement-breakpoint
CREATE TABLE `custom_models` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`modality` text NOT NULL,
	`family` text NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_models_model_id_unique` ON `custom_models` (`model_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scene_id` text,
	`element_id` text,
	`modality` text NOT NULL,
	`model_id` text NOT NULL,
	`role` text NOT NULL,
	`request_json` text NOT NULL,
	`external_task_id` text,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`result_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`element_id`) REFERENCES `reference_elements`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`result_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_project_status` ON `jobs` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`rough_idea` text DEFAULT '' NOT NULL,
	`refined_story` text DEFAULT '' NOT NULL,
	`style_bible` text DEFAULT '' NOT NULL,
	`style_preset_id` text,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`resolution` text DEFAULT '720P' NOT NULL,
	`default_video_model` text DEFAULT 'wan3.0-video' NOT NULL,
	`is_hidden` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`style_preset_id`) REFERENCES `style_presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `reference_elements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`active_image_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reference_elements_project_id` ON `reference_elements` (`project_id`);--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`visual_prompt` text DEFAULT '' NOT NULL,
	`camera_direction` text DEFAULT '' NOT NULL,
	`audio_mode` text DEFAULT 'ambient_only' NOT NULL,
	`audio_script` text DEFAULT '' NOT NULL,
	`duration` integer DEFAULT 5 NOT NULL,
	`video_mode` text DEFAULT 'omni_reference' NOT NULL,
	`linked_element_ids_json` text DEFAULT '[]' NOT NULL,
	`active_keyframe_first_asset_id` text,
	`active_keyframe_last_asset_id` text,
	`active_video_asset_id` text,
	`active_audio_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scenes_project_order` ON `scenes` (`project_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `style_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`style_bible` text NOT NULL,
	`is_builtin` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `style_presets_name_unique` ON `style_presets` (`name`);