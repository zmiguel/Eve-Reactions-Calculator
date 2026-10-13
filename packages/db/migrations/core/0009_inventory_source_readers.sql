CREATE TABLE `inventory_source_readers` (
	`source_id` integer NOT NULL,
	`character_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `character_id`),
	FOREIGN KEY (`source_id`) REFERENCES `inventory_sources`(`source_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`character_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `inventory_source_readers` (`source_id`, `character_id`, `created_at`)
SELECT `source_id`, `character_id`, `created_at` FROM `inventory_sources` WHERE `kind` = 'corporation';
