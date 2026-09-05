PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plan_fixture_intelligence` (
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
	`record_role` text DEFAULT 'UNSPECIFIED' NOT NULL,
	`fixture_type` text NOT NULL,
	`fixture_subtype` text DEFAULT '' NOT NULL,
	`orientation` text DEFAULT 'UNKNOWN' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`sheet_number` text DEFAULT '' NOT NULL,
	`sheet_title` text DEFAULT '' NOT NULL,
	`bounding_region` text DEFAULT '' NOT NULL,
	`evidence_storage_key` text DEFAULT '' NOT NULL,
	`analysis_provider` text DEFAULT 'anthropic' NOT NULL,
	`analysis_model` text DEFAULT '' NOT NULL,
	`analysis_version` text DEFAULT 'vlm-v1' NOT NULL,
	`source_revision` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `plan_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `plan_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_plan_fixture_intelligence`("id", "project_id", "file_id", "page_id", "owner_user_id", "building", "level", "unit_number", "unit_type", "room", "record_role", "fixture_type", "fixture_subtype", "orientation", "quantity", "evidence", "confidence", "sheet_number", "sheet_title", "bounding_region", "evidence_storage_key", "analysis_provider", "analysis_model", "analysis_version", "source_revision", "created_at", "updated_at") SELECT "id", "project_id", "file_id", "page_id", "owner_user_id", "building", "level", "unit_number", "unit_type", "room", "record_role", "fixture_type", "fixture_subtype", "orientation", "quantity", "evidence", "confidence", "sheet_number", "sheet_title", "bounding_region", "evidence_storage_key", "analysis_provider", "analysis_model", "analysis_version", "source_revision", "created_at", "updated_at" FROM `plan_fixture_intelligence`;--> statement-breakpoint
DROP TABLE `plan_fixture_intelligence`;--> statement-breakpoint
ALTER TABLE `__new_plan_fixture_intelligence` RENAME TO `plan_fixture_intelligence`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_project_type_orientation` ON `plan_fixture_intelligence` (`project_id`,`fixture_type`,`orientation`);--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_project_location` ON `plan_fixture_intelligence` (`project_id`,`building`,`level`,`unit_number`);--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_page` ON `plan_fixture_intelligence` (`page_id`);--> statement-breakpoint
CREATE INDEX `idx_plan_fixture_owner_project` ON `plan_fixture_intelligence` (`owner_user_id`,`project_id`);