CREATE TABLE `inventory_items` (
	`source_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`bucket` text NOT NULL,
	`type_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`source_id`, `location_id`, `bucket`, `type_id`),
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory_locations` (
	`source_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`system_id` integer,
	PRIMARY KEY(`source_id`, `location_id`),
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory_selection` (
	`source_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`bucket` text NOT NULL,
	PRIMARY KEY(`source_id`, `location_id`, `bucket`),
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory_sources` (
	`source_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`character_id` integer NOT NULL,
	`kind` text NOT NULL,
	`owner_id` integer NOT NULL,
	`owner_name` text NOT NULL,
	`division_names_json` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_id` text,
	`sync_started_at` integer,
	`last_attempt_at` integer,
	`last_synced_at` integer,
	`data_as_of` integer,
	`last_error` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`character_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_sources_user_kind_owner_idx` ON `inventory_sources` (`user_id`,`kind`,`owner_id`);