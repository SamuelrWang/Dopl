/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type ResponseFormat } from "./response-size";
import { type CallerIdentity } from "./identity";
/**
 * ⚠ SUMMARY PROJECTION, NOT THE GRAPH, for the two name-only ops. Between them
 * `opMap` and `opResolve` read five fields, all carried by `view: "summary"`; a
 * bare `getOntology()` fetches every `attributes`, `methods`, `template` and
 * cluster `layout` in the workspace to supply them — on `op="map"`, the ROUTING
 * call agents make first and speculatively.
 *
 * ⚠ `opGet` and `opAnchor` stay on the FULL graph: both render through
 * `renderObject`, which reads JSONB off the target AND scans every object's
 * `relationships` for the inbound "Referenced by" list.
 */
/**
 * ⚠ **WHAT `concise` DROPS HERE, AND WHAT IT MAY NEVER DROP** (A16). It removes
 * the LEGENDS — the scope note, the "drill in with…" pointer, the Version line
 * and its parenthetical — and nothing else. It never removes an object, an
 * attribute, a count, or a `clippedNote`: a truncation notice is a statement
 * about the READ's completeness, and hiding it to save characters is the one
 * saving that could make a prefix read as a whole.
 */
export declare function opMap(client: DoplClient, format?: ResponseFormat): Promise<ToolResponse>;
/**
 * ⚠ THE STRONGEST IDENTITY CLAIM IN THE PRODUCT — the server instructions send
 * every agent here for any "my/me" request. The anchor is CONTEXT, NOT
 * identification: any agent on this connection can re-point it with
 * `op="claim_anchor"`, and the object NAME is member-typed. So state the
 * caller's immutable id FIRST, from the same session record `whoami` and the
 * footer use, and never let a name stand as identity.
 */
export declare function opAnchor(client: DoplClient, caller?: CallerIdentity, format?: ResponseFormat): Promise<ToolResponse>;
export declare function opResolve(client: DoplClient, query: string, format?: ResponseFormat): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, ref: string, format?: ResponseFormat): Promise<ToolResponse>;
