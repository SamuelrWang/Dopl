import "server-only";

/**
 * Public skills service surface — single source of truth for REST handlers
 * and MCP tools. Builds `SkillContext` from auth metadata at the route
 * boundary, resolves slugs to ids, enforces per-skill `agent_write_enabled`
 * on every agent-origin mutation.
 * ⚠ DELETES ARE PERMANENT — no trash, restore or purge. `deleted_at` and the
 * read-path `deleted_at IS NULL` filters stay only to keep pre-switch
 * tombstones hidden until the cleanup migration sweeps them.
 *
 * Barrel over per-domain siblings; cross-cutting gates live in
 * `service-shared.ts`, and every history-recording mutation funnels through
 * `./history` (`recordVersion` / `recordEvent`), never a re-implementation.
 *   - `service-shared.ts`   — context, `canSeeSkill` matrix, agent-write gate
 *   - `service-reads.ts`    — reads (`getSkillBySlug` is the shared gate)
 *   - `service-writes.ts`   — create/update/delete/duplicate
 *   - `service-body.ts`     — SKILL.md read + CAS write
 *   - `service-history.ts`  — version timeline + restore
 *   - `service-insights.ts` — usage + used-by
 *   - `service-seed.ts`     — workspace fixture seeding
 */

export {
  buildSkillContext,
  assertAgentWriteAllowed,
} from "./service-shared";
export type { AuthLike } from "./service-shared";

export {
  listSkills,
  getSkillBySlug,
  listFiles,
  resolveSkillBody,
  listWorkspaceKnowledgeBases,
} from "./service-reads";

export {
  createSkill,
  updateSkill,
  deleteSkill,
  duplicateSkill,
} from "./service-writes";

export { readBody, writeBody } from "./service-body";

export {
  getSkillHistory,
  getFileVersion,
  restoreFileVersion,
} from "./service-history";

export { getSkillUsage } from "./service-insights";

export { seedWorkspace } from "./service-seed";
