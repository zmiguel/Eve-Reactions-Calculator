CREATE TABLE `material_blueprint_materials` (
	`blueprint_type_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`blueprint_type_id`, `type_id`)
);
