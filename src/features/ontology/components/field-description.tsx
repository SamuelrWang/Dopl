"use client";

/**
 * A field's description, as the row's last line — muted caption, full width
 * (`basis-full` breaks the row's `flex-wrap`, so the cells above keep their
 * order). Nothing renders without one: no placeholder, no hint, the label +
 * control ruling.
 */
export function FieldDescription({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="basis-full whitespace-pre-line text-caption text-text-muted">{text}</p>
  );
}

/** Sets, or clears with `""` — an ABSENT key is the stored shape of "none",
 *  the one every row written before 2026-10-01 already has. */
export function withDescription<T extends { description?: string }>(
  row: T,
  description: string
): T {
  const rest = { ...row };
  delete rest.description;
  return description ? { ...rest, description } : rest;
}
