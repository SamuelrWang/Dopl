/**
 * Client-side fetch helpers for workspace-member mutations (role change +
 * removal), shared by the members table and the member detail drawer.
 */

import type { AssignableRole } from "./types";

const ws = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}`;

async function throwResponseError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error(body?.error?.message || body?.error || fallback);
}

export async function updateMemberRole(
  workspaceSlug: string,
  userId: string,
  role: AssignableRole
): Promise<void> {
  const res = await fetch(`${ws(workspaceSlug)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) await throwResponseError(res, "Failed to update role");
}

export async function removeMember(
  workspaceSlug: string,
  userId: string
): Promise<void> {
  const res = await fetch(`${ws(workspaceSlug)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok && res.status !== 204) {
    await throwResponseError(res, "Failed to remove member");
  }
}
