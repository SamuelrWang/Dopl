/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type CallerIdentity } from "./identity";
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
