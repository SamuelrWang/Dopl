import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import type { OntologyObject, OntologySnapshot } from "@/features/ontology/types";

/**
 * The one ontology bridge stub, shared by the canvas and ontology smoke tests.
 *
 * Shared on purpose rather than as convenience: `/canvas` and `/ontology` are
 * two renderings of ONE store (`useOntology` + `OntologyResourcesProvider` +
 * the billing entitlements read), so a divergent fixture would let one page's
 * test pass against a snapshot shape the other page never sees. The port
 * playbook treats them as a single slice for exactly this reason.
 *
 * Lives here (not in a test file) so both suites import it without one test
 * file importing another.
 */

export const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";
export const SEGMENT = "acme-ab12cd";
export const CLUSTER_ID = "cluster-1";
export const COLUMN_ID = "obj-column-1";
export const CARD_ID = "obj-card-1";

const object = (over: Partial<OntologyObject> & { id: string }): OntologyObject => ({
  name: "",
  subtitle: "",
  attributes: [],
  relationships: [],
  methods: [],
  childIds: [],
  template: [],
  ...over,
});

export const SNAPSHOT: OntologySnapshot = {
  clusters: [
    {
      id: CLUSTER_ID,
      slug: "revenue",
      name: "Revenue",
      purpose: "How money reaches the business.",
      columnIds: [COLUMN_ID],
      // `{}` = pure auto-layout, the state every cluster starts in. The stored
      // -override path belongs to use-graph-positions' own unit tests.
      layout: {},
    },
    {
      id: "cluster-2",
      slug: "delivery",
      name: "Delivery",
      purpose: "",
      columnIds: [],
      layout: {},
    },
  ],
  objects: {
    [COLUMN_ID]: object({
      id: COLUMN_ID,
      name: "Accounts",
      subtitle: "Companies we sell to",
      childIds: [CARD_ID],
    }),
    [CARD_ID]: object({ id: CARD_ID, name: "Acme Corp", subtitle: "Enterprise" }),
  },
};

export function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/**
 * Every path the canvas/ontology tree reads or writes. Anything else rejects
 * loudly — an unexpected request is a port defect, not a fixture gap.
 */
export function ontologyBridge(
  path: string,
  opts: BridgeRequestOpts = {}
): Promise<BridgeResponse> {
  if (path.startsWith("/api/workspaces/resolve")) {
    return Promise.resolve(
      ok({
        workspace: { id: WORKSPACE_ID, slug: "acme", publicId: "ab12cd" },
        canonical: SEGMENT,
        needsRedirect: false,
      })
    );
  }
  if (path === "/api/workspaces/me") {
    return Promise.resolve(ok({ role: "owner", userId: "user-1" }));
  }
  if (path === "/api/ontology") return Promise.resolve(ok(SNAPSHOT));
  if (path === "/api/ontology/clusters" && opts.method === "POST") {
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
  if (path === "/api/ontology/objects" && opts.method === "POST") {
    return Promise.resolve(ok({ object: object({ id: "obj-new", name: "Untitled column" }) }));
  }
  if (path.startsWith("/api/ontology/clusters/") || path.startsWith("/api/ontology/objects/")) {
    return Promise.resolve({ status: 204, statusText: "No Content", hasBody: false });
  }
  if (path === "/api/knowledge/bases") return Promise.resolve(ok({ bases: [] }));
  if (path === "/api/skills") return Promise.resolve(ok({ skills: [] }));
  if (path === "/api/billing/status") {
    return Promise.resolve(
      ok({ plan: "team", status: "active", memberCount: 2, objectCap: null, canCreateObjects: true })
    );
  }
  return Promise.reject(new Error(`unexpected request: ${path}`));
}
