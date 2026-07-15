/** A role's color swatch; uncolored roles show the neutral dot. */
export function RoleDot({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
    />
  );
}
