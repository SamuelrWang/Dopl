import { z } from "zod";

/**
 * THE RETIRED PARAMETERS, KEPT ALIVE AS REFUSALS — and the only module in this
 * feature with a delete-me clock on it.
 *
 * ⚠ §1 SPLIT (2026-08-25). `schema.ts` stood at 498 lines with two of headroom
 * and the info-card field needed three. INVARIANTS §1 is explicit that an edit
 * to a file at the cap is a SPLIT, not a comment deletion — and this is the
 * seam, because it is the one block in that file whose whole purpose is to
 * STOP existing: every symbol here is scheduled for deletion once no build in
 * the field still sends the parameter it names. `schema.ts` is the live
 * contract; this is the graveyard with the lights left on, and mixing the two
 * is how a delete-me note survives its own deadline.
 *
 * Provenance: `docs/CHANNELS-ROLLBACK-PLAN.md` §1.
 */

/**
 * Removed multiplayer params (`docs/CHANNELS-ROLLBACK-PLAN.md` §1).
 *
 * ⚠ `z.never()`, not deletion: zod STRIPS unknown keys, so a plain delete makes
 * an old client's `to_agent` post succeed and address nobody — the invisible
 * delivery failure the addressing contract exists to prevent. Present → 400
 * naming the replacement; absent → field never appears.
 *
 * Delete once no build in the field still sends them.
 */
export function removedParam(message: string) {
  return z.never({ error: message }).optional();
}

/**
 * ⚠ **TWO CONSTANTS LEFT HERE ON 2026-09-02 (v2 A7), AND THE CLOCK ABOVE IS WHY
 * — this is the file working.** `REMOVED_TO_AGENT` (`toAgent` / `toAgents`) and
 * `REMOVED_AUTHOR_AGENT` (`authorAgentId`) were the named-agent refusals from
 * the rollback (F-141); they were held open only until no build in the field
 * still sent the parameter, and that is the condition this module's docblock
 * declares. The MCP lane never depended on them — it registers through
 * `z.strictObject`, so `to_agent` is refused BY NAME there regardless — and the
 * `to_agent_id` / `to_agent_ids` / `author_agent_id` METADATA strip is a
 * different fence entirely and stays (INVARIANTS §5, F-434).
 */
export const REMOVED_PARTICIPANTS =
  "Breakout-room participants were removed. A thread is between its creator and the member in `toUserId`.";
export const REMOVED_THREAD_CLOSE =
  "Threads no longer close; pause or end the agent instead.";

/**
 * {@link removedParam}, at the OP level: a retired arm of a discriminated union
 * that parses far enough to say what replaced it, then always fails.
 *
 * ⚠ **DELETING THE ARM IS NOT THE SAME THING.** `z.discriminatedUnion` answers
 * an unrecognized discriminator with `invalid_union` / "No matching
 * discriminator", message **"Invalid input"** — so an installed desktop asking
 * to close a thread was told its body was malformed, with no hint that the
 * CONCEPT is gone. The refusal is a `custom` issue at the ROOT path, which
 * `shared/api/parse-json.ts` promotes into `error.message` for a form route and
 * carries in `details` for everyone else. Delete the arm outright once no build
 * in the field still sends the op.
 */
export function removedOp(op: string, message: string) {
  return z.object({ op: z.literal(op) }).refine(() => false, { error: message });
}
