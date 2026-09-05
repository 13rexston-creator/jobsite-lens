ALTER TABLE `plan_files` DROP COLUMN `openai_file_id`;--> statement-breakpoint
ALTER TABLE `plan_files` DROP COLUMN `vector_store_file_id`;--> statement-breakpoint
ALTER TABLE `plan_projects` DROP COLUMN `vector_store_id`;