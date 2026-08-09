/**
 * Cluster methods for `DoplClient`. Free functions over `DoplTransport`,
 * matching the convention every other domain in this package already uses
 * (`knowledge.ts`, `channel.ts`, `chats.ts`, …); the class-side method group
 * lives in `client-clusters.ts` and does nothing but delegate here.
 *
 * These bodies were INLINE in `client.ts` until the §2 per-domain split — the
 * routes, tool names and response shapes are carried over verbatim, so the
 * wire behaviour is unchanged by the move.
 */

import type { DoplTransport } from "./transport.js";
import type { ClusterDetail, ClusterRow } from "./types.js";

const enc = encodeURIComponent;

export async function createCluster(
  t: DoplTransport,
  name: string
): Promise<ClusterRow> {
  return t.request<ClusterRow>("/api/clusters", {
    method: "POST",
    toolName: "canvas_create_cluster",
    body: { name },
  });
}

export async function listClusters(
  t: DoplTransport
): Promise<{ clusters: ClusterRow[] }> {
  return t.request<{ clusters: ClusterRow[] }>("/api/clusters", {
    toolName: "list_clusters",
  });
}

export async function getCluster(
  t: DoplTransport,
  slug: string
): Promise<ClusterDetail> {
  return t.request<ClusterDetail>(`/api/clusters/${enc(slug)}`, {
    toolName: "get_cluster",
  });
}

export async function updateCluster(
  t: DoplTransport,
  slug: string,
  updates: { name?: string; description?: string | null }
): Promise<ClusterRow> {
  return t.request<ClusterRow>(`/api/clusters/${enc(slug)}`, {
    method: "PATCH",
    toolName: "update_cluster",
    body: updates,
  });
}

export async function deleteCluster(
  t: DoplTransport,
  slug: string
): Promise<void> {
  await t.requestNoContent(
    `/api/clusters/${enc(slug)}`,
    "DELETE",
    "delete_cluster"
  );
}
