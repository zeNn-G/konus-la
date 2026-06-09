import { Button } from "@konus-la/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@konus-la/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/(app)/admin/codes")({
  component: AdminCodesComponent,
});

function AdminCodesComponent() {
  const listOptions = orpc.signupCode.list.queryOptions();
  const codes = useQuery(listOptions);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

  const createCode = useMutation(
    orpc.signupCode.create.mutationOptions({
      onSuccess: async (created) => {
        await invalidate();
        toast.success(`Created code ${created.code}`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const revokeCode = useMutation(
    orpc.signupCode.revoke.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Code revoked.");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Signup codes</CardTitle>
          <CardDescription>Mint invite codes for new members.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Button onClick={() => createCode.mutate({})} disabled={createCode.isPending}>
              {createCode.isPending ? "Minting…" : "Mint code"}
            </Button>
            <Link to="/" className="ml-auto text-primary hover:underline">
              Home
            </Link>
          </div>

          {codes.isPending ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : codes.data && codes.data.length > 0 ? (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {codes.data.map((c) => {
                const used = Boolean(c.usedAt);
                const expired = !used && c.expiresAt != null && c.expiresAt.getTime() <= Date.now();
                return (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <code className="font-mono text-sm">{c.code}</code>
                    <span className="text-muted-foreground">
                      {used
                        ? `claimed by @${c.usedByUsername ?? "unknown"}`
                        : expired
                          ? "expired"
                          : "available"}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      {!used && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => navigator.clipboard?.writeText(c.code)}
                        >
                          Copy
                        </Button>
                      )}
                      {!used && (
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={revokeCode.isPending}
                          onClick={() => revokeCode.mutate({ id: c.id })}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground">No codes yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
