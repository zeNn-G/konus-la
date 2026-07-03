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
      guildId: string;
      message: ChatMessage;
      /** So the recipient can bump its own mention badge without a refetch. */
      mentionedUserIds: string[];
    }
  | {
      type: "message.updated";
      guildId: string;
      channelId: string;
      messageId: string;
      content: string;
      editedAt: Date;
    }
  | { type: "message.deleted"; guildId: string; channelId: string; messageId: string }
  | {
      type: "typing";
      guildId: string;
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
       * First event of every subscription: who (among users sharing a guild with the
       * subscriber) is online right now. The subscriber itself is excluded — it knows.
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
      type: "channel.created" | "channel.updated";
      guildId: string;
      channel: { id: string; name: string | null; kind: string; createdAt: Date };
    }
  | { type: "channel.deleted"; guildId: string; channelId: string };

/** Dynamic per-user topics: one subscription per connection, on the subscriber's own topic. */
export type EventMap = Record<`user:${string}`, RealtimeEvent>;
