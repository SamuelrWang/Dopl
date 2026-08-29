/**
 * shelf.ts — THE ONE PLACE the operator's noun becomes the wire's noun.
 *
 * `/home` composes TWO structurally different stores and the tool surface must
 * not blur them (spec `docs/specs/mcp-surface-v2.plan.md` §3.1):
 *
 *   - a HOME CHANNEL is a hidden `kind='link'` WORKSPACE — a TENANCY, addressed
 *     with the injected `workspace=` arg like any other workspace;
 *   - the PERSONAL SHELF is the `home_scoped = true` rows inside the caller's
 *     own DEFAULT STANDARD workspace — a `WHERE`, not a tenancy.
 *
 * They are ORTHOGONAL axes and each gets its own argument. Folding them into one
 * `scope` enum is the trap: "personal" would mean a workspace in one op and a
 * filter in another.
 *
 * ⚠ THE TOOL SAYS `personal`, THE WIRE SAYS `home` (Samuel's ruling Q1,
 * 2026-08-28). The operator-facing noun has been **Personal** since 2026-08-27
 * (INVARIANTS §5A) and an agent's vocabulary should be the operator's. The
 * mapping lives HERE and NOWHERE ELSE — a second mapping is how the two drift,
 * and the drift is silent because a misspelled shelf answers the WIDER list.
 *
 * ⚠ AN UNRECOGNISED VALUE NEVER REACHES THE WIRE. The tool arg is a zod enum, so
 * `-32602` names the field and the two legal values before any round trip —
 * the local twin of `api/knowledge/bases/route.ts › readShelf`'s 400, whose
 * whole argument is that silently dropping `?shelf=hom` would answer the WIDER
 * list and look like it worked.
 */

import type { KbShelf, TemplateShelf } from "@dopl/client";

/** The two values the tool arg accepts. ⚠ Operator vocabulary, not wire. */
export const SHELF_VALUES = ["personal", "workspace"] as const;
export type ShelfArg = (typeof SHELF_VALUES)[number];

/**
 * Operator noun → wire noun. `KbShelf` and `TemplateShelf` are the same two
 * strings declared in two features (each mirrors the other by hand, on purpose),
 * so one mapper serves both.
 */
export function toWireShelf(shelf: ShelfArg): KbShelf & TemplateShelf {
  return shelf === "personal" ? "home" : "workspace";
}

/** `toWireShelf`, tolerating the absent case — undefined means NO FILTER. */
export function toWireShelfOrUndefined(
  shelf: ShelfArg | undefined,
): (KbShelf & TemplateShelf) | undefined {
  return shelf === undefined ? undefined : toWireShelf(shelf);
}

/**
 * ⚠ THE ABSENT-ARGUMENT RULE IS ASYMMETRIC BETWEEN READS AND WRITES, AND THE
 * ASYMMETRY IS DELIBERATE — stated here once and quoted into both tools'
 * descriptions, because an agent that reads "absent = both" off a list op and
 * carries it to a create op has invented a rule the server does not hold.
 *
 *   READ  (`list_bases`, `dopl_agent` op="list") — absent = BOTH shelves. F-342
 *         rules the unfiltered MCP read RIGHT: an operator's agent asking "what
 *         is here" should see the operator's whole workspace.
 *   WRITE (`create_base`, `dopl_agent` op="create") — absent = the WORKSPACE
 *         shelf. `resolveHomeScope`'s "THE DEFAULT IS FALSE AND SILENT": absent
 *         picks the NARROWER, already-live default and never widens.
 */
export const SHELF_ABSENT_RULE =
  `\`shelf\` absent means BOTH shelves on a READ and the WORKSPACE shelf on a WRITE — the two directions differ on purpose, so do not carry the read rule to a create.`;

/**
 * The shelf arg's schema description, worded once. ⚠ Names the tenancy/shelf
 * split, because the single most likely mistake is reaching for
 * `shelf="personal"` when the caller meant `workspace=<home channel container>`.
 */
export const SHELF_ARG_DESCRIPTION =
  `Which SHELF to target: "personal" = your own /home shelf (the private rows inside your DEFAULT workspace), "workspace" = the workspace's shared shelf. ${SHELF_ABSENT_RULE} This is NOT how you reach a home CHANNEL — a home channel is a workspace, addressed with \`workspace=<container id>\`.`;

/**
 * 🔒 THE HOME-SHELF FENCE, SURFACED. Both features answer 403 with their own
 * code — `HOME_SCOPE_FORBIDDEN` (knowledge) / `TEMPLATE_HOME_SCOPE_FORBIDDEN`
 * (templates) — and both REFUSE rather than downgrading, because quietly
 * creating on the other shelf produces a row the surface that created it cannot
 * find, with no error anywhere.
 *
 * Returns the tool error, or null so the caller rethrows. ⚠ Duck-typed on
 * `.status`/`.code` across the @dopl/client boundary, the same discipline
 * `knowledge-shared.ts › agentWriteDenied` follows.
 *
 * ⚠ THE SERVER'S OWN SENTENCE IS SURFACED VERBATIM when it has one: its
 * `reason` names a property of the REQUEST (not private / not your home
 * workspace / shared credential) and never a workspace the caller may not know
 * about, so it is safe to pass through and it is the only text that knows WHICH
 * of the three conditions failed.
 */
export function homeShelfForbidden(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  if ((e as { status?: number }).status !== 403) return null;
  const code = (e as { code?: unknown }).code;
  if (
    code !== "HOME_SCOPE_FORBIDDEN" &&
    code !== "TEMPLATE_HOME_SCOPE_FORBIDDEN"
  ) {
    return null;
  }
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  const detail =
    typeof msg === "string" && msg
      ? msg
      : "This cannot be created on your personal shelf.";
  return `${detail} Nothing was created. The personal shelf needs THREE things at once: a credential that stands for a PERSON (a shared or service credential has no personal shelf), a PRIVATE row, and your OWN default workspace as the target — so \`workspace=\` naming a home-channel container or a second workspace you own is refused here by design. Create it on the workspace shelf instead (omit \`shelf\`), or retry without \`workspace=\`.`;
}
