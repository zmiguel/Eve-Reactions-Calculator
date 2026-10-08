CREATE TABLE `adjusted_price_daily` (
	`date` text NOT NULL,
	`type_id` integer NOT NULL,
	`adjusted_price` real NOT NULL,
	PRIMARY KEY(`type_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `archive_manifest` (
	`date` text PRIMARY KEY NOT NULL,
	`object_count` integer NOT NULL,
	`bytes` integer NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_index_daily` (
	`date` text NOT NULL,
	`system_id` integer NOT NULL,
	`reaction` real NOT NULL,
	PRIMARY KEY(`system_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `esi_market_history` (
	`region_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`date` text NOT NULL,
	`average` real NOT NULL,
	`highest` real NOT NULL,
	`lowest` real NOT NULL,
	`volume` integer NOT NULL,
	`order_count` integer NOT NULL,
	PRIMARY KEY(`region_id`, `type_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `price_daily` (
	`date` text NOT NULL,
	`hub_id` text NOT NULL,
	`type_id` integer NOT NULL,
	`buy_avg` real,
	`sell_avg` real,
	`buy_close` real,
	`sell_close` real,
	`buy_low` real,
	`buy_high` real,
	`sell_low` real,
	`sell_high` real,
	`samples` integer NOT NULL,
	PRIMARY KEY(`hub_id`, `type_id`, `date`)
);
--> statement-breakpoint
CREATE INDEX `price_daily_date_idx` ON `price_daily` (`date`);--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`snapshot_at` integer NOT NULL,
	`hub_id` text NOT NULL,
	`type_id` integer NOT NULL,
	`buy_max` real,
	`sell_min` real,
	`buy_p5` real,
	`sell_p5` real,
	`buy_volume` integer NOT NULL,
	`sell_volume` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`hub_id`, `type_id`, `snapshot_at`)
);
--> statement-breakpoint
CREATE INDEX `price_snapshots_snapshot_at_idx` ON `price_snapshots` (`snapshot_at`);