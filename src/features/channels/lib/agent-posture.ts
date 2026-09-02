import { LAUNCH_TOOL_MODES } from "../schema-launch";
import type { ChannelAgentPosture } from "../types";
import type { LaunchMessageMode, LaunchToolMode } from "../types-launch";

/**
 * **"A LAUNCH MAY ASK, AND IT MAY NEVER WIDEN" — SAID ON THE SERVER** (2026-09-02,
 * A9; guardrails G6 and G7).
 *
 * ⚠ **IT IS A SECOND COPY OF `dopl-desktop-app/main/launch-posture.js`'s RULE,
 * AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT.** The two trees cannot import
 * each other and ship on different cadences, so the choice is a second copy or no
 * server-side clamp at all — and no clamp is what G6 records: the ceiling was an
 * `electron-store` record no server could read, so an offline or older desktop
 * enforced nothing. A hand-copied rule is a drift bomb, which is why
 * `agent-posture-parity.test.ts` drives THIS module and the desktop's PURE block
 * over one table, the way `agent-handle-parity.test.ts` does for handles.
 *
 * ⚠ **THE DESKTOP'S CLAMP IS NOT REPLACED BY THIS AND MUST NOT BE.** Two fences
 * on one rule, and the machine's is the finer one: it also holds the windowless
 * message floor and the operator's own stored pair. This narrows a REQUEST before
 * it is stored; that narrows what actually RUNS.
 */

/**
 * ⚠ **A CHANNEL WITH NO CEILING RECORDED, AND `null` ON AN AXIS IS NOT
 * "UNRESTRICTED"** — it is "this server has no opinion, ask the machine". Frozen
 * and shared for the reason INVARIANTS §8 gives: `Channel` is an
 * IndexedDB-persisted payload, so the first paint after an upgrade renders rows
 * minted before this field existed, and **every reader of it spells
 * `?? EMPTY_AGENT_POSTURE` INLINE at the read**.
 */
export const EMPTY_AGENT_POSTURE: ChannelAgentPosture = Object.freeze({
  tools: null,
  messages: null,
  chain: null,
});

/**
 * NARROW ONE AXIS TO A CEILING. The requested value when it is no wider, the
 * CEILING when it is wider, and the request untouched when there is no ceiling.
 *
 * ⚠ **THE COMPARISON IS AN INDEX INTO A NARROWEST-FIRST ARRAY**, which is this
 * tree's one way of ordering a posture enum (`schema-launch.ts ›
 * LAUNCH_TOOL_MODES` / `LAUNCH_MESSAGE_MODES`, and the desktop's `TOOL_MODES` /
 * `MESSAGE_MODES` ordered to match). **Re-ordering either array silently inverts
 * this function.**
 *
 * ⚠ **AN UNRECOGNISED VALUE ON EITHER SIDE RESOLVES TO THE CEILING, AND THE
 * REQUEST SIDE NEEDS ITS OWN TEST TO DO SO** — the desktop's `narrowTo` carries
 * the same note. An unknown request indexes to -1 and `-1 > n` is FALSE, so a
 * bare index comparison would PASS IT THROUGH unexamined, which is the wrong
 * direction on the one axis that must never fail open. Membership is asked FIRST.
 * ⚠ It is unreachable from a real request (zod holds both axes to their closed
 * enums), which is exactly why it needs a test rather than a comment.
 */
function narrowTo<T extends string>(
  requested: T | null | undefined,
  ceiling: T | null | undefined,
  order: readonly T[]
): T | null {
  // ⚠ **AN AXIS NOBODY ASKED FOR RESOLVES TO THE CEILING** (2026-09-02, review
  // D4), and this is PARITY rather than a new opinion: the desktop's
  // `resolvePosture` spells it `narrowTo(...) || max.tools`, so the machine has
  // always substituted its ceiling for an unasked axis. The server answering
  // `null` here made `resolved_*` say "the server permitted nothing in
  // particular" about a launch it had a recorded ceiling for — which is what made
  // G6's "the applied value is non-null" false, and what left an orchestrator
  // unable to tell "no ceiling exists" from "no request was made".
  // ⚠ IT CAN ONLY EVER NARROW. The machine's own clamp still runs afterwards, so
  // the launch lands at min(channel ceiling, operator's own posture).
  if (!ceiling) return requested ?? null;
  if (!requested) return ceiling;
  if (order.indexOf(requested) === -1) return ceiling;
  return order.indexOf(requested) > order.indexOf(ceiling) ? ceiling : requested;
}

/**
 * THE PAIR A LAUNCH REQUEST RESOLVES TO, plus whether anything was clamped.
 *
 * ⚠ **IT CLAMPS, IT DOES NOT REFUSE**, which is the desktop's own rule for the
 * same pair and right for the same reason: refusing would apply nothing when part
 * of what was asked for was legal, and would leave the caller with a launch it
 * did not get. `clamped` is what lets the result SAY SO rather than move
 * silently.
 * ⚠ **`null` OUT MEANS "THIS SERVER HAS NO CEILING TO STATE", AND NOTHING ELSE**
 * (2026-09-02, review D4). It used to also mean "did not ask", so the two were
 * indistinguishable on the stored row and G6's claim that `resolved_*` is
 * non-null was false. An axis nobody asked for now resolves to the CEILING where
 * one is recorded — which is what the machine's own `resolvePosture` has always
 * done with its pair, so this is parity, and it only ever narrows. `null`
 * survives only where the channel records no ceiling at all (F-449: today, every
 * channel), and there the machine's stored pair is still the only answer,
 * pre-T24 behaviour byte for byte.
 */
/**
 * NARROW THE MESSAGE AXIS — ⚠ **NOT WITH {@link narrowTo}, BECAUSE THIS AXIS IS
 * NOT A LINE** (2026-09-02).
 *
 * `LAUNCH_MESSAGE_MODES` is ordered `ask, auto_inbound, auto_outbound,
 * auto_both`, and an index comparison reads that as a ladder — but
 * `auto_inbound` and `auto_outbound` are two INDEPENDENT capabilities, neither
 * wider than the other. Clamping by index therefore WIDENED: `auto_outbound`
 * against an `auto_inbound` ceiling came back `auto_inbound`, granting the
 * inbound automation nobody asked for; and `auto_inbound` against an
 * `auto_outbound` ceiling passed straight through, granting inbound against a
 * ceiling that never allowed it. Two of sixteen pairs, both in the one direction
 * a clamp may never move.
 *
 * ⚠ **IT IS AN INTERSECTION OF CAPABILITY BITS, WHICH IS WHAT A CEILING MEANS.**
 * Bit 1 inbound, bit 2 outbound; the answer is what BOTH permit. The empty
 * intersection is `ask` — the narrowest real mode, not an absence.
 *
 * ⚠ **THE TOOL AXIS IS STILL A LINE** (manual ⊂ accept_edits ⊂ auto ⊂ bypass)
 * and still uses {@link narrowTo}. Do not unify the two.
 *
 * ⚠ `Object.hasOwn` FIRST — the keys are wire values, and a bare index walks
 * `Object.prototype`.
 */
const MESSAGE_BITS: Readonly<Record<LaunchMessageMode, number>> = Object.freeze({
  ask: 0,
  auto_inbound: 1,
  auto_outbound: 2,
  auto_both: 3,
});
const MESSAGE_BY_BITS: readonly LaunchMessageMode[] = [
  "ask",
  "auto_inbound",
  "auto_outbound",
  "auto_both",
];

function messageBits(mode: string | null | undefined): number {
  return mode !== null && mode !== undefined && Object.hasOwn(MESSAGE_BITS, mode)
    ? MESSAGE_BITS[mode as LaunchMessageMode]
    : -1;
}

export function narrowMessageMode(
  requested: LaunchMessageMode | null | undefined,
  ceiling: LaunchMessageMode | null | undefined
): LaunchMessageMode | null {
  // ⚠ The same two absences `narrowTo` answers, answered identically: no ceiling
  // is no clamp, and no request takes the ceiling (review D4).
  if (!ceiling) return requested ?? null;
  if (!requested) return ceiling;
  const r = messageBits(requested);
  const c = messageBits(ceiling);
  // ⚠ An unrecognised value on EITHER side resolves to the CEILING — the same
  // fail-closed direction `narrowTo` documents, unreachable from a real request
  // (zod holds the axis to its closed enum) and tested for that reason.
  if (r === -1 || c === -1) return ceiling;
  return MESSAGE_BY_BITS[r & c];
}

export function clampPosture(
  requested: { tools?: LaunchToolMode | null; messages?: LaunchMessageMode | null },
  ceiling: ChannelAgentPosture
): {
  tools: LaunchToolMode | null;
  messages: LaunchMessageMode | null;
  clamped: boolean;
} {
  const tools = narrowTo(requested.tools, ceiling.tools, LAUNCH_TOOL_MODES);
  const messages = narrowMessageMode(requested.messages, ceiling.messages);
  return {
    tools,
    messages,
    clamped:
      (!!requested.tools && requested.tools !== tools) ||
      (!!requested.messages && requested.messages !== messages),
  };
}

/**
 * MAY A LAUNCH FILED INTO THIS CHANNEL ASK FOR CHAINING?
 *
 * ⚠ **A REQUEST THE CHANNEL DOES NOT ALLOW IS REFUSED UP FRONT, NOT CLAMPED**,
 * and the asymmetry with the pair above is the desktop's own and is deliberate: a
 * clamped POSTURE still produces a working agent doing the asked-for work under
 * more supervision, while a clamped CHAIN produces an agent that will hit a bound
 * it was told it did not have, mid-run, after the orchestrator has already handed
 * it work that assumes workers.
 *
 * ⚠ **THREE INPUTS, NOT TWO, AND `false` IS NOT A SPELLING OF "DID NOT ASK".**
 *   `true`  ASK IT ON — granted only where the ceiling allows it; denied is a 400.
 *   `false` ASK IT OFF — always granted: strictly narrower than anything the
 *           channel would have given, so it wins even over a ceiling set to ON.
 *   `null`  DID NOT ASK — inherits, silently, and the machine decides.
 * ⚠ **AN UNRECORDED CEILING (`null`) REFUSES NOTHING.** The desktop's
 * `channelAgentChain` toggle is then the only answer, exactly as today.
 */
export function chainRefused(
  requested: boolean | null | undefined,
  ceiling: ChannelAgentPosture
): boolean {
  return requested === true && ceiling.chain === false;
}

/** What a chain request resolves to once the refusal above has not fired. ⚠ It
 *  can only ever NARROW: an unasked chain inherits (`null`), and an asked-off one
 *  is `false` whatever the channel allows. */
export function resolveChain(
  requested: boolean | null | undefined,
  ceiling: ChannelAgentPosture
): boolean | null {
  if (requested === false) return false;
  if (requested === true) return true; // `chainRefused` already ruled on it
  // ⚠ NOT ASKED ⇒ THE CEILING, WHICHEVER WAY IT POINTS (review D4). This used to
  // answer `null` for a ceiling of `true`, so "the channel allows chaining and
  // nobody asked" and "no ceiling is recorded" were the same stored value. The
  // desktop's `resolveChain` already returns `allowed === true` for this case, so
  // the two now agree on all three states.
  return ceiling.chain ?? null;
}
