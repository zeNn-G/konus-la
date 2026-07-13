DROP INDEX `channel_guild_id_name_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `channel_guild_id_kind_name_uq` ON `channel` (`guild_id`,`kind`,`name`);