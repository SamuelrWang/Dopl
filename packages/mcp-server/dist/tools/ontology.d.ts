/**
 * `dopl_ontology` — the workspace object graph as a ROUTING layer.
 * Read-only (edited in the web UI). The intended funnel: anchor (who is
 * calling) → map (which cluster) → resolve (which objects) → get (the
 * object's attributes, relationships, and action recipes, with linked
 * knowledge/skills resolved to addressable handles).
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerOntologyTool(register: RegisterTool, client: DoplClient): void;
