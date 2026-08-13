CREATE TABLE `document_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_company_id` text DEFAULT '' NOT NULL,
	`external_project_id` text NOT NULL,
	`external_project_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_synced_at` integer,
	`sync_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_sources_project_provider_external` ON `document_sources` (`project_id`,`provider`,`external_project_id`);--> statement-breakpoint
CREATE INDEX `idx_document_sources_owner_project` ON `document_sources` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `source_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`external_document_id` text NOT NULL,
	`external_revision` text DEFAULT '' NOT NULL,
	`document_number` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`discipline` text DEFAULT '' NOT NULL,
	`mime_type` text DEFAULT 'application/pdf' NOT NULL,
	`size` integer,
	`issued_at` text DEFAULT '' NOT NULL,
	`file_id` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `document_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `plan_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `plan_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_documents_source_external` ON `source_documents` (`source_id`,`external_document_id`);--> statement-breakpoint
CREATE INDEX `idx_source_documents_project_status` ON `source_documents` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_source_documents_owner_project` ON `source_documents` (`owner_user_id`,`project_id`);