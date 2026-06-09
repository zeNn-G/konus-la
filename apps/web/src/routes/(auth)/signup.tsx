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
import { toast } from "sonner";
import { z } from "zod";

import { FieldError } from "@/components/field-error";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/(auth)/signup")({
  component: SignupComponent,
});

function SignupComponent() {
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { email: "", username: "", displayName: "", password: "", signupCode: "" },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        username: z.string().regex(/^[a-z0-9_]{3,20}$/, "3–20 chars: a–z, 0–9 or _"),
        displayName: z.string(),
        password: z.string().min(8, "Password must be at least 8 characters"),
        signupCode: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      const username = value.username.trim().toLowerCase();
      const code = value.signupCode.trim();

      await authClient.signUp.email(
        {
          email: value.email.trim(),
          password: value.password,
          name: value.displayName.trim() || username,
          username,
        },
        {
          // Signup code travels as a header; the server consumes it (no-op for the first user).
          ...(code ? { headers: { "x-signup-code": code } } : {}),
          onSuccess: () => {
            navigate({ to: "/" });
            toast.success("Account created.");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
  });

  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            You need an invite code unless you’re the first user on this instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="username">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={field.name}>Username</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    placeholder="lowercase, 3–20 chars (a–z, 0–9, _)"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value.toLowerCase())}
                  />
                  <p className="text-xs text-muted-foreground">
                    Permanent — used for @mentions. Can’t be changed later.
                  </p>
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="displayName">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={field.name}>Display name (optional)</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    placeholder="Defaults to your username"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
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
                    autoComplete="new-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="signupCode">
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
                </div>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting} className="mt-1">
                  {isSubmitting ? "Creating account…" : "Create account"}
                </Button>
              )}
            </form.Subscribe>

            <p className="text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
