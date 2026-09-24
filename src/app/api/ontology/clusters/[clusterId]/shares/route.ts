/**
 * ⚠ LEGACY ALIAS — the retired path for desktops ≤ 1.36.0, answered by
 * `api/ontology/ontologies/[ontologyId]/shares/route.ts`. Removal trigger: `features/ontology/legacy-aliases.ts`.
 */
import { legacyOntologyRoute } from "@/features/ontology/legacy-aliases";
import { GET as GET_CURRENT, PUT as PUT_CURRENT, DELETE as DELETE_CURRENT } from "../../../ontologies/[ontologyId]/shares/route";

export const GET = legacyOntologyRoute(GET_CURRENT);
export const PUT = legacyOntologyRoute(PUT_CURRENT);
export const DELETE = legacyOntologyRoute(DELETE_CURRENT);
