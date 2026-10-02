import "server-only";

/**
 * Public agent-identities service surface. `resolveIdentityRef` is the one export another feature's
 * service composes (the launch-directive lane), so the visibility matrix is never copied (F-278).
 */

export { buildAgentIdentityContext } from "./service-shared";

export {
  listIdentities,
  listHomeScopedIdentityIds,
  getIdentityById,
  readIdentityById,
  resolveIdentityForLaunch,
} from "./service-reads";

export {
  createIdentity,
  updateIdentity,
  deleteIdentity,
} from "./service-writes";

export { resolveIdentityRef } from "./service-resolve-ref";
export type { IdentityRefMatch } from "./service-resolve-ref";
