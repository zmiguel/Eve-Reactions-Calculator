CREATE TABLE `job_results` (
	`user_id` text NOT NULL,
	`job_id` integer NOT NULL,
	`input_cost` real NOT NULL,
	`job_cost` real NOT NULL,
	`output_type_id` integer,
	`output_qty` integer NOT NULL,
	`sold_qty` integer NOT NULL,
	`sales_net` real NOT NULL,
	`used_qty` integer NOT NULL,
	`unsold_qty` integer NOT NULL,
	`unit_cost` real,
	`realized_profit` real NOT NULL,
	`flags_json` text,
	PRIMARY KEY(`user_id`, `job_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ledger_lots` (
	`user_id` text NOT NULL,
	`lot_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	`quantity` integer NOT NULL,
	`remaining` integer NOT NULL,
	`unit_cost` real NOT NULL,
	`origin` text NOT NULL,
	`origin_ref` text NOT NULL,
	`price_source` text NOT NULL,
	PRIMARY KEY(`user_id`, `lot_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_lots_user_type_acquired_idx` ON `ledger_lots` (`user_id`,`type_id`,`acquired_at`);--> statement-breakpoint
CREATE TABLE `ledger_prices` (
	`user_id` text NOT NULL,
	`ref` text NOT NULL,
	`type_id` integer NOT NULL,
	`incoming` integer NOT NULL,
	`at` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` real NOT NULL,
	`source_kind` text NOT NULL,
	`source_text` text NOT NULL,
	`needs_review` integer NOT NULL,
	`tax` real,
	`tax_source` text,
	`broker_fee` real,
	`broker_fee_source` text,
	`transfer` integer NOT NULL,
	PRIMARY KEY(`user_id`, `ref`, `type_id`, `incoming`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_prices_user_at_idx` ON `ledger_prices` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `ledger_prices_user_type_idx` ON `ledger_prices` (`user_id`,`type_id`);--> statement-breakpoint
CREATE TABLE `ledger_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`rebuilt_at` integer,
	`dirty` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ledger_unallocated_fees` (
	`user_id` text NOT NULL,
	`ref_id` integer NOT NULL,
	`date` integer NOT NULL,
	`amount` real NOT NULL,
	PRIMARY KEY(`user_id`, `ref_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ledger_uses` (
	`user_id` text NOT NULL,
	`lot_id` integer NOT NULL,
	`use_kind` text NOT NULL,
	`use_ref` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost` real NOT NULL,
	PRIMARY KEY(`user_id`, `lot_id`, `use_kind`, `use_ref`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_uses_user_kind_ref_idx` ON `ledger_uses` (`user_id`,`use_kind`,`use_ref`);--> statement-breakpoint
CREATE TABLE `price_corrections` (
	`user_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_ref` text NOT NULL,
	`unit_price` real NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `target_kind`, `target_ref`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracked_contract_items` (
	`user_id` text NOT NULL,
	`contract_id` integer NOT NULL,
	`record_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`is_included` integer NOT NULL,
	PRIMARY KEY(`user_id`, `contract_id`, `record_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`,`contract_id`) REFERENCES `tracked_contracts`(`user_id`,`contract_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracked_contracts` (
	`user_id` text NOT NULL,
	`contract_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`issuer_id` integer NOT NULL,
	`issuer_corporation_id` integer NOT NULL,
	`acceptor_id` integer NOT NULL,
	`assignee_id` integer NOT NULL,
	`for_corporation` integer NOT NULL,
	`price` real,
	`reward` real,
	`title` text,
	`date_issued` integer NOT NULL,
	`date_completed` integer,
	`start_location_id` integer,
	`janice_code` text,
	`janice_json` text,
	PRIMARY KEY(`user_id`, `contract_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracked_contracts_user_issued_idx` ON `tracked_contracts` (`user_id`,`date_issued`);--> statement-breakpoint
CREATE TABLE `tracked_jobs` (
	`user_id` text NOT NULL,
	`job_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`installer_id` integer NOT NULL,
	`blueprint_type_id` integer NOT NULL,
	`product_type_id` integer,
	`runs` integer NOT NULL,
	`status` text NOT NULL,
	`cost` real,
	`facility_id` integer NOT NULL,
	`output_location_id` integer NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer NOT NULL,
	`completed_date` integer,
	PRIMARY KEY(`user_id`, `job_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracked_jobs_user_start_idx` ON `tracked_jobs` (`user_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `tracked_journal` (
	`user_id` text NOT NULL,
	`ref_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`division` integer,
	`date` integer NOT NULL,
	`ref_type` text NOT NULL,
	`amount` real,
	`context_id` integer,
	`context_id_type` text,
	PRIMARY KEY(`user_id`, `ref_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracked_journal_user_context_idx` ON `tracked_journal` (`user_id`,`context_id_type`,`context_id`);--> statement-breakpoint
CREATE TABLE `tracked_orders` (
	`user_id` text NOT NULL,
	`order_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`is_buy` integer NOT NULL,
	`price` real NOT NULL,
	`volume_total` integer NOT NULL,
	`volume_remain` integer NOT NULL,
	`issued` integer NOT NULL,
	`location_id` integer NOT NULL,
	`division` integer,
	`state` text NOT NULL,
	PRIMARY KEY(`user_id`, `order_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracked_orders_user_type_idx` ON `tracked_orders` (`user_id`,`type_id`);--> statement-breakpoint
CREATE TABLE `tracked_transactions` (
	`user_id` text NOT NULL,
	`transaction_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`division` integer,
	`date` integer NOT NULL,
	`type_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` real NOT NULL,
	`is_buy` integer NOT NULL,
	`client_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`journal_ref_id` integer NOT NULL,
	`is_personal` integer,
	PRIMARY KEY(`user_id`, `transaction_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracked_transactions_user_type_date_idx` ON `tracked_transactions` (`user_id`,`type_id`,`date`);--> statement-breakpoint
CREATE TABLE `tracking_streams` (
	`source_id` integer NOT NULL,
	`stream` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cursor` integer,
	`etag` text,
	`expires_at` integer,
	`last_synced_at` integer,
	`last_error` text,
	PRIMARY KEY(`source_id`, `stream`),
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `inventory_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `tracking_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `tracking_status` text;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `tracking_run_id` text;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `tracking_started_at` integer;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `tracking_last_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `tracking_synced_at` integer;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `tracking_last_error` text;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `wallet_divisions_json` text;--> statement-breakpoint
ALTER TABLE `inventory_sources` ADD `wallet_names_json` text;--> statement-breakpoint
ALTER TABLE `users` ADD `tracking_json` text;