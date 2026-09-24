/**
 * ⚠ LEGACY ALIAS — the retired path for desktops ≤ 1.36.0, answered by
 * `api/ontology/ontologies/route.ts`. Removal trigger: `features/ontology/legacy-aliases.ts`.
 */
import { legacyOntologyRoute } from "@/features/ontology/legacy-aliases";
import { POST as POST_CURRENT } from "../ontologies/route";

export const POST = legacyOntologyRoute(POST_CURRENT);
