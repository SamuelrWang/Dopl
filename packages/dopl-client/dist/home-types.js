"use strict";
/**
 * Domain types for the HOME surface — the account-level channels a user has
 * outside any standard workspace.
 *
 * ⚠ Mirrors `src/features/home/types.ts` — hand-synced, like `knowledge-types.ts`
 * and `agent-template-types.ts`. No drift gate covers this pair; both halves
 * move in ONE change.
 *
 * 🔒 **A HOME CHANNEL IS A `kind='link'` CONTAINER WORKSPACE, AND
 * {@link HomeChannel.workspaceId} IS THE HANDLE EVERY OTHER TOOL TAKES AS
 * `workspace=`.** That is the whole reason this type is on the SDK: containers
 * are excluded from `listWorkspaces`'s listing by `isStandardWorkspace` and are
 * therefore unlistable and unaddressable without it, while `resolveWorkspaceRef`
 * deliberately resolves against the UNFILTERED directory. That asymmetry is the
 * container door.
 *
 * ⚠ THIS IS NOT A WORKSPACE LISTING AND MUST NOT BE RENDERED AS ONE. INVARIANTS
 * §4A forbids advertising a container as a workspace; these are HOME CHANNELS to
 * the operator, and the surface that shows them says so.
 */
Object.defineProperty(exports, "__esModule", { value: true });
