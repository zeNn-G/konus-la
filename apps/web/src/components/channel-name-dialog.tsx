import { Button } from "@konus-la/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@konus-la/ui/components/dialog";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import type { ChannelListItem } from "@/lib/use-realtime";
import { orpc, queryClient } from "@/utils/orpc";

export const CHANNEL_NAME_REGEX = /^[a-z0-9-]{1,32}$/;

/** Discord-style normalisation as you type: lowercase, spaces → dashes, strip the rest. */
export function normalizeChannelName(raw: string): string {
  return raw
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}

const nameSchema = z.object({
  name: z.string().regex(CHANNEL_NAME_REGEX, "1–32 characters: lowercase letters, digits, dashes."),
});

/** Both kinds are named, so voice doesn't read as the exceptional one. */
function createTitle(kind: ChannelKind): string {
  return kind === "voice" ? "Create a voice channel" : "Create a text channel";
}

function renameTitle(channel: Pick<ChannelListItem, "name" | "kind">): string {
  return channel.kind === "voice" ? `Rename ${channel.name}` : `Rename #${channel.name}`;
}

type ChannelKind = "text" | "voice";

type Props = {
  guildId: string;
  /** Absent → create; present → rename this channel (whose own kind drives the copy). */
  channel?: Pick<ChannelListItem, "id" | "name" | "kind">;
  /** Which kind to create — the sidebar "+" that opened this already answered it. */
  kind?: ChannelKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Create or rename a guild channel (owner only — the trigger is owner-gated by the caller).
 * Voice names are slugs under the same validator as text; only the `#` prefix is text-only,
 * since voice rows render with a speaker glyph instead.
 */
export function ChannelNameDialog({ guildId, channel, kind = "text", open, onOpenChange }: Props) {
  const invalidateChannels = () =>
    queryClient.invalidateQueries({ queryKey: orpc.channel.list.key() });

  const create = useMutation(
    orpc.channel.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidateChannels();
        toast.success(
          created.kind === "voice"
            ? `Created voice channel ${created.name}.`
            : `Created #${created.name}.`,
        );
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const rename = useMutation(
    orpc.channel.update.mutationOptions({
      onSuccess: async () => {
        await invalidateChannels();
        onOpenChange(false);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const form = useForm({
    defaultValues: { name: channel?.name ?? "" },
    validators: { onSubmit: nameSchema },
    onSubmit: async ({ value }) => {
      if (channel) {
        await rename.mutateAsync({ guildId, channelId: channel.id, name: value.name });
      } else {
        await create.mutateAsync({ guildId, name: value.name, kind });
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) form.reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{channel ? renameTitle(channel) : createTitle(kind)}</DialogTitle>
          <DialogDescription>Lowercase letters, digits, and dashes.</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="name">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={field.name}>Name</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  autoFocus
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(normalizeChannelName(e.target.value))}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting} className="mt-1">
                {isSubmitting ? "Saving…" : channel ? "Rename" : "Create channel"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}
