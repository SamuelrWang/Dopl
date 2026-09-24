/**
 * ⚠ LEGACY ALIAS — the retired path for desktops ≤ 1.36.0, answered by
 * `api/ontology/ontologies/[ontologyId]/revisions/route.ts`. Removal trigger: `features/ontology/legacy-aliases.ts`.
 */
import { legacyOntologyRoute } from "@/features/ontology/legacy-aliases";
import { GET as GET_CURRENT } from "../../../ontologies/[ontologyId]/revisions/route";

export const GET = legacyOntologyRoute(GET_CURRENT);
