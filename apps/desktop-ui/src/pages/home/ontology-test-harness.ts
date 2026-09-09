import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { WORKSPACE_ID, noContent, ok } from "#/test-utils/bridge";
import type { OntologySnapshot } from "@/features/ontology/types";
import { CHANNEL_ID } from "./home-test-ids";

/**
 * /home → ONTOLOGY: the fixtures and the routing table both new suites read.
 *
 * ⚠ ONE COPY, for the reason `home-test-harness.tsx` gives: a second `SNAPSHOT`
 * is how two suites come to disagree about what an ontology looks like.
 *
 * ⚠ THE ROWS LIVE IN THE **PERSONAL** CONTAINER (`WORKSPACE_ID`, which is the
 * boot payload's `workspace`), never in the link container — that is the whole
 * claim of this face, so a fixture filed under the channel's container would
 * pass a test that proves the opposite.
 */

export const PIPELINE_ID = "cluster-pipeline";
export const ROSTER_ID = "cluster-roster";

/**
 * 🔒 **`Roster` DELIBERATELY CARRIES NEITHER SHARING FIELD** — it is the
 * STALE-CACHE shape (INVARIANTS §8), a snapshot written by a bundle that
 * predates them and served from IndexedDB on the first paint after an upgrade.
 * Its two fallbacks are different answers on purpose: `agentsMayEdit` falls back
 * to the column default (`true`), `sharedChannelCount` to `null` — so the card
 * SAYS NOTHING about sharing rather than claiming zero.
 *
 * ⚠ THE CAST IS THE POINT AND IS NOT LAZINESS: the two fields are not on
 * `OntologyCluster` at all (they are a `Partial` in `client/api.ts`), so the
 * fixture states the WIRE body, which is what the fallback exists for.
 */
export const SNAPSHOT = {
  clusters: [
    {
      id: PIPELINE_ID,
      slug: "pipeline",
      name: "Pipeline",
      purpose: "Deals in flight",
      columnIds: ["col-1"],
      layout: {},
      agentsMayEdit: false,
      sharedChannelCount: 2,
    },
    {
      id: ROSTER_ID,
      slug: "roster",
      name: "Roster",
      purpose: "",
      columnIds: [],
      layout: {},
    },
  ],
  objects: {
    "col-1": object("col-1", "Stage", ["card-1", "card-2"]),
    "card-1": object("card-1", "Acme"),
    "card-2": object("card-2", "Globex"),
  },
} as unknown as OntologySnapshot;

/** `Pipeline` is lent into the one home channel the page's fixture has. */
export const SHARES = {
  shares: [
    {
      channelId: CHANNEL_ID,
      membersLevel: "view",
      guestsLevel: "none",
      ownerAgentsLevel: "edit",
    },
  ],
  canManage: true,
};

export const SHARES_PATH = `/api/ontology/clusters/${PIPELINE_ID}/shares`;

/**
 * THE CLUSTER ROLL-UP (2026-09-09, the CHANGELOG lane part 2) — one FIELD row on
 * an object of `Pipeline` and one rename on the ontology itself, which is the
 * pair the roll-up exists to show together.
 *
 * ⚠ THE OBJECT ROW'S PAYLOAD IS `{field, before, after}`, NOT `{body}`: an
 * ontology revision is one PROPERTY of one object, and a fixture carrying a body
 * would pass a renderer that only knows how to draw a document.
 */
export const CLUSTER_REVISIONS = {
  revisions: [
    {
      id: "rev-stage",
      resourceType: "ontology_object",
      resourceId: "card-1",
      workspaceId: WORKSPACE_ID,
      actor: { userId: "user-1", kind: "user", agentSessionId: null },
      op: "edit",
      summary: null,
      payload: {
        field: "attribute:stage",
        before: { kind: "pill", value: "New" },
        after: { kind: "pill", value: "Won" },
      },
      contentHash: "h1",
      createdAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
    },
    {
      id: "rev-name",
      resourceType: "ontology_cluster",
      resourceId: PIPELINE_ID,
      workspaceId: WORKSPACE_ID,
      actor: { userId: "user-1", kind: "agent", agentSessionId: "chan-1:abc" },
      op: "rename",
      summary: null,
      payload: { field: "name", before: "Deals", after: "Pipeline" },
      contentHash: "h2",
      createdAt: "2026-09-08T09:00:00.000Z",
      updatedAt: "2026-09-08T09:00:00.000Z",
    },
  ],
  nextCursor: null,
};

/**
 * The ontology reads and writes, or `null` for a path this table does not own —
 * so a suite chains it in front of `home-test-harness.tsx › routes` and every
 * other page read keeps answering.
 *
 * ⚠ `canManage` IS THE SERVER'S ANSWER and rides this body, so a read-only case
 * overrides it here rather than passing a prop the component does not take.
 */
export function ontologyRoutes(
  path: string,
  opts: BridgeRequestOpts = {},
  shares: unknown = SHARES
): Promise<BridgeResponse> | null {
  const bare = path.split("?")[0];
  if (bare === "/api/ontology") return Promise.resolve(ok(SNAPSHOT));
  if (bare === "/api/billing/status") {
    return Promise.resolve(
      ok({ plan: "pro", objectCap: null, objectsUsed: 3, isCapped: false })
    );
  }
  // ⚠ BEFORE the `/clusters/` arms below — a GET on `/clusters/{id}/revisions`
  // would otherwise fall through to `null` and read as an unexpected path.
  if (bare.endsWith("/revisions")) return Promise.resolve(ok(CLUSTER_REVISIONS));
  if (bare.startsWith("/api/ontology/clusters/") && bare.endsWith("/shares")) {
    if (opts.method === "PUT") return Promise.resolve(noContent());
    if (opts.method === "DELETE") return Promise.resolve(noContent());
    return Promise.resolve(ok(shares));
  }
  if (bare === "/api/ontology/clusters" && opts.method === "POST") {
    return Promise.resolve(
      ok({
        cluster: {
          id: "cluster-new",
          slug: "new-cluster",
          name: "New cluster",
          purpose: "",
          columnIds: [],
          layout: {},
        },
      })
    );
  }
  if (bare.startsWith("/api/ontology/clusters/")) {
    if (opts.method === "PATCH") return Promise.resolve(ok({ cluster: {} }));
    if (opts.method === "DELETE") return Promise.resolve(noContent());
  }
  return null;
}

/** The personal container these rows live in — the boot payload's `workspace`. */
export const PERSONAL_WORKSPACE_ID = WORKSPACE_ID;

function object(id: string, name: string, childIds: string[] = []) {
  return {
    id,
    name,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds,
    template: [],
  };
}
