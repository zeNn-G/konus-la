import { Button } from "@konus-la/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@konus-la/ui/components/dialog";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogInIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { orpc, queryClient } from "@/utils/orpc";

/** Rail trigger + modal to join a guild by invite code. On success: refetch and open it. */
export function JoinGuildDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const joinGuild = useMutation(
    orpc.guild.invite.consume.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({
          queryKey: orpc.guild.list.queryOptions().queryKey,
        });
        setOpen(false);
        toast.success(result.joined ? "Joined the guild." : "You’re already a member.");
        navigate({ to: "/guilds/$guildId", params: { guildId: result.guildId } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const form = useForm({
    defaultValues: { code: "" },
    validators: {
      onSubmit: z.object({ code: z.string().trim().min(1, "Enter an invite code") }),
    },
    onSubmit: async ({ value }) => {
      await joinGuild.mutateAsync({ code: value.code.trim() });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger
        render={<Button size="icon" variant="ghost" aria-label="Join a guild" title="Join a guild" />}
      >
        <LogInIcon className="size-5" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a guild</DialogTitle>
          <DialogDescription>Paste an invite code to join an existing guild.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="code">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={field.name}>Invite code</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  autoFocus
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
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
                {isSubmitting ? "Joining…" : "Join guild"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}
