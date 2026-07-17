// PROTOTYPE — THROWAWAY (wayfinder ticket #77). Admin surfaces baked into the dialog
// as sections (second reaction — this redraws the map's "admin stays on routes" scope
// line). All data is in-memory fakes; actions mutate local state only.

import { Avatar } from "@konus-la/ui/components/avatar";
import { Button } from "@konus-la/ui/components/button";
import { Input } from "@konus-la/ui/components/input";
import { Label } from "@konus-la/ui/components/label";
import { useState } from "react";
import { toast } from "sonner";

type FakeCode = { id: number; code: string; status: "available" | "claimed" | "expired"; by?: string };

const SEED_CODES: FakeCode[] = [
  { id: 1, code: "K7Q2-M9X4", status: "available" },
  { id: 2, code: "A3F8-P5T1", status: "claimed", by: "bob" },
  { id: 3, code: "Z9W6-R2N7", status: "expired" },
];

export function AdminCodesSection() {
  const [codes, setCodes] = useState(SEED_CODES);
  const [nextId, setNextId] = useState(SEED_CODES.length + 1);

  const mint = () => {
    const code = `${rand4()}-${rand4()}`;
    setCodes((list) => [{ id: nextId, code, status: "available" as const }, ...list]);
    setNextId((n) => n + 1);
    toast.success(`Created code ${code} (prototype — in-memory)`);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">Mint invite codes for new members.</p>
      <div>
        <Button onClick={mint}>Mint code</Button>
      </div>
      <ul className="flex flex-col divide-y divide-foreground/10">
        {codes.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <code className="font-mono text-sm">{c.code}</code>
            <span className="text-muted-foreground">
              {c.status === "claimed" ? `claimed by @${c.by}` : c.status}
            </span>
            {c.status === "available" && (
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void navigator.clipboard?.writeText(c.code)}
                >
                  Copy
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => setCodes((list) => list.filter((x) => x.id !== c.id))}
                >
                  Revoke
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function rand4(): string {
  // Math.random is fine here — throwaway UI, not workflow code.
  return Array.from({ length: 4 }, () =>
    "ABCDEFGHJKMNPQRSTVWXYZ123456789".charAt(Math.floor(Math.random() * 31)),
  ).join("");
}

type FakeBan = { id: number; name: string; username: string; reason: string };

const SEED_BANS: FakeBan[] = [
  { id: 1, name: "Mallory", username: "mallory", reason: "Spamming invite links in every guild" },
];

export function AdminBansSection() {
  const [bans, setBans] = useState(SEED_BANS);
  const [who, setWho] = useState("");
  const [reason, setReason] = useState("");
  const canBan = who.trim().length > 0 && reason.trim().length > 0;

  return (
    <div className="grid grid-cols-1 items-start gap-x-8 gap-y-6 sm:grid-cols-2">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canBan) return;
          const username = who.trim().replace(/^@/, "");
          setBans((list) => [
            { id: Date.now(), name: username, username, reason: reason.trim() },
            ...list,
          ]);
          toast.success(`Banned @${username} (prototype — in-memory)`);
          setWho("");
          setReason("");
        }}
      >
        <p className="text-xs text-muted-foreground">
          Ban an account from this instance. The reason is required — it is the only record
          of why.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proto-ban-target">Who</Label>
          <Input
            id="proto-ban-target"
            placeholder="Search by name or @username"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="proto-ban-reason">Reason</Label>
          <Input
            id="proto-ban-reason"
            placeholder="Required"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div>
          <Button type="submit" variant="destructive" disabled={!canBan}>
            Ban from instance
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Banned users</p>
        {bans.length > 0 ? (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {bans.map((ban) => (
              <li key={ban.id} className="flex items-center gap-3 py-2">
                <Avatar seed={ban.username} className="size-7 shrink-0" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">
                    {ban.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">@{ban.username}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{ban.reason}</span>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setBans((list) => list.filter((x) => x.id !== ban.id))}
                >
                  Unban
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No one is banned.</p>
        )}
      </div>
    </div>
  );
}
