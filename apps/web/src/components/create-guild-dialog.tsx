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
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { orpc, queryClient } from "@/utils/orpc";

/** Rail trigger + modal to create a guild. On success: refetch the rail and open the guild. */
export function CreateGuildDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const createGuild = useMutation(
    orpc.guild.create.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({
          queryKey: orpc.guild.list.queryOptions().queryKey,
        });
        setOpen(false);
        toast.success(`Created ${created.name}.`);
        navigate({ to: "/guilds/$guildId", params: { guildId: created.id } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const form = useForm({
    defaultValues: { name: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, "Name is required").max(100, "Max 100 characters"),
      }),
    },
    onSubmit: async ({ value }) => {
      await createGuild.mutateAsync({ name: value.name.trim() });
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
        render={
          <Button size="icon" variant="outline" aria-label="Create a guild" title="Create a guild" />
        }
      >
        <PlusIcon className="size-5" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a guild</DialogTitle>
          <DialogDescription>
            Give your guild a name. You can invite people once it’s created.
          </DialogDescription>
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
                {isSubmitting ? "Creating…" : "Create guild"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}
