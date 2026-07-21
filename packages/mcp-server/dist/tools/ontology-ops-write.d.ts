/**
 * `dopl_ontology` op dispatch + mutating handlers. `dispatch` is the whole
 * tool's switch: it validates required params, routes the read ops to
 * ontology-ops-read.ts, and handles every write inline (cluster/column/
 * object creation, attribute/relationship/action/template upserts,
 * claim_anchor). The value resolvers (refs → ids, knowledge/skill refs →
 * ids, entry refs) and the optimistic-concurrency `withObject` wrapper live
 * here too. The registrar (ontology.ts) wires this to the tool.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export interface OntologyArgs {
    op: string;
    query?: string;
    object?: string;
    cluster?: string;
    parent?: string;
    name?: string;
    purpose?: string;
    subtitle?: string;
    label?: string;
    kind?: "text" | "pill" | "ref" | "knowledge" | "skill";
    value?: string;
    values?: string[];
    targets?: string[];
    description?: string;
    outcome?: string;
    tools?: string;
    expected_version?: string;
}
export declare function dispatch(client: DoplClient, args: OntologyArgs): Promise<ToolResponse>;
