CREATE TABLE `chatgpt_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chatgpt_connections_token_hash` ON `chatgpt_connections` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_chatgpt_connections_owner_revoked` ON `chatgpt_connections` (`owner_user_id`,`revoked_at`);