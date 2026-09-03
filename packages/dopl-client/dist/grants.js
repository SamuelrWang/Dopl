"use strict";
/**
 * Resource-grant methods for `DoplClient`. Free functions over `DoplTransport`;
 * the class-side method group is `client-workspaces.ts` (link 2 — a grant is
 * cross-domain and must sit below every domain link that names one).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantResource = grantResource;
/**
 * Lend one resource to one scope.
 *
 * ⚠ **IDEMPOTENT BY CONSTRUCTION** — the server upserts on the grant's PRIMARY
 * KEY `(scope_type, scope_id, resource_type, resource_id)`, so re-sending the
 * same body changes only `level`. That is what makes a retry after an ambiguous
 * network failure safe, which an agent lane needs more than a browser does.
 */
async function grantResource(t, input) {
    return t.request("/api/resource-grants", {
        method: "PUT",
        body: input,
        toolName: "resource_grant",
    });
}
