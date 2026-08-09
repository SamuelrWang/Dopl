/**
 * Cluster method group — link 3 of the chain documented in `client-base.ts`.
 * Pure delegation to `clusters.ts`; no HTTP here.
 */

import { WorkspaceMethods } from "./client-workspaces.js";
import * as clusters from "./clusters.js";
import type { ClusterDetail, ClusterRow } from "./types.js";

export class ClusterMethods extends WorkspaceMethods {
  async createCluster(name: string): Promise<ClusterRow> {
    return clusters.createCluster(this.transport, name);
  }

  async listClusters(): Promise<{ clusters: ClusterRow[] }> {
    return clusters.listClusters(this.transport);
  }

  async getCluster(slug: string): Promise<ClusterDetail> {
    return clusters.getCluster(this.transport, slug);
  }

  async updateCluster(
    slug: string,
    updates: { name?: string; description?: string | null }
  ): Promise<ClusterRow> {
    return clusters.updateCluster(this.transport, slug, updates);
  }

  async deleteCluster(slug: string): Promise<void> {
    return clusters.deleteCluster(this.transport, slug);
  }
}
