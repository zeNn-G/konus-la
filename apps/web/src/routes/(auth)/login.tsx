import { Button } from "@konus-la/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@konus-la/ui/components/card";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/(auth)/login")({
  component: LoginComponent,
});

function LoginComponent() {
  const navigate = useNavigate();
  // Banned is durable state, not a transient failure — it pins to the card instead of
  // toasting, and only a fresh attempt (which will re-set it while banned) clears it.
  const [bannedMessage, setBannedMessage] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
    onSubmit: async ({ value }) => {
      setBannedMessage(null);
      await authClient.signIn.email(
        { email: value.email, password: value.password },
        {
          onSuccess: () => {
            // Whatever account was cached before this sign-in isn't ours to keep.
            queryClient.clear();
            navigate({ to: "/" });
            toast.success("Signed in.");
          },
          onError: (error) => {
            if (error.error.code === "BANNED_USER") {
              setBannedMessage(
                error.error.message || "This account has been banned from this instance.",
              );
              return;
            }
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
  });

  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Welcome back to konus-la.</CardDescription>
        </CardHeader>
        <CardContent>
          {bannedMessage && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-red-500"
            >
              {bannedMessage}
            </div>
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <form.Field name="email">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={field.name}>Email</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    autoComplete="email"
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

            <form.Field name="password">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={field.name}>Password</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    autoComplete="current-password"
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
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </Button>
              )}
            </form.Subscribe>

            <p className="text-muted-foreground">
              No account?{" "}
              <Link to="/signup" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
