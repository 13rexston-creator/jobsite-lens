CREATE TABLE `plan_fixture_intelligence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_id` text NOT NULL,
	`page_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`building` text DEFAULT '' NOT NULL,
	`level` text DEFAULT '' NOT NULL,
	`unit_number` text DEFAULT '' NOT NULL,
	`unit_type` text DEFAULT '' NOT NULL,
	`room` text DEFAULT '' NOT NULL,
	`fixture_type` text NOT NULL,
	`fixture_subtype` text DEFAULT '' NOT NULL,
	`orientation` text DEFAULT 'UNKNOWN' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`sheet_number` text DEFAULT '' NOT NULL,
	`sheet_title` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `plan_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `plan_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_project_type_orientation` ON `plan_fixture_intelligence` (`project_id`,`fixture_type`,`orientation`);--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_project_location` ON `plan_fixture_intelligence` (`project_id`,`building`,`level`,`unit_number`);--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_page` ON `plan_fixture_intelligence` (`page_id`);--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_owner_project` ON `plan_fixture_intelligence` (`owner_user_id`,`project_id`);