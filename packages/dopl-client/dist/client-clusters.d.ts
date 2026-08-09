/**
 * Cluster method group — link 3 of the chain documented in `client-base.ts`.
 * Pure delegation to `clusters.ts`; no HTTP here.
 */
import { WorkspaceMethods } from "./client-workspaces.js";
import type { ClusterDetail, ClusterRow } from "./types.js";
export declare class ClusterMethods extends WorkspaceMethods {
    createCluster(name: string): Promise<ClusterRow>;
    listClusters(): Promise<{
        clusters: ClusterRow[];
    }>;
    getCluster(slug: string): Promise<ClusterDetail>;
    updateCluster(slug: string, updates: {
        name?: string;
        description?: string | null;
    }): Promise<ClusterRow>;
    deleteCluster(slug: string): Promise<void>;
}
