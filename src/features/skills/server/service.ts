import "server-only";

/**
 * Service layer for the skills feature — the public surface.
 *
 * Single source of truth for both REST handlers and MCP tools. Builds a
 * `SkillContext` from auth metadata at the route boundary, resolves
 * slugs to ids, and enforces the per-skill `agent_write_enabled`
 * toggle on every agent-origin mutation.
 *
 * This module is a barrel: the implementation lives in per-domain
 * siblings so each file has one clear purpose. Cross-cutting gates and
 * helpers used by more than one domain live in `service-shared.ts`.
 * Every history-recording mutation funnels through the single
 * `./history` choke-point (`recordVersion` / `recordEvent`) — it is
 * imported, never re-implemented, by the domain modules.
 *   - `service-shared.ts`   — context, `canSeeSkill` matrix, agent-write gate
 *   - `service-reads.ts`    — reads (`getSkillBySlug` is the shared gate)
 *   - `service-writes.ts`   — create/update/delete/duplicate
 *   - `service-body.ts`     — SKILL.md read + CAS write
 *   - `service-trash.ts`    — visibility-filtered trash + restore + purge
 *   - `service-history.ts`  — version timeline + version restore
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
  listTrash,
  listTrashedSkills,
  restoreSkill,
  purgeSkill,
} from "./service-trash";
export type { TrashedSkillItem } from "./service-trash";

export {
  getSkillHistory,
  getFileVersion,
  restoreFileVersion,
} from "./service-history";

export { getSkillUsage, getSkillUsedBy } from "./service-insights";

export { seedWorkspace } from "./service-seed";
