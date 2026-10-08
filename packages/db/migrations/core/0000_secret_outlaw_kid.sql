CREATE TABLE `adjusted_prices` (
	`type_id` integer PRIMARY KEY NOT NULL,
	`adjusted_price` real NOT NULL,
	`average_price` real,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`character_id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_hash` text NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`refresh_token_enc` text,
	`token_status` text DEFAULT 'none' NOT NULL,
	`last_refreshed_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cost_indices` (
	`system_id` integer PRIMARY KEY NOT NULL,
	`reaction` real NOT NULL,
	`manufacturing` real NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `http_cache` (
	`url` text PRIMARY KEY NOT NULL,
	`etag` text,
	`last_modified` text,
	`expires_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`detail_json` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_kind_started_idx` ON `job_runs` (`kind`,`started_at`);--> statement-breakpoint
CREATE TABLE `latest_prices` (
	`hub_id` text NOT NULL,
	`type_id` integer NOT NULL,
	`buy_max` real,
	`sell_min` real,
	`buy_p5` real,
	`sell_p5` real,
	`buy_volume` integer NOT NULL,
	`sell_volume` integer NOT NULL,
	`buy_orders` integer NOT NULL,
	`sell_orders` integer NOT NULL,
	`source` text NOT NULL,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`hub_id`, `type_id`)
);
--> statement-breakpoint
CREATE TABLE `market_hubs` (
	`hub_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`region_id` integer NOT NULL,
	`system_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`fuzzwork_location_id` integer,
	`visibility` text NOT NULL,
	`share_status` text DEFAULT 'none' NOT NULL,
	`share_reviewed_by` integer,
	`share_reviewed_at` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`last_success_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_stats` (
	`region_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`avg_daily_volume_30d` real NOT NULL,
	`avg_price_5d` real NOT NULL,
	`avg_price_30d` real NOT NULL,
	`last_date` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`region_id`, `type_id`)
);
--> statement-breakpoint
CREATE TABLE `reaction_materials` (
	`blueprint_type_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`blueprint_type_id`, `type_id`)
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`blueprint_type_id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`formula_name` text NOT NULL,
	`name` text NOT NULL,
	`product_type_id` integer NOT NULL,
	`product_quantity` integer NOT NULL,
	`reactor` text NOT NULL,
	`tier` text NOT NULL,
	`base_time_seconds` integer NOT NULL,
	`max_runs` integer NOT NULL,
	`required_skill_level` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_slug_unique` ON `reactions` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_product_type_id_unique` ON `reactions` (`product_type_id`);--> statement-breakpoint
CREATE TABLE `regions` (
	`region_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reprocess_materials` (
	`type_id` integer NOT NULL,
	`material_type_id` integer NOT NULL,
	`quantity` integer,
	`quantity_min` integer,
	`quantity_max` integer,
	`portion_size` integer NOT NULL,
	PRIMARY KEY(`type_id`, `material_type_id`)
);
--> statement-breakpoint
CREATE TABLE `sde_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`build_number` integer NOT NULL,
	`release_date` text NOT NULL,
	`imported_at` integer NOT NULL,
	`constants_json` text NOT NULL,
	`warnings_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `structure_links` (
	`user_id` text NOT NULL,
	`structure_id` integer NOT NULL,
	`character_id` integer NOT NULL,
	`share_requested` integer DEFAULT false NOT NULL,
	`access_status` text DEFAULT 'ok' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `structure_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`character_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `structure_links_structure_id_idx` ON `structure_links` (`structure_id`);--> statement-breakpoint
CREATE TABLE `systems` (
	`system_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region_id` integer NOT NULL,
	`security_status` real NOT NULL,
	`security_band` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `systems_name_lower_idx` ON `systems` (lower("name"));--> statement-breakpoint
CREATE TABLE `types` (
	`type_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`group_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`volume` real NOT NULL,
	`portion_size` integer NOT NULL,
	`published` integer NOT NULL,
	`base_price` real
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_sessions_user_id_idx` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`settings_json` text,
	`settings_updated_at` integer
);
