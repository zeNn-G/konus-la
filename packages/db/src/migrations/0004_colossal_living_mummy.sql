CREATE TABLE `audit_log_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text,
	`target_channel_id` text,
	`target_message_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`guild_id`) REFERENCES `guild`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_log_entry_guild_id_idx` ON `audit_log_entry` (`guild_id`);--> statement-breakpoint
CREATE TABLE `report` (
	`id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`message_author_id` text NOT NULL,
	`message_content` text NOT NULL,
	`reason` text NOT NULL,
	`reporter_id` text NOT NULL,
	`resolved_at` integer,
	`resolved_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`guild_id`) REFERENCES `guild`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `report_guild_id_idx` ON `report` (`guild_id`);--> statement-breakpoint
ALTER TABLE `guild_membership` ADD `server_muted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_role` ADD `permissions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_role` ADD `color` text;