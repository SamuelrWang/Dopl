/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type CallerIdentity } from "./identity";
/**
 * THE SUMMARY PROJECTION, NOT THE GRAPH (P0-3), for the two ops above that
 * render nothing but names.
 *
 * `opMap` walks clusters → `columnIds` → one level of `childIds` and prints
 * names; `opResolve` filters on `name`/`subtitle` and prints names and ids.
 * Between them they read five fields, all of which `view: "summary"` carries —
 * and the bare `getOntology()` they used to call fetched every `attributes`,
 * `methods`, `template` and cluster `layout` in the workspace to supply them.
 * `op="map"` is the ROUTING call the tool description tells agents to make
 * first, so it is the ontology read most likely to be made speculatively.
 *
 * `opGet` and `opAnchor` deliberately stay on the full graph: both render
 * through `renderObject`, which reads the JSONB off the target AND scans every
 * object's `relationships` for the inbound "Referenced by" list.
 */
export declare function opMap(client: DoplClient): Promise<ToolResponse>;
/**
 * THE STRONGEST IDENTITY CLAIM IN THE PRODUCT, PREVIOUSLY WITH THE WEAKEST
 * BACKING. The server instructions tell every agent to call this for any
 * "my/me" request, and it answered `You are anchored to this object.` over an
 * object whose NAME is member-typed text — no user id, no framing, nothing the
 * reader could check. An agent that read a name here and reported it as its own
 * identity was doing exactly what the surface invited.
 *
 * The anchor is CONTEXT, not identification: `op="claim_anchor"` lets any agent
 * on this connection re-point it, so it can only ever say "this is the object
 * the graph currently links to you". The caller's real identity — the immutable
 * id — is stated first, from the same session record `whoami` and the footer
 * use, so the two can never disagree.
 */
export declare function opAnchor(client: DoplClient, caller?: CallerIdentity): Promise<ToolResponse>;
export declare function opResolve(client: DoplClient, query: string): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, ref: string): Promise<ToolResponse>;
