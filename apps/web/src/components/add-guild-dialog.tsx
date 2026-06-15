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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@konus-la/ui/components/tabs";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { orpc, queryClient } from "@/utils/orpc";

type Mode = "create" | "join";

/**
 * Rail trigger + modal to add a guild — create your own or join one by invite code,
 * toggled in a single dialog. On success: refetch the rail and open the guild.
 */
export function AddGuildDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("create");
  const navigate = useNavigate();

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: orpc.guild.list.queryOptions().queryKey });

  const goToGuild = (guildId: string) => {
    setOpen(false);
    navigate({ to: "/guilds/$guildId", params: { guildId } });
  };

  const createGuild = useMutation(
    orpc.guild.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidateList();
        toast.success(`Created ${created.name}.`);
        goToGuild(created.id);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const joinGuild = useMutation(
    orpc.guild.invite.consume.mutationOptions({
      onSuccess: async (result) => {
        await invalidateList();
        toast.success(result.joined ? "Joined the guild." : "You’re already a member.");
        goToGuild(result.guildId);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const createForm = useForm({
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

  const joinForm = useForm({
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
        if (!next) {
          setMode("create");
          createForm.reset();
          joinForm.reset();
        }
      }}
    >
      <DialogTrigger
        render={<Button size="icon" variant="outline" aria-label="Add a guild" title="Add a guild" />}
      >
        <PlusIcon className="size-5" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a guild</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create your own guild. You can invite people once it’s created."
              : "Join an existing guild with an invite code."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1">
              Create
            </TabsTrigger>
            <TabsTrigger value="join" className="flex-1">
              Join
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                createForm.handleSubmit();
              }}
            >
              <createForm.Field name="name">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={field.name}>Name</Label>
                    <Input
                      id={field.name}
                      name={field.name}
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
              </createForm.Field>

              <createForm.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button type="submit" disabled={isSubmitting} className="mt-1">
                    {isSubmitting ? "Creating…" : "Create guild"}
                  </Button>
                )}
              </createForm.Subscribe>
            </form>
          </TabsContent>

          <TabsContent value="join">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                joinForm.handleSubmit();
              }}
            >
              <joinForm.Field name="code">
                {(field) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={field.name}>Invite code</Label>
                    <Input
                      id={field.name}
                      name={field.name}
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
              </joinForm.Field>

              <joinForm.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button type="submit" disabled={isSubmitting} className="mt-1">
                    {isSubmitting ? "Joining…" : "Join guild"}
                  </Button>
                )}
              </joinForm.Subscribe>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
