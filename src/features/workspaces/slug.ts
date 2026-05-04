/**
 * Slugify a workspace name into a URL-safe handle. Slug uniqueness is
 * not enforced at this layer — `public_id` is the unique routing key
 * — so this is a pure name → kebab-case transform with no I/O.
 *
 * Audit fix S-16: NFKC-normalize before the strip so full-width or
 * confusable characters produce the same slug as their ASCII analogs
 * instead of collapsing to the fallback.
 */
export function slugifyWorkspaceName(name: string): string {
  return (
    name
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "workspace"
  );
}
