CREATE TABLE `manual_entries` (
	`entry_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`date` integer NOT NULL,
	`type_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` real NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `manual_entries_user_date_idx` ON `manual_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `tracked_facilities` (
	`user_id` text NOT NULL,
	`facility_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`system_id` integer,
	`type_id` integer,
	`rigs_json` text,
	`rigs_read_at` integer,
	`checked_at` integer,
	`next_check_at` integer,
	PRIMARY KEY(`user_id`, `facility_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `job_results` ADD `manufactured_qty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_results` ADD `manufactured_value` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_uses` ADD `unit_value` real;--> statement-breakpoint
ALTER TABLE `tracked_jobs` ADD `activity_id` integer DEFAULT 9 NOT NULL;--> statement-breakpoint
ALTER TABLE `tracked_jobs` ADD `blueprint_id` integer;--> statement-breakpoint
ALTER TABLE `tracked_jobs` ADD `blueprint_me` integer;