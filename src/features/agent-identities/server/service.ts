import "server-only";

/**
 * Public agent-templates service surface — the single source of truth for REST
 * handlers and, when the launch phase lands, for whatever calls it server-side.
 * Builds `AgentTemplateContext` from auth metadata at the route boundary and
 * enforces the visibility matrix on every read.
 *
 * ⚠ DELETES ARE PERMANENT — no trash, no restore, no `deleted_at` column.
 *
 * Barrel over per-domain siblings; cross-cutting gates live in
 * `service-shared.ts`:
 *   - `service-shared.ts` — context, `canSeeTemplate`, the mirrored KB access
 *                           predicate the attach gate is built on
 *   - `service-reads.ts`  — list / get / `resolveTemplateForLaunch`
 *                           (`getTemplateById` is the WRITE gate, keyed to the
 *                           caller's tenancy; `readTemplateById` is the READ
 *                           door, where the id names its own container — A12)
 *   - `service-writes.ts` — create / update / hard delete
 *   - `service-resolve-ref.ts` — ⚠ THE ONE CROSS-FEATURE EXPORT: id-or-name
 *                           resolution for the launch-directive lane, so
 *                           `channels/` composes the visibility matrix rather
 *                           than copying it (F-278 is what a copy costs)
 */

export {
  buildAgentTemplateContext,
  canSeeTemplate,
  shareCtxForTemplates,
} from "./service-shared";
export type { AuthLike, TemplateShareCtx } from "./service-shared";

export {
  listTemplates,
  listHomeScopedTemplateIds,
  getTemplateById,
  readTemplateById,
  resolveTemplateForLaunch,
} from "./service-reads";

export {
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "./service-writes";

export { resolveTemplateRef } from "./service-resolve-ref";
export type {
  TemplateRefMatch,
  TemplateRefResolution,
} from "./service-resolve-ref";
