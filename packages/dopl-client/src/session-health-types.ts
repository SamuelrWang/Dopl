/**
 * SESSION HEALTH — "is this agent GETTING ANYWHERE", as the seven facts that
 * ride an OWN-scoped session row beside the cost ones (2026-09-01, server
 * migration `20260909120000`).
 *
 * ⚠ **ITS OWN MODULE FOR `launch-types.ts`'s AND `escalation-types.ts`'s REASON:
 * `channel-types.ts` IS AT THE 500-LINE CAP** and cannot take another field.
 * `ChannelSessionStateOwn` intersects this in over there, so no import path
 * changes and there is still one path to every symbol.
 *
 * ⚠ **A HAND MIRROR of `src/features/channels/types-sessions.ts ›
 * ChannelSessionHealth`, WITH NO DRIFT GATE OVER IT** — the rule `home-types.ts`
 * states for its own pair, and the same one `knowledge-types.ts` and
 * `agent-template-types.ts` live under. There is no script comparing these two
 * declarations, so **both halves move in ONE change**: a field added here and not
 * there compiles on both sides and simply never arrives, which is the failure
 * mode a mirror without a gate has.
 *
 * ⚠ **NOTHING HERE MAY RESTATE A RULE.** The server file is where the shape and
 * every argument about it are STATED — what each value is derived from, why
 * `tokensDelta`'s baseline is the last POST rather than the last push, why
 * `stale` is not the other `stale`. What is written here is what a CONSUMER of
 * the SDK cannot get anywhere else: the field's meaning in one line, and the two
 * things a render must never do with it.
 *
 * ⚠ **OPERATOR-ONLY, all seven.** They ride only on own-scoped reads
 * (`listChannelSessions` → `GET /api/channels/sessions`, and the `sessions` block
 * on an await result). A PEER's session never carries them: the server's
 * channel-scoped mapper cannot emit what it never names.
 */

/**
 * The HEALTH half of {@link ChannelSessionStateOwn}.
 *
 * ⚠ **EVERY FIELD IS OPTIONAL *AND* NULLABLE, AND THE TWO SAY DIFFERENT THINGS.**
 * ABSENT = this projection does not carry the field at all — an older SERVER,
 * which is a supported peer — and `null` = the row carries it and nothing has
 * measured it. Neither is a `0` and neither is a `false`.
 *
 * ⚠ **NULL IS UNKNOWN, NEVER ZERO**, and six of the seven are counts, so the
 * rule bites harder here than it does on cost: rendering `0 denied` for a
 * machine that reported no number tells an orchestrator that nothing has been
 * refused to an agent whose every shell call may be being refused silently.
 * Render nothing for an absent field.
 */
export interface ChannelSessionHealth {
  /** Turns this session has taken. ⚠ NOT quantized on the wire — the difference
   *  between 1 turn and 4 is the signal. */
  turns?: number | null;
  /** Tokens burned since this session last **POSTED** to its channel. ⚠ Not per
   *  turn, and not since the last row push — a session that has never posted
   *  reports its whole spend. */
  tokensDelta?: number | null;
  /**
   * The MACHINE's own WEDGED flag: `working` **and** silent past ten minutes
   * **and** still spending — all three at once.
   *
   * ⚠ 🔒 **THIS IS NOT THE SAME FACT AS A QUIET `updatedAt`.** That one is about
   * the REPORT ("nobody has said anything", which includes the desktop having
   * died); this one is about the SESSION (a live process getting nowhere). A
   * render that merges them reports a live-but-quiet agent as dead, or a hung
   * one as fine. ⚠ `null` = nothing evaluated it, which is not `false`.
   */
  stale?: boolean | null;
  /** Tool calls REFUSED to this session, and the last tool that was. ⚠ `null`
   *  means nothing counted them — NEVER that nothing was denied. */
  deniedCalls?: number | null;
  lastDeniedTool?: string | null;
  /** The `seq` of the last wake the machine ENQUEUED, and when. ⚠ A report of
   *  what the machine DID — never a delivery guarantee: nothing here says the
   *  agent read it, acted on it, or is still running. */
  lastWakeSeq?: number | null;
  lastWakeAt?: string | null;
}
