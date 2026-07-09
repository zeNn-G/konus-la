CREATE TABLE `channel_participant` (
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`joined_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `channel_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_participant_channel_id_idx` ON `channel_participant` (`channel_id`);--> statement-breakpoint
ALTER TABLE `channel` ADD `is_group` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `channel` ADD `dm_pair_key` text;--> statement-breakpoint
ALTER TABLE `channel` ADD `owner_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `channel_dm_pair_key_uq` ON `channel` (`dm_pair_key`);