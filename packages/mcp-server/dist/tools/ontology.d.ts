/**
 * `dopl_ontology` + `dopl_ontology_admin` — the workspace object graph
 * as a ROUTING layer, fully agent-authorable (like dopl_kb for bases).
 * Read funnel: anchor → map → resolve → get. Write ops edit one thing
 * at a time (attribute / relationship / action upserts) so agents never
 * have to round-trip whole objects.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerOntologyTool(register: RegisterTool, client: DoplClient): void;
