/**
 * SESSION TYPES — what a member's agent run looks like from the SERVER's side,
 * and the operator-only telemetry that rides beside it.
 *
 * ⚠ SPLIT OUT OF `types.ts` ON 2026-08-22, at the 500-line cap (that file
 * measured 586 with the telemetry wave in it). `types.ts` re-exports every name
 * here, so every existing import path is unchanged and there is no second path
 * to a symbol — the arrangement `schema.ts` / `schema-sessions.ts` already use.
 *
 * ⚠ THE ONE RULE THIS FILE IS ORGANIZED AROUND: **two audiences, two shapes.**
 * {@link ChannelSessionState} is what a PEER may see; {@link ChannelSessionStateOwn}
 * adds what only the operator may. The enforcement is
 * `server/collab-dto.ts › mapPeerSessionStateRow`, which BUILDS the narrow object
 * rather than scrubbing a wide one.
 */

// ⚠ TYPE-ONLY, and it is the DESKTOP's wire shape rather than a UI import — see
// `SessionDetailKey`, which is derived from it so the six-key vocabulary has one
// declaration across both trees.
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/**
 * ⚠ **THE RUN STATE AND THE TWO OPERATOR-ONLY HALVES ARE DECLARED IN
 * `@dopl/contracts › sessions.ts` AND RE-EXPORTED HERE** (2026-09-02, v2 slice
 * A13). All three were hand-mirrored into `packages/dopl-client`
 * (`channel-types.ts` and `session-health-types.ts`), and `ChannelSessionHealth`
 * was the worst case in the repo: FOUR declarations of one 7-field type, every
 * field `optional` AND `nullable`, so drift failed no build and no test — the
 * field just never arrived. The two TypeScript declarations are now one.
 *
 * ⚠ **`check-session-health-drift.ts` DID NOT GO AWAY.** The zod half
 * (`schema-sessions.ts › SessionStateEntrySchema`) and the migration's own
 * columns are still outside the compiler's reach, and those are still the two
 * silent failure modes. The gate now compares the contracts file against exactly
 * those two.
 *
 * ⚠ **`SessionDetailKey`, `ChannelSessionState` AND `…Own` STAY HERE ON
 * PURPOSE** — see the "WHAT IS DELIBERATELY NOT HERE" note in
 * `@dopl/contracts › sessions.ts`. `detail` is DERIVED from the desktop's own
 * bridge shape, and moving that derivation into a package the desktop cannot
 * import would trade one mirror for a worse one.
 */
import type {
  SessionPillState,
  ChannelSessionTelemetry,
  ChannelSessionHealth,
} from "@dopl/contracts";

export type { SessionPillState, ChannelSessionTelemetry, ChannelSessionHealth };

/**
 * One live (or just-ended) session, as answered by
 * `dopl_channel(op="read_sessions")`. Server-visible projection of desktop
 * `session-summary.list()` — ⚠ the SAME derivation the pills use, lifted, never
 * a second one (F-142).
 *
 * Delivery: desktop pushes ON STATE CHANGE (not heartbeat) into
 * `channel_sessions`; the read is scoped to the caller's own sessions. See
 * `session-state-service.ts`.
 */
/**
 * WHICH OF SIX SITUATIONS A LIVE SESSION IS IN — the CLOSED key vocabulary
 * `dopl-desktop-app/main/session-detail.js › detailFor` derives, and the ONLY
 * finer-than-`state` signal that crosses machines (2026-08-22).
 *
 * ⚠ **DERIVED FROM THE BRIDGE SHAPE, NEVER RESTATED.** A second literal union of
 * these six words is how the desktop ships a seventh and one tree keeps
 * rejecting it. `spa-bridge-shapes.ts › DesktopSessionSummary.detail` is the
 * authority because that is where the desktop's own wire shape is declared.
 *
 * ⚠ **A KEY, NOT A SENTENCE, AND THAT IS WHAT MAKES IT PEER-SAFE.** The whole
 * argument for letting `detail` cross to a PEER while every other refinement
 * stays operator-only is that it is one of six fixed words, each already deemed
 * safe to show a counterparty — it says what CLASS of work is happening, never
 * which tool, which model, or what it cost. **Free-form prose in this field
 * would be operator-only material leaking to peers**; see
 * `collab-dto.ts › narrowSessionDetail`, which is what stops one.
 *
 * ⚠ The COPY for each key is written on the reader's side
 * (`components/channels-v2/agents-model.ts › agentDetailLabel`), never carried
 * on the wire — a copy change must not need a desktop release.
 */
export type SessionDetailKey = NonNullable<DesktopSessionSummary["detail"]>;

export type ChannelSessionState = {
  channelId: string;
  threadId: string | null;
  /** Friendly handle (flint / onyx / …) the pills show. */
  name: string;
  state: SessionPillState;
  /**
   * WHICH OF SIX SITUATIONS this session is in — see {@link SessionDetailKey}.
   *
   * ⚠ **OPTIONAL AND NULLABLE, AND BOTH ARE LOAD-BEARING.** ABSENT means this
   * projection does not carry the field (an older server, an older desktop);
   * `null` means the machine reported no refinement. Neither means "doing
   * nothing". ⚠ It had to be OPTIONAL rather than required so that adding it was
   * genuinely ADDITIVE — every existing construction site of this type keeps
   * compiling, which is the rule `spa-bridge-shapes.ts` states for the same
   * wire.
   * ⚠ Structurally assignable to `DesktopSessionSummary["detail"]` ON PURPOSE,
   * so a peer session goes on flowing into `agents-model.ts › agentLiveness`
   * and `agentDetailLabel` with no adapter.
   * ⚠ It only ever REFINES `working`; it never contradicts the state.
   */
  detail?: SessionDetailKey | null;
  /** ⚠ Counterparty-influenced display text — neutralized before storage. */
  channelName: string | null;
  threadTitle: string | null;
  /**
   * THE OPERATOR-GIVEN AGENT NAME ("Bug Reviewer") — **PEER-VISIBLE BY DESIGN**
   * (2026-08-31, Samuel's ruling; migration 20260905120000). ⚠ OPTIONAL AND
   * NULLABLE on `detail`'s two grounds: ABSENT = an older server/desktop does
   * not carry the field; `null` = never named. Renders fall back to `#<name>`.
   */
  displayName?: string | null;
  updatedAt: string;
};

/** The caller's OWN session — coarse projection, plus the two operator-only
 *  halves: what it COSTS and whether it is GETTING ANYWHERE. */
export type ChannelSessionStateOwn = ChannelSessionState &
  ChannelSessionTelemetry &
  ChannelSessionHealth;
