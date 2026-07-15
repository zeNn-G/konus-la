// PROTOTYPE — THROWAWAY (wayfinder ticket #48).
// Plan: three variants of the Roles settings UX, switchable via ?variant=a|b|c on the
// guild routes, mounted inside the real guild-settings dialog. The same URL param also
// takes over member rows (assignment chips), the members panel (role grouping + tints),
// and chat author names, all backed by the in-memory store in ./store.ts.

import { VariantAMasterDetail } from "./variant-a-master-detail";
import { VariantBAccordion } from "./variant-b-accordion";
import { VariantCMatrix } from "./variant-c-matrix";
import type { RolesVariant } from "./use-variant";

export function RolesPrototypeSection({ variant }: { variant: RolesVariant }) {
  if (variant === "a") return <VariantAMasterDetail />;
  if (variant === "b") return <VariantBAccordion />;
  return <VariantCMatrix />;
}

/** Placeholder for sections the map spec's directly (report inbox, audit log). */
export function StubSection({ label }: { label: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {label} follows the existing section patterns and is spec’d directly — only its nav
      gating is part of this prototype. Flip “Viewing as” in the sidebar to see it appear
      and disappear.
    </p>
  );
}
