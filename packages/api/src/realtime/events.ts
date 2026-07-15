/**
 * Server → client realtime vocabulary. Every event is delivered on the recipient's own
 * `user:{userId}` topic — recipient sets are computed at publish time (see publishers.ts),
 * so membership changes never require a resubscribe. One discriminated union keeps the
 * client dispatcher a single exhaustive switch.
 */

/** Author block embedded in message payloads — mirrors the `chat.history` row shape. */
export type MessageAuthor = {
  id: string;
  username: string;
  displayName: string;
  image: string | null;
};

/** Reply preview embedded in message payloads. Null when not a reply (or parent deleted). */
export type MessageReplyPreview = {
  id: string;
  content: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
} | null;

/** The wire shape of one message — identical to a `chat.history` row so caches can share it. */
export type ChatMessage = {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  replyToMessageId: string | null;
  author: MessageAuthor;
  replyTo: MessageReplyPreview;
};

export type RealtimeEvent =
  | {
      type: "message.created";
      /** Null for DM channels — the client routes by `message.channelId` either way. */
      guildId: string | null;
      message: ChatMessage;
      /** So the recipient can bump its own mention badge without a refetch. */
      mentionedUserIds: string[];
    }
  | {
      type: "message.updated";
      guildId: string | null;
      channelId: string;
      messageId: string;
      content: string;
      editedAt: Date;
    }
  | { type: "message.deleted"; guildId: string | null; channelId: string; messageId: string }
  | {
      type: "typing";
      guildId: string | null;
      channelId: string;
      userId: string;
      username: string;
      displayName: string;
      /** Epoch ms. Ephemeral — clients drop the indicator past this; nothing is stored. */
      expiresAt: number;
    }
  | { type: "presence.update"; userId: string; online: boolean }
  | {
      /**
       * First event of every subscription: who (among users sharing a guild or a DM with
       * the subscriber) is online right now. The subscriber itself is excluded — it knows.
       */
      type: "presence.snapshot";
      onlineUserIds: string[];
    }
  | {
      /** Self-only: another tab/device of the same user read a channel. */
      type: "readState.updated";
      channelId: string;
      lastReadMessageId: string;
      mentionsCount: number;
    }
  | {
      /** `guildId: null` = a DM channel (group creation / rename) → refresh the DM list. */
      type: "channel.created" | "channel.updated";
      guildId: string | null;
      channel: { id: string; name: string | null; kind: string; createdAt: Date };
    }
  | { type: "channel.deleted"; guildId: string; channelId: string }
  | {
      /**
       * Guild roster changes (join via invite / kick / ban / leave). Receiving `removed`
       * with your OWN userId is the "this guild is gone for you" signal — the guild layout
       * evicts you; everyone else just refreshes the roster. `added` with your own userId
       * clears a stale eviction tombstone (rejoin after a kick) and refreshes other tabs.
       */
      type: "guild.member.added" | "guild.member.removed";
      guildId: string;
      userId: string;
    }
  | {
      /**
       * Guild-level structural change every member should re-read (today: ownership
       * transfer — `viewer.isOwner` and the crown flip live). Clients refetch `guild.get`.
       */
      type: "guild.updated";
      guildId: string;
    }
  | {
      /**
       * The guild no longer exists for ANY recipient — unlike `guild.member.removed`,
       * there is no per-user check: everyone drops the rail row and evicts if inside.
       */
      type: "guild.deleted";
      guildId: string;
    }
  | {
      /**
       * The guild's role set changed (create / update / delete / reorder collapse into
       * one — invalidate-only). Every member refetches `guild.get`; the audit log records
       * *what* changed, this event only *that* something did.
       */
      type: "role.changed";
      guildId: string;
    }
  | {
      /**
       * One member's role SET changed (assign / unassign). Invalidate-only like
       * `role.changed`: every member refetches `guild.get` — roster regrouping, name
       * tints, and the target's own permission gates all reconcile off that one read.
       */
      type: "member.rolesChanged";
      guildId: string;
      userId: string;
    }
  | {
      /**
       * Voice occupancy bootstrap — yielded right after `presence.snapshot` on every
       * subscription: every occupied voice channel in the subscriber's guilds, flags
       * included. Socket-connected ⇔ occupancy-correct; there is no fetch path (ADR 0007).
       * `speakingUserIds` stays empty until the media slice wires the AudioLevelObserver.
       */
      type: "voice.snapshot";
      rooms: Array<{
        guildId: string;
        channelId: string;
        seats: Array<{ userId: string; selfMute: boolean; selfDeaf: boolean }>;
        speakingUserIds: string[];
      }>;
    }
  | {
      /** Guild-wide: someone took a seat (fresh join or channel switch — never a rebind). */
      type: "voice.peerJoined";
      guildId: string;
      channelId: string;
      userId: string;
      selfMute: boolean;
      selfDeaf: boolean;
    }
  | {
      /** Guild-wide: a seat emptied — explicit leave, channel switch, or grace expiry. */
      type: "voice.peerLeft";
      guildId: string;
      channelId: string;
      userId: string;
    }
  | {
      type: "voice.peerMutedSelf";
      guildId: string;
      channelId: string;
      userId: string;
      selfMute: boolean;
    }
  | {
      type: "voice.peerDeafenedSelf";
      guildId: string;
      channelId: string;
      userId: string;
      selfDeaf: boolean;
    }
  | {
      /**
       * Guild-wide, edge-triggered FULL set: published only when the room's speaking set
       * changes (the AudioLevelObserver's ~500 ms interval is the debounce — ADR 0007).
       * Silent rooms cost zero messages; each event replaces the previous set wholesale.
       */
      type: "voice.activeSpeakers";
      guildId: string;
      channelId: string;
      speakingUserIds: string[];
    }
  | {
      /**
       * Room-only (current seats of that room): a peer published a track — the consume
       * trigger. `source` disambiguates same-kind producers (cam vs screen tile, mic vs
       * screenshare audio).
       */
      type: "voice.producerAdded";
      channelId: string;
      userId: string;
      producerId: string;
      kind: "audio" | "video";
      source: "mic" | "cam" | "screen" | "screenAudio";
    }
  | {
      /** Room-only: a producer is gone — explicit close, or its peer's media half died. */
      type: "voice.producerClosed";
      channelId: string;
      userId: string;
      producerId: string;
    }
  | {
      /**
       * Self-only: another connection took over your seat (multi-tab steal). Tear down to
       * idle ONLY if `replacedSeatSessionId` matches your own — the winning tab's session
       * id never appears here, so it ignores the event (race-proof for a third tab).
       */
      type: "voice.sessionReplaced";
      channelId: string;
      replacedSeatSessionId: string;
    }
  | {
      /**
       * Self-only, published after an SFU worker respawn: keep your seat, redo your
       * plumbing — re-run `voice.join` (it lands as a grace rebind).
       */
      type: "voice.mediaReset";
      channelId: string;
    }
  | { type: "dm.participant.added"; channelId: string; userId: string }
  | {
      /**
       * Someone left or was removed from a group DM. Receiving this with your OWN userId is
       * the one and only "this DM is gone for you" signal — `channel.deleted` never fires
       * for DMs (the last leaver's deletion publishes `removed` to the leaver alone).
       * Remaining participants receive the same event and just refresh the roster.
       */
      type: "dm.participant.removed";
      channelId: string;
      userId: string;
    };

/** Dynamic per-user topics: one subscription per connection, on the subscriber's own topic. */
export type EventMap = Record<`user:${string}`, RealtimeEvent>;
