CREATE TABLE `manufacturing_blueprint_materials` (
	`blueprint_type_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`blueprint_type_id`, `type_id`)
);
--> statement-breakpoint
CREATE TABLE `manufacturing_blueprints` (
	`blueprint_type_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`product_type_id` integer NOT NULL,
	`product_name` text NOT NULL,
	`product_filters_json` text NOT NULL
);
