import "server-only";

/**
 * Public skills service surface — single source of truth for REST handlers
 * and MCP tools. Builds `SkillContext` from auth metadata at the route
 * boundary, resolves slugs to ids, enforces per-skill `agent_write_enabled`
 * on every agent-origin mutation.
 * ⚠ DELETES ARE PERMANENT — no trash, restore or purge. ⚠ **THE CLEANUP
 * MIGRATION THIS BLOCK WAITED ON HAS RUN**
 * (`20260807110000_purge_soft_deleted_rows.sql`; `SELECT count(*) FROM skills
 * WHERE deleted_at IS NOT NULL` read 0 on 2026-09-18 — a measurement, so
 * re-derive it). `20261013120000_drop_knowledge_soft_delete.sql` also drops
 * this table's `skill_soft_delete_cascade_attachments` trigger, whose function
 * still wrote `workflow_skills` — a table gone since 2026-08-11. The
 * `deleted_at` column and the read-path `deleted_at IS NULL` filters survive as
 * INERT relics (nothing writes the column); **F-730 carries their removal**,
 * which is not mechanical while `skills_workspace_slug_active_idx` is a PARTIAL
 * UNIQUE on the predicate.
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
