/**
 * `dopl_ontology` + `dopl_ontology_admin` — the workspace object graph as a
 * ROUTING layer. Read funnel: anchor → map → resolve → get. Writes edit ONE
 * thing at a time so agents never round-trip whole objects.
 *
 * Thin registrar: two tool schemas wired to
 *   - `ontology-render.ts`    — shared ref resolvers + object renderer
 *   - `ontology-ops-read.ts`  — map/anchor/resolve/get
 *   - `ontology-ops-write.ts` — op dispatch + every mutating handler
 * The admin tool (refused cascade deletes) stays inline here.
 */
import { type CallerIdentity } from "./identity";
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerOntologyTool(register: RegisterTool, client: DoplClient, 
/** The session identity record — `op="anchor"` states it before the object. */
caller?: CallerIdentity): void;
