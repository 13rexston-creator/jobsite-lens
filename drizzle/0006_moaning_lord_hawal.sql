CREATE TABLE `plan_analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_id` text NOT NULL,
	`page_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`task` text NOT NULL,
	`status` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `plan_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `plan_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plan_analysis_runs_page_created` ON `plan_analysis_runs` (`page_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_plan_analysis_runs_owner_project` ON `plan_analysis_runs` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `plan_benchmark_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`page_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`task` text NOT NULL,
	`prompt` text NOT NULL,
	`expected_json` text DEFAULT 'UNVERIFIED' NOT NULL,
	`verification_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `plan_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plan_benchmark_cases_owner_project` ON `plan_benchmark_cases` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `plan_benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`answer_json` text DEFAULT '' NOT NULL,
	`correctness` text DEFAULT 'UNVERIFIED' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `plan_benchmark_cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plan_benchmark_runs_case_created` ON `plan_benchmark_runs` (`case_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `plan_fixture_intelligence` ADD `bounding_region` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_fixture_intelligence` ADD `evidence_storage_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_fixture_intelligence` ADD `analysis_provider` text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_fixture_intelligence` ADD `analysis_model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_fixture_intelligence` ADD `analysis_version` text DEFAULT 'vlm-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_fixture_intelligence` ADD `source_revision` text DEFAULT '' NOT NULL;