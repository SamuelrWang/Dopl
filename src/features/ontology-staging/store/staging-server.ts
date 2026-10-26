/**
 * THE STAGING ONTOLOGY SERVER: an in-memory stand-in for every route the /home Ontology face
 * calls, served through the SPA bridge's `apiRequest` seam (`shared/lib/spa-bridge.ts`), so the
 * PRODUCT components and hooks run unchanged over fake data. Nothing persists; a new server per
 * scenario starts from `data/demo-ontology-data.ts`. The bridge has no sync pair, so realtime is
 * off (`shared-channel-registry.ts`).
 */

import { graphReducer, type GraphAction, type GraphState } from "@/features/ontology/graph-state";
import { attributeFromField } from "@/features/ontology/field-kinds";
import type { Ontology, OntologyObject, OntologyShare } from "@/features/ontology/types";
import type { Revision } from "@/features/revisions/types";
import type { SpaBridgeSurface } from "@/shared/lib/spa-bridge";
import {
  DEMO_KNOWLEDGE_BASES,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_SHARES,
  demoSnapshot,
} from "../data/demo-ontology-data";
import { demoRevisions, type StagedRevision } from "../data/demo-revisions";
import { diffGraphs } from "./revision-diff-recorder";

export type StagingScenario =
  | "board"
  | "empty"
  | "not-onboarded"
  | "pane-loading"
  | "list-error"
  | "board-loading"
  | "cap-near"
  | "cap-over";

type BridgeResponse = Awaited<ReturnType<SpaBridgeSurface["apiRequest"]>>;
type Body = Record<string, unknown>;

const LATENCY_MS = 250;
const OBJECT_CAP = 1000;
const wait = () => new Promise((r) => setTimeout(r, LATENCY_MS));
const never = () => new Promise<never>(() => {});

const ok = (body: unknown): BridgeResponse => ({ status: 200, statusText: "OK", hasBody: true, body });
const noContent = (): BridgeResponse => ({ status: 204, statusText: "No Content", hasBody: false });
const fail = (status: number, code: string, message: string): BridgeResponse => ({
  status,
  statusText: "",
  hasBody: true,
  body: { error: { code, message } },
});

let mint = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(mint += 1)}`;

function sharingPatch(graph: GraphState, id: string, patch: Partial<Ontology>): GraphState {
  return {
    ...graph,
    ontologies: graph.ontologies.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  };
}

export function createStagingServer(scenario: StagingScenario): Pick<SpaBridgeSurface, "apiRequest"> {
  let graph: GraphState = graphReducer(
    { ontologies: [], objects: {} },
    { type: "SNAPSHOT_SET", snapshot: scenario === "empty" ? { ontologies: [], objects: {} } : demoSnapshot() }
  );
  const shares: Record<string, OntologyShare[]> = scenario === "empty" ? {} : { ...DEMO_SHARES };
  const revisions: StagedRevision[] = scenario === "empty" ? [] : demoRevisions();

  /** Every write lands here, and files the changelog rows the real server would. */
  const commit = (next: GraphState, restored: ReadonlySet<string> = new Set()) => {
    revisions.push(...diffGraphs(graph, next, restored));
    graph = next;
  };
  const write = (action: GraphAction) => commit(graphReducer(graph, action));
  const objectOf = (id: string) => graph.objects[id];
  const setShareCount = (ontologyId: string) =>
    commit(sharingPatch(graph, ontologyId, { sharedChannelCount: shares[ontologyId]?.length ?? 0 }));

  const revisionPage = (match: (r: StagedRevision) => boolean) =>
    ok({
      revisions: revisions
        .filter(match)
        .map((r) => r.revision)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      nextCursor: null,
    });

  function restore(objectId: string, revision: Revision): OntologyObject | undefined {
    const object = objectOf(objectId);
    const { field, before } = revision.payload;
    if (!object || field === undefined) return object;
    const marks = new Set([`${objectId}|${field}`]);
    if (field.startsWith("attribute:")) {
      const key = field.slice("attribute:".length);
      const attributes = object.attributes.map((a) =>
        a.key === key ? { ...a, value: before as typeof a.value } : a
      );
      commit(graphReducer(graph, { type: "OBJECT_UPDATE", id: objectId, patch: { attributes } }), marks);
    } else {
      const patch = { [field]: before } as Partial<OntologyObject>;
      commit(graphReducer(graph, { type: "OBJECT_UPDATE", id: objectId, patch }), marks);
    }
    return objectOf(objectId);
  }

  const billing = () => {
    const capped = scenario === "cap-near" || scenario === "cap-over";
    return ok({
      plan: "free",
      status: "free",
      containerKind: "home",
      memberCount: 1,
      seatCount: null,
      objectCap: capped ? OBJECT_CAP : null,
      objectsUsed: scenario === "cap-over" ? OBJECT_CAP : scenario === "cap-near" ? 940 : 112,
      canCreateObjects: scenario !== "cap-over",
      chatsWindowDays: 90,
      cancelAtPeriodEnd: false,
      subscription_period_end: null,
      has_stripe_customer: false,
    });
  };

  function route(method: string, url: URL, body: Body): BridgeResponse | Promise<BridgeResponse> {
    // `/api/<area>/<kind>/<id>/<sub>/<revision>/…`: the two ids become placeholders in the key.
    const parts = url.pathname.split("/").filter(Boolean).slice(1);
    const id = parts[2];
    const revisionId = parts[4];
    const shape = parts.map((p, i) => (i === 2 ? ":id" : i === 4 ? ":rev" : p)).join("/");

    switch (`${method} ${shape}`) {
      case "GET ontology":
        if (scenario === "pane-loading") return never();
        if (scenario === "list-error") return fail(500, "INTERNAL_ERROR", "Ontology failed to load.");
        return ok({ ontologies: graph.ontologies, objects: graph.objects });
      case "POST ontology/ontologies": {
        const ontology: Ontology = {
          id: newId("ont"),
          slug: newId("ont"),
          name: String(body.name ?? ""),
          purpose: String(body.purpose ?? ""),
          columnIds: [],
          layout: {},
          agentsMayEdit: true,
          sharedChannelCount: 0,
        };
        write({ type: "ONTOLOGY_ADD", ontology });
        return ok({ ontology });
      }
      case "PATCH ontology/ontologies/:id": {
        const { name, purpose, agentsMayEdit } = body as Partial<Ontology>;
        if (name !== undefined || purpose !== undefined) {
          write({ type: "ONTOLOGY_UPDATE", id, patch: { name, purpose } });
        }
        if (agentsMayEdit !== undefined) commit(sharingPatch(graph, id, { agentsMayEdit }));
        return ok({ ontology: graph.ontologies.find((o) => o.id === id) });
      }
      case "DELETE ontology/ontologies/:id":
        write({ type: "ONTOLOGY_DELETE", id });
        delete shares[id];
        return noContent();
      case "GET ontology/ontologies/:id/shares":
        return ok({ shares: shares[id] ?? [], canManage: true });
      case "PUT ontology/ontologies/:id/shares": {
        const share = body as unknown as OntologyShare;
        shares[id] = [...(shares[id] ?? []).filter((s) => s.channelId !== share.channelId), share];
        setShareCount(id);
        return noContent();
      }
      case "DELETE ontology/ontologies/:id/shares":
        shares[id] = (shares[id] ?? []).filter((s) => s.channelId !== url.searchParams.get("channelId"));
        setShareCount(id);
        return noContent();
      case "GET ontology/ontologies/:id/revisions":
        return revisionPage((r) => r.ontologyId === id);
      case "POST ontology/objects": {
        const parent = body.parentObjectId ? objectOf(String(body.parentObjectId)) : undefined;
        const object: OntologyObject = {
          id: newId("obj"),
          name: String(body.name ?? ""),
          subtitle: "",
          attributes: (parent?.template ?? []).map(attributeFromField),
          relationships: (parent?.relationships ?? []).map((r) => ({ ...r, targetIds: [...r.targetIds] })),
          methods: (parent?.methods ?? []).map((m) => ({ ...m })),
          childIds: [],
          template: [],
        };
        write({
          type: "OBJECT_ADD",
          object,
          ontologyId: body.ontologyId ? String(body.ontologyId) : undefined,
          parentObjectId: parent?.id,
        });
        return ok({ object });
      }
      case "PATCH ontology/objects/:id":
        write({ type: "OBJECT_UPDATE", id, patch: body as Partial<OntologyObject> });
        return ok({ object: objectOf(id) });
      case "DELETE ontology/objects/:id":
        write({ type: "OBJECT_DELETE", id });
        return noContent();
      case "GET ontology/objects/:id/revisions":
        return revisionPage((r) => r.revision.resourceId === id);
      case "POST ontology/objects/:id/revisions/:rev/restore": {
        const row = revisions.find((r) => r.revision.id === revisionId);
        return row ? ok({ object: restore(id, row.revision) }) : fail(404, "NOT_FOUND", "No such revision.");
      }
      case "GET knowledge/bases":
        return ok({ bases: DEMO_KNOWLEDGE_BASES });
      case "GET knowledge/bases/:id/entries":
        return ok({ entries: DEMO_KNOWLEDGE_ENTRIES[id] ?? [] });
      case "GET knowledge/entries": {
        const ids = new Set((url.searchParams.get("ids") ?? "").split(","));
        return ok({
          entries: DEMO_KNOWLEDGE_BASES.flatMap((base) =>
            (DEMO_KNOWLEDGE_ENTRIES[base.id] ?? [])
              .filter((e) => ids.has(e.id))
              .map((e) => ({ ...e, baseId: base.id, baseName: base.name }))
          ),
        });
      }
      case "GET skills":
        return ok({ skills: [] });
      case "GET billing/status":
        return billing();
    }
    return fail(404, "NOT_FOUND", `Staging has no route for ${method} ${url.pathname}.`);
  }

  return {
    async apiRequest(path, opts) {
      await wait();
      return route(opts.method ?? "GET", new URL(path, "http://staging.local"), (opts.body ?? {}) as Body);
    },
  };
}
