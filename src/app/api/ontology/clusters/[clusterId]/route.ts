/**
 * ⚠ LEGACY ALIAS — the retired path for desktops ≤ 1.36.0, answered by
 * `api/ontology/ontologies/[ontologyId]/route.ts`. Removal trigger: `features/ontology/legacy-aliases.ts`.
 */
import { legacyOntologyRoute } from "@/features/ontology/legacy-aliases";
import { PATCH as PATCH_CURRENT, DELETE as DELETE_CURRENT } from "../../ontologies/[ontologyId]/route";

export const PATCH = legacyOntologyRoute(PATCH_CURRENT);
export const DELETE = legacyOntologyRoute(DELETE_CURRENT);
