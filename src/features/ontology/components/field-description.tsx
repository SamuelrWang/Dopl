"use client";

/** A field's description as the row's hint: a caption under the value column. Nothing renders
 *  without one. */
export function FieldDescription({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="col-start-2 whitespace-pre-line pb-1 text-caption text-text-muted">{text}</p>
  );
}

/** Sets, or clears with `""` — an ABSENT key is the stored shape of "none". */
export function withDescription<T extends { description?: string }>(
  row: T,
  description: string
): T {
  const rest = { ...row };
  delete rest.description;
  return description ? { ...rest, description } : rest;
}
