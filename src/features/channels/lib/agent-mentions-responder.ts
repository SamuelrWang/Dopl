/** Split out of `agent-mentions.ts` (2026-09-14, 500-line cap): the DEFAULT-RESPONDER lane (RR3) — who answers a post that addressed nobody, and the one word saying why — which changes for its own reasons and not with the @-handle convention; every name here is re-exported from `agent-mentions.ts`, so no importer moved. */
import type { AgentMentionCandidate } from "./agent-mentions";

/**
 * WHY THIS AGENT AND NOT ANOTHER — the one word a surface prints beside a name
 * the author did not type.
 *
 * ⚠ **A CLOSED SET, SHARED BY BOTH TREES**, because it is stored (the server
 * stamps it into `metadata.wake_reason`) and rendered (the MCP read line, the
 * composer's chip). A free-form sentence here would be a second vocabulary the
 * renderers would each narrow differently.
 */
export type ResponderReason =
  // ⚠ `"default"` IS RETIRED (2026-09-06, Samuel's ruling on items 10 and 11). It named the
  // channel's configured `default_responder_agent_name` — a ROOM-WIDE pin of one specific
  // agent, set by a manager. His reasoning for killing it: *"if there's another member in the
  // room, their last agent address would be different from my last agent address."* One room
  // cannot hold one answer to a per-person question. ⚠ THE MEMBER OF THIS UNION IS KEPT so a
  // stored `metadata.wake_reason` written before today still renders as something rather than
  // as an unknown code; nothing produces it any more.
  | "default"
  /** Exactly one agent is live in the room. */
  | "only agent"
  /** Several are live; this one the ASKING PERSON addressed most recently. */
  | "most recent"
  /** Several are live and none was addressed lately; this one launched last. */
  | "most recently launched";

/**
 * **WHO ANSWERS THIS PERSON'S UNADDRESSED MESSAGES** — the per-user setting (2026-09-06,
 * Samuel's ruling on items 10 and 11).
 *
 * ⚠ **TWO OPTIONS, AND DELIBERATELY NO "PIN A SPECIFIC AGENT".** Agents are ephemeral — they
 * end, and their ids are minted per launch — so a pinned handle is a setting that decays into
 * naming nothing. That is the defect the room-wide `default_responder_agent_name` had, and it
 * is why the replacement is a RULE rather than a NAME.
 *
 * ⚠ **PER USER, NOT PER ROOM, AND THAT IS THE WHOLE RULING.** *"If there's another member in
 * the room, their last agent address would be different from my last agent address."*
 *
 * ⚠ **`"none"` MUST KILL EVERY FALLBACK, NOT JUST THE RECENCY ONE.** See
 * {@link resolveDefaultResponder} — arms 2, 3 and 4 all fire without anyone configuring
 * anything, so gating only the recency arm would leave a single-agent room still
 * auto-answering under "No one", which is the selection not being honoured.
 */
export type UnaddressedResponderSetting =
  /** Nobody answers this person's untagged messages. No agent is woken. */
  | "none"
  /** The agent this person addressed most recently in this room, if it is still live. */
  | "last_addressed";

/**
 * ⚠ **THE DEFAULT IS `last_addressed`, AND IT IS SAMUEL'S OWN STANDING RULING RATHER THAN A
 * PREFERENCE.** B1 (2026-09-04) says a forgotten `@` must never stall a conversation, and he
 * made that call off a live incident (row #966: a person wrote in a room with two live agents
 * and no default, the post stored `verdict=none`, fed 0 of 2, and he had to send it again with
 * a tag). Defaulting to `"none"` would silently reverse that for every room whose members
 * never open Settings — and silently reversing his rulings is the defect class this whole wave
 * exists to remove. `"none"` stays available as a deliberate act.
 */
export const UNADDRESSED_RESPONDER_DEFAULT: UnaddressedResponderSetting = "last_addressed";

/**
 * Coerce a stored / wire value to the closed set, fail-safe to the default.
 *
 * ⚠ **JUNK LANDS ON THE DEFAULT, NOT ON `"none"`.** The narrow answer looks like the safe one
 * and is not: `"none"` means "this person's untagged messages reach nobody", so an unreadable
 * column would silently stop answering a member who never chose that. Absent means "never
 * configured", which B1 already answers.
 */
export function normalizeUnaddressedResponder(
  raw: unknown
): UnaddressedResponderSetting {
  return raw === "none" || raw === "last_addressed"
    ? raw
    : UNADDRESSED_RESPONDER_DEFAULT;
}

export interface ResponderChoice {
  agentId: string;
  reason: ResponderReason;
}

/**
 * **THE CHANNEL'S DEFAULT RESPONDER, RESOLVED — ALL OF RR3, AS ONE PURE
 * FUNCTION** (2026-09-02, v2 wave B slice B10; arms 3a/3b added 2026-09-04).
 *
 * ⚠ **IT LIVES HERE BECAUSE TWO TREES ASK IT AND ONLY ONE OF THEM MAY IMPORT
 * `server-only`.** The rule was written for `server/service-wake-verdict-resilience.ts
 * › defaultResponder`, which still owns WHEN it is asked; the composer's recipient
 * line asks the same question about a draft that has not been sent yet, and a
 * second spelling of it is how the line comes to name an agent the server would
 * not have woken. `defaultResponder` is now a two-line adapter over this, so
 * there is one declaration and the server's own tests still drive it.
 *
 * THE ARMS, IN ORDER:
 *   1. the CONFIGURED handle (`channels.default_responder_agent_name`), if it is
 *      live in this room — tried as written and as its `agent-<id>` form, because
 *      the setting stores a handle and an operator may have typed either;
 *   2. else the room's ONE live agent;
 *   3. else, with several live: the one that POSTED here most recently
 *      (`recentAgentIds`, most-recent-first);
 *   4. else the FIRST candidate in the order the caller supplied — see the
 *      ordering note below.
 *
 * ⚠ **ARMS 3 AND 4 ARE SAMUEL'S B1 RULING APPLIED TO THE CASE IT HAD BEEN LEFT
 * OUT OF** (2026-09-04). "Two live agents and no setting" answered `null`, on the
 * argument that choosing between them is a guess — and the ruling in the same
 * breath is that **a forgotten `@` must never stall a conversation**. Row #966 is
 * what that costs: a person wrote in a room with two live agents and no default,
 * the post stored `verdict=none` and fed 0 of 2, and he had to send it again with
 * a tag. Two agents is the ordinary shape of a multiplayer channel, so the
 * "deliberately nobody" arm was the common case, not the edge.
 * ⚠ **AND IT IS NOT A GUESS, WHICH IS WHY IT IS SAYABLE.** "The one that spoke
 * here last" is the conversation's own answer to who is being talked to, and the
 * choice is STAMPED ({@link ResponderReason}) so the transcript can say why — the
 * thing a silent pick would not have.
 * ⚠ **THE CONFIGURED RESPONDER STILL WINS**, so an operator who has said who
 * answers is never second-guessed by recency.
 *
 * ⚠ **NOTHING HERE ORDERS THE CANDIDATES AND NOTHING SHOULD.** Arm 4 means "the
 * caller's first", and each caller documents its own ordering as its best
 * available answer to *most recently launched*: the server sorts by
 * `started_at` (`service-wake-verdict-resilience.ts › launchOrder`), the composer
 * passes the peer projection's own newest-first order. Baking a sort in would
 * give one caller a rule it did not ask for — the same argument the freshness
 * note below makes.
 *
 * ⚠ **NOTHING HERE FILTERS FOR FRESHNESS AND NOTHING SHOULD.** The caller decides
 * what "live" means: the server passes `liveChannelSessions` (PRESENCE — the
 * projection's full-set replace, Samuel's 2026-08-22 ruling), the composer passes
 * what the peer projection last answered. Baking a clock in would give one caller
 * a rule it did not ask for — and until 2026-09-05 the server's caller baked one
 * in for itself, which is how an idle agent stopped being addressable at all.
 */
export function resolveDefaultResponder(
  /**
   * ⚠ **THIS PARAMETER REPLACED `configured` ON 2026-09-06** (Samuel's ruling, items 10/11).
   * It was the channel's room-wide `default_responder_agent_name` — a manager pinning ONE
   * specific agent for EVERYBODY. It is now the ASKING PERSON's own two-valued setting.
   *
   * ⚠ **`"none"` SHORT-CIRCUITS EVERYTHING BELOW.** Not just the recency arm: arms 2, 3 and 4
   * all fire with nothing configured, so a single-agent room would otherwise go on
   * auto-answering under "No one" — the selection not being honoured, which is the complaint
   * this item came from.
   *
   * ⚠ **AN ABSENT VALUE IS THE DEFAULT, NOT `"none"`** — see
   * {@link UNADDRESSED_RESPONDER_DEFAULT}. Callers pass the coerced value; this signature does
   * not accept `null` precisely so "I could not read the setting" cannot be spelled as "the
   * user chose nobody".
   */
  setting: UnaddressedResponderSetting,
  candidates: readonly AgentMentionCandidate[],
  /** Agent ids the ASKING PERSON has ADDRESSED in this room, MOST RECENT FIRST
   *  (`lib/agent-post-stamp.ts › recentAgentsAddressedBy`; it credited
   *  `recentAgentPosters` until 2026-09-06, stale since the arm changed feed on
   *  2026-09-04). ⚠ **UNBOUNDED IN TIME** since 2026-09-06 — this loop's
   *  intersection with the live candidates is what ends the stickiness when an
   *  agent ends. Empty is a complete answer: arm 3 then falls to the caller's own
   *  ordering. */
  recentAgentIds: readonly string[] = []
): ResponderChoice | null {
  // ⚠ **THE WHOLE FUNCTION IS OFF WHEN THE PERSON SAID NOBODY.** First line, before any
  // candidate is looked at, so there is no arm below that can be reached with `"none"` set —
  // which is the only way "must not fire ANYWHERE" is enforceable rather than remembered.
  if (setting === "none") return null;
  // ⚠ **ARM 1 IS DELETED (2026-09-06).** It resolved the channel's configured handle against
  // the mention index, tried as written and as its `agent-<id>` form, and answered
  // `reason: "default"`. It was the room-wide pin; the setting above replaces it with a rule.
  // ⚠ NOTE WHAT WENT WITH IT: this was `buildAgentMentionIndex`'s ONLY call inside this
  // function, so the two-pass claim order (z5ztx9ts, 2026-09-07) is untouched by this change
  // and has one fewer caller to satisfy, not one more.
  const ids = [...new Set(candidates.map((c) => c.agentId))];
  if (ids.length === 0) return null;
  if (ids.length === 1) return { agentId: ids[0], reason: "only agent" };
  for (const id of recentAgentIds) {
    if (ids.includes(id)) return { agentId: id, reason: "most recent" };
  }
  return { agentId: ids[0], reason: "most recently launched" };
}
