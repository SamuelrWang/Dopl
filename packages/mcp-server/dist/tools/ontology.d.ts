/**
 * `dopl_ontology` + `dopl_ontology_admin` — the workspace object graph
 * as a ROUTING layer, fully agent-authorable (like dopl_kb for bases).
 * Read funnel: anchor → map → resolve → get. Write ops edit one thing
 * at a time (attribute / relationship / action upserts) so agents never
 * have to round-trip whole objects.
 *
 * This file is the thin registrar: it owns the two tool schemas + wires
 * them to the handlers in sibling modules —
 *   - `ontology-render.ts`     — shared ref resolvers + object renderer
 *   - `ontology-ops-read.ts`   — map/anchor/resolve/get
 *   - `ontology-ops-write.ts`  — the op dispatch switch + every mutating handler
 * The admin tool (cascade soft-deletes) stays inline here.
 */
import { type CallerIdentity } from "./identity";
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerOntologyTool(register: RegisterTool, client: DoplClient, 
/** The session identity record — `op="anchor"` states it before the object. */
caller?: CallerIdentity): void;
