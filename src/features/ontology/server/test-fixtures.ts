import type { OntologyContext } from "../types";

/**
 * Shared fixtures for the ontology server suites.
 *
 * ⚠ **A FRESH CONTEXT OBJECT PER CALL, AND THAT IS WHY THIS IS A FACTORY OF
 * FACTORIES.** The audience ceiling is memoised against the context's IDENTITY
 * (`./service-audience.ts › AUDIENCE_CACHE`), so a literal shared between cases
 * carries one case's resolution into the next.
 */
export function ontologyContextFactory(
  defaults: Partial<OntologyContext> = {}
): (over?: Partial<OntologyContext>) => OntologyContext {
  return (over: Partial<OntologyContext> = {}) => ({
    workspaceId: "ws-1",
    userId: "user-1",
    role: "member",
    source: "user",
    credentialSubjectUserId: "user-1",
    ...defaults,
    ...over,
  });
}
