"use strict";
/**
 * THE APP'S GLOBAL SEARCH — `GET /api/search`. The same server implementation
 * the search popup calls, so an agent and a person searching one container get one answer.
 *
 * ⚠ THE FENCE IS THE SERVER'S: every read behind the route enters through the caller's own
 * `workspace_members` / `channel_members` rows, a container the caller is not in yields 403, and a
 * container-locked credential is narrowed to its lock (`ctx.apiKeyWorkspaceId`). Nothing here widens
 * or re-states any of it. Hand-mirrors `src/features/search/contracts.ts`; move both halves together.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchContainer = searchContainer;
/** One container's search. A query under 2 characters answers with no groups, never a 400. */
async function searchContainer(t, query, containerId) {
    const params = new URLSearchParams({ q: query, scope: "container", container: containerId });
    return t.request(`/api/search?${params.toString()}`, {
        toolName: "search",
    });
}
