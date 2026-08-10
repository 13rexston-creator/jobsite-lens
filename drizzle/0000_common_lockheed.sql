CREATE TABLE `procore_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`procore_user_id` text NOT NULL,
	`procore_login` text NOT NULL,
	`procore_name` text,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`connected_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
