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
export declare function createCluster(t: DoplTransport, name: string): Promise<ClusterRow>;
export declare function listClusters(t: DoplTransport): Promise<{
    clusters: ClusterRow[];
}>;
export declare function getCluster(t: DoplTransport, slug: string): Promise<ClusterDetail>;
export declare function updateCluster(t: DoplTransport, slug: string, updates: {
    name?: string;
    description?: string | null;
}): Promise<ClusterRow>;
export declare function deleteCluster(t: DoplTransport, slug: string): Promise<void>;
