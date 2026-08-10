CREATE TABLE `plan_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`openai_file_id` text,
	`vector_store_file_id` text,
	`status` text DEFAULT 'uploading' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plan_files_storage_key` ON `plan_files` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plan_files_project_sha256` ON `plan_files` (`project_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `idx_plan_files_project_created` ON `plan_files` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_plan_files_owner_status` ON `plan_files` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `plan_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`vector_store_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plan_projects_owner_name` ON `plan_projects` (`owner_user_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_plan_projects_owner_updated` ON `plan_projects` (`owner_user_id`,`updated_at`);