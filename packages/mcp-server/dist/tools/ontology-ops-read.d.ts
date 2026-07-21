/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opMap(client: DoplClient): Promise<ToolResponse>;
export declare function opAnchor(client: DoplClient): Promise<ToolResponse>;
export declare function opResolve(client: DoplClient, query: string): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, ref: string): Promise<ToolResponse>;
