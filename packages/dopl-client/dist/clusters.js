"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCluster = createCluster;
exports.listClusters = listClusters;
exports.getCluster = getCluster;
exports.updateCluster = updateCluster;
exports.deleteCluster = deleteCluster;
const enc = encodeURIComponent;
async function createCluster(t, name) {
    return t.request("/api/clusters", {
        method: "POST",
        toolName: "canvas_create_cluster",
        body: { name },
    });
}
async function listClusters(t) {
    return t.request("/api/clusters", {
        toolName: "list_clusters",
    });
}
async function getCluster(t, slug) {
    return t.request(`/api/clusters/${enc(slug)}`, {
        toolName: "get_cluster",
    });
}
async function updateCluster(t, slug, updates) {
    return t.request(`/api/clusters/${enc(slug)}`, {
        method: "PATCH",
        toolName: "update_cluster",
        body: updates,
    });
}
async function deleteCluster(t, slug) {
    await t.requestNoContent(`/api/clusters/${enc(slug)}`, "DELETE", "delete_cluster");
}
