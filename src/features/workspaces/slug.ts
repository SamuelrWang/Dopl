import { RESERVED_WORKSPACE_SLUGS } from "@/config";

/**
 * Slugify a workspace name into a URL-safe handle, deduplicating against
 * the user's existing workspace slugs AND against reserved top-level
 * route names (so a workspace can never shadow `/login`, `/settings`,
 * etc.). Mirrors `slugifyClusterName` in `features/clusters/slug.ts` so
 * behavior is consistent across features.
 */
export function slugifyWorkspaceName(name: string, existing: string[]): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "workspace";

  const taken = new Set(existing);
  const isAvailable = (candidate: string) =>
    !taken.has(candidate) && !RESERVED_WORKSPACE_SLUGS.has(candidate);

  if (isAvailable(base)) return base;

  let n = 2;
  while (!isAvailable(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
