CREATE TABLE `plan_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`page_count` integer NOT NULL,
	`storage_key` text,
	`image_size` integer,
	`width` integer,
	`height` integer,
	`extracted_text` text DEFAULT '' NOT NULL,
	`is_candidate` integer DEFAULT false NOT NULL,
	`analysis_status` text DEFAULT 'pending' NOT NULL,
	`analysis_json` text,
	`analysis_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `plan_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plan_pages_file_page` ON `plan_pages` (`file_id`,`page_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plan_pages_storage_key` ON `plan_pages` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_plan_pages_project_candidate_status` ON `plan_pages` (`project_id`,`is_candidate`,`analysis_status`);