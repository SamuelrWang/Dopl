/**
 * THE AGENT-INSTANCE STAMP ON A `client_msg_id` — one parser, framework-free.
 *
 * ⚠ SPLIT OUT OF `channels/components/agents-model.ts` ON 2026-08-31 AND
 * RE-EXPORTED THROUGH IT, so no import moved — the same move `lib/mentions.ts`
 * made for `lib/mentions-mask.ts`. The reason is a NEW READER ON THE SERVER:
 * `server/service-writes-metadata-escalation.ts` derives the asking agent's id
 * off the escalation message it is answering, and `agents-model.ts` is a
 * `"use client"` module a service must not import. **INVARIANTS §5's rule is
 * unchanged and is why this is a MOVE rather than a copy: the pattern is
 * declared once, here, and nowhere else in the tree.**
 *
 * ⚠ ANCHORED, AND THE ANCHORING IS THE DISCRIMINATOR, NOT A PREFIX.
 * `dopl-desktop-app/main/channel-post.js › postCourtesy` stamps MACHINE-level
 * posts `agent-<channelUUID>-<seq>`, and a channel UUID can BEGIN with eight
 * id-shaped characters — so a `startsWith` would attribute a machine post to an
 * agent that does not exist.
 */
const AGENT_POST_STAMP_RE = /^agent-([a-z][a-z0-9]{7})-\d+$/;

/**
 * WHICH AGENT INSTANCE WROTE THIS POST — the agent id off a `client_msg_id`, or
 * `null` when the row is not stamped by one instance.
 *
 * ⚠ `null` IS "CANNOT SAY", NEVER "SOME OTHER AGENT". Three real classes of
 * agent-authored row carry no per-instance stamp: a main older than the stamp,
 * an agent that supplied its own idempotency key, and every courtesy no-op the
 * machine sends about ITSELF. Every reader must fail toward the old behaviour on
 * `null` (INVARIANTS §11 — render what IS known, never a blank or a guess
 * standing in for it).
 */
export function parseAgentPostStamp(
  clientMsgId: string | null | undefined
): string | null {
  if (typeof clientMsgId !== "string") return null;
  return AGENT_POST_STAMP_RE.exec(clientMsgId)?.[1] ?? null;
}

/**
 * WHICH AGENT INSTANCE WROTE THIS POST, FROM THE SERVER'S OWN STAMP —
 * `metadata.session_id`, whose LAST segment is the agent id.
 *
 * ⚠ **IT EXISTS BECAUSE {@link parseAgentPostStamp} ANSWERS `null` FOR EVERY
 * POST THAT CARRIES ITS OWN IDEMPOTENCY KEY** (2026-09-04, the Mobile Command
 * Center incident). `client_msg_id` is CALLER-SUPPLIED and
 * `main/session-outbound-tag.js › threadTagFor` deliberately NEVER OVERWRITES
 * one an agent chose — so an agent that passes `client_msg_id: "reply-2"` is
 * anonymous to every reader that keys on the stamp: the desktop fed the session
 * its own post back (`main/session-dispatch.js › wroteIt`), and the transcript
 * pill printed the bare noun "Agent" for a named session
 * (`attribution-pill.tsx › attributionName`).
 *
 * ⚠ **AND IT IS THE STRONGER FACT, NOT A WEAKER FALLBACK.** `client_msg_id` is
 * whatever the caller sent; `metadata.session_id` is stripped from caller input
 * unconditionally and re-stamped from the `X-Dopl-Session-Id` header
 * (`server/service-writes-metadata.ts` fold 6b), so it cannot be posed. The
 * stamp is tried first only because it is the older form and some rows carry it
 * alone.
 *
 * ⚠ **THE KEY SHAPE IS `main/session-store.js › sessionKey`,
 * `<channelId>:<taskId>:<agentId>`, AND THE MIDDLE SEGMENT IS LEGITIMATELY
 * EMPTY** for a session with no first-class thread (`chan::deynelz3` is the
 * ordinary room shape). So it reads from the END and walks back rather than
 * counting segments — the same rule `packages/mcp-server/src/tools/
 * channel-render.ts › sessionTail` states for the same key, in the tree that
 * cannot import this one.
 */
export function agentIdOfSessionKey(
  sessionId: string | null | undefined
): string | null {
  if (typeof sessionId !== "string") return null;
  const parts = sessionId.split(":");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i].trim().toLowerCase();
    if (AGENT_ID_RE.test(part)) return part;
  }
  return null;
}

/**
 * ⚠ THE AGENT CHARSET, ONE SPELLING — `main/agent-id.js`'s, restated by
 * {@link AGENT_POST_STAMP_RE} above and by `session-dispatch.js`'s anchored
 * mention regex. Anchoring it is what keeps a channel UUID's first segment from
 * reading as an agent id.
 */
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

/**
 * THE AGENT THAT WROTE ONE ROW — the post stamp, else the session key.
 * `null` is "cannot say", never "some other agent" (INVARIANTS §11).
 */
export function authorAgentIdOf(row: {
  clientMsgId?: string | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const stamped = parseAgentPostStamp(row.clientMsgId);
  if (stamped !== null) return stamped;
  const sessionId = row.metadata?.session_id;
  return agentIdOfSessionKey(typeof sessionId === "string" ? sessionId : null);
}

/**
 * **WHICH AGENTS HAVE SPOKEN IN THIS ROOM LATELY, MOST RECENT FIRST** — RR3
 * arm 3's input (2026-09-04, Samuel's B1: a forgotten `@` must never stall).
 *
 * ⚠ **ONE RULE, TWO TREES, AND THAT IS THE WHOLE REASON IT IS HERE.** The server
 * asks it of a bounded `channel_messages` read and the composer asks it of the
 * transcript it is already rendering; a second spelling would let the recipient
 * LINE name one agent and the stored verdict name another, which is the class of
 * defect the delivery keystone exists to end.
 *
 * ⚠ **ORDERED BY `seq`, DESCENDING, AND NOT BY THE CALLER'S ARRAY ORDER.** `seq`
 * is unique per channel and monotonic on commit, so the ordering is TOTAL and no
 * tie is representable — the argument RR2's now-deleted read also made.
 * Sorting here rather than trusting the caller is what lets one ascending
 * transcript and one descending query answer identically.
 *
 * ⚠ **MAIN-ROOM ROWS ONLY.** A post tagged into a thread belongs to that
 * exchange (RR1's business); counting it here would let a private thread decide
 * who answers the room.
 *
 * ⚠ **AN UNPARSEABLE OR OUT-OF-WINDOW TIMESTAMP IS SKIPPED, NEVER GUESSED.** The
 * arm exists to name the agent the conversation is already with; an undated row
 * says nothing about that, and falling through to arm 4 is the honest answer.
 */
/**
 * **DID THE AUTHOR OF THIS ROW TYPE THE TAG THEMSELVES** — the one predicate RR3's arm 3 turns on
 * (Samuel, 2026-09-04: *"it should be the most recent agent that the USER addressed"*).
 *
 * ⚠ **TWO CONDITIONS, AND THE SECOND ONE IS THE WHOLE POINT.** `recipient_agent_ids` alone says
 * "this message reached an agent" — but the server's OWN arm-3 pick is stored there too, so a rule
 * that read recipients alone would feed on its own output: it picks an agent once, every later read
 * sees that agent "addressed", and it re-picks it forever. That is self-reinforcing drift, and it
 * is indistinguishable from the bug this change exists to fix.
 * ⚠ `wake_reason` IS WHAT TELLS THEM APART. The server stamps it ONLY when it chose for itself
 * (`service-writes-metadata.ts` strips any caller-set value first, so it cannot be forged). Present
 * ⇒ the server picked. Absent ⇒ the author typed it. **Evidence must be the human's own act.**
 *
 * ⚠ **A ROW WITH NEITHER FIELD IS "NO TAG HERE", NEVER AN ERROR.** Rows written before these
 * stamps existed simply do not testify; the walk continues past them (INVARIANTS §11 — UNKNOWN is
 * not EMPTY, and neither is a reason to stop).
 */
export function isAuthorTypedAgentTag(row: {
  recipientAgentIds?: readonly string[] | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const named = row.recipientAgentIds;
  if (!Array.isArray(named) || named.length === 0) return false;
  return typeof row.metadata?.wake_reason !== "string";
}

/**
 * **WHO THE SERVER AIMED THIS ROW AT WHEN NOBODY TYPED A TAG** — the agent ids RR3 resolved, for
 * the transcript to FACE (Samuel, 2026-09-05: *"it should still auto-add the agent tag… it's
 * confusing for someone looking back that there was no tag"*).
 *
 * ⚠ **IT IS THE EXACT COMPLEMENT OF {@link isAuthorTypedAgentTag}, AND THAT IS WHY IT LIVES
 * HERE.** Both turn on the same two fields and they partition the same set: recipients present
 * with NO `wake_reason` is the author's own act (arm 3's evidence), recipients present WITH one is
 * the server's own pick (this). Writing this rule anywhere else would be a second answer to
 * "who addressed whom", which is the F-266 shape this file exists to prevent — and the two would
 * drift into a transcript that displays one agent and a router that woke another.
 *
 * ⚠ **`wake_reason` IS SERVER-STAMPED AND UNFORGEABLE** (`service-writes-metadata.ts` strips any
 * caller-set value first), which is what makes it safe to render as an ADDRESS. A rule reading
 * recipients alone would also face the tags the author typed, doubling every explicit mention.
 *
 * ⚠ **DISPLAY ONLY, AND IT REWRITES NOTHING.** The stored body is never touched: what the author
 * typed stays what they typed, on every surface that reads the row (MCP, notifications, quotes),
 * and this is the transcript saying out loud what the server already decided and stored. A body
 * rewrite would put words in somebody's mouth and would have to be undone by hand if the rule
 * ever changed.
 *
 * ⚠ **EMPTY IS THE ORDINARY ANSWER.** Old rows predate both stamps, a typed tag has no
 * `wake_reason`, and an unrouted post has no recipients; all three are "nothing to face here",
 * never an error (INVARIANTS §11 — UNKNOWN is not EMPTY, and neither is a reason to shout).
 */
export function serverRoutedAgentIds(row: {
  recipientAgentIds?: readonly string[] | null;
  metadata?: Record<string, unknown> | null;
}): string[] {
  const named = row.recipientAgentIds;
  if (!Array.isArray(named) || named.length === 0) return [];
  if (typeof row.metadata?.wake_reason !== "string") return [];
  return named.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * **WHICH AGENTS THIS AUTHOR HAS ADDRESSED IN THIS ROOM, MOST RECENT FIRST** — RR3 arm 3's feed
 * since 2026-09-04, replacing "whoever posted last".
 *
 * ⚠ **WHY IT CHANGED.** Arm 3 used to name the agent that POSTED most recently, so one agent
 * addressing another re-pointed the room's default responder and the operator watched it wander
 * with nothing they did. Samuel's rule is stickiness per PERSON: the agent you last spoke to is the
 * one you are probably still speaking to.
 * ⚠ **SCOPED TO ONE AUTHOR AND ONE ROOM.** The server keys on the routed message's author, the
 * composer on the current user; two people in a channel each keep their own thread of address, which
 * is what "intuitive" means here — my default must not move because a colleague tagged someone else.
 *
 * ⚠ **AND SCOPED TO ONE AUTHOR *KIND*, WHICH IS A SEPARATE CONDITION AND NOT A RESTATEMENT**
 * (2026-09-15, F-704 — the fourth round on this bug). The author filter is necessary and was
 * never sufficient: **an agent posts under its OPERATOR'S `author_user_id`**
 * (`server/service-writes.ts` — `author_user_id: ctx.userId`, `author_kind: authorKind`, one
 * insert for both), so on the only field this walk filtered, *Samuel addressing an agent* and
 * *Samuel's agent addressing an agent* were the same row. One orchestrator handing work to a
 * worker therefore stomped its own operator's default — reproduced in channel `bb0f57db` as
 * Samuel→Prime, Prime→`k2k2q9fh`, Samuel's next untagged message→`k2k2q9fh`.
 * ⚠ **THE THREE PRIOR FIXES ALL CHANGED THE SELECTOR AND NONE ADDED THIS PREDICATE**, which is
 * why it kept coming back. `c0794ed3` (09-04) fed the arm "who POSTED here last", so any agent
 * post moved everybody's default; the fix for it swapped `author_kind = 'agent'` **for**
 * `author_user_id = <person>` — a REPLACE where an INTERSECT was wanted, which deleted the only
 * "a human did this" signal in the walk; `f5035e66` (09-06) then removed the 15-minute window,
 * which did not cause the stomp but made it permanent instead of self-healing. The rule wants
 * BOTH halves: **this person, and this person themselves.**
 * ⚠ **THE DOCBLOCKS SAID SO BEFORE THE CODE DID.** {@link isAuthorTypedAgentTag} has claimed
 * *"evidence must be the human's own act"* since it was written, and this one has said *"per
 * PERSON"* throughout — the prose was the spec and the predicate was two-thirds of it. Anyone
 * widening this walk again: the sentence is not enforced by being written down.
 * ⚠ **MAIN-ROOM ROWS ONLY**, `seq`-descending: {@link recentAgentPosters}'s rules on those two
 * points and for its reasons — a threaded post is RR1's business, and `seq` is a total order so no
 * tie is representable.
 *
 * ⚠ **NO TIME WINDOW, AND THAT IS THE RULE RATHER THAN A DEFAULT** (Samuel, 2026-09-06). It was
 * bounded by `RESILIENCE_WINDOW_MS` until then, and that was the bug: fifteen minutes after you
 * tagged an agent your default silently became *the most recently LAUNCHED* one, so the room
 * answered in a different voice with nothing you had done. Author stickiness has no clock —
 * **the agent you last addressed stays the default until you address a different live agent, or
 * that agent ends**, and an ended agent falls out at pick time (see the liveness note below), so
 * the next-most-recent tag wins. `windowMs` survives as an OPTIONAL argument for a caller that
 * genuinely wants a bounded look-back; omitted, the walk is unbounded and the only bound left is
 * how many rows the caller handed in.
 * ⚠ **THE TIMESTAMP IS READ ONLY WHEN A WINDOW IS PASSED.** Ordering is `seq`'s job, so an undated
 * or unparseable row is no longer evidence of nothing — it is an ordinary row with a typed tag on
 * it (INVARIANTS §11: UNKNOWN is not EMPTY). It is still skipped when a caller asks for a window,
 * because a row that cannot say when it happened cannot be shown to be inside one.
 * ⚠ **THIS IS NOT `recentAgentPosters`' CLOCK.** That one still takes a required `windowMs` and
 * the unaddressed-post arm still passes `RESILIENCE_WINDOW_MS` to it: "who spoke here lately" is a
 * FRESHNESS question and goes stale, "who did this person address" is a habit and does not.
 * ⚠ **IT DOES NOT FILTER FOR LIVENESS AND MUST NOT.** This answers "who did they address"; whether
 * that agent still exists is the caller's question, asked against the live candidate set at pick
 * time (`lib/agent-mentions.ts › resolveDefaultResponder`). An ended agent therefore cannot eat the
 * pick — it is simply not in the candidates, and the next id here is tried. **That intersection is
 * the whole of the "or that agent ends" half of the ruling**, and it is why removing the window
 * cannot resurrect a dead session.
 * ⚠ **EMPTY IS A COMPLETE ANSWER.** An author who has never typed a tag falls through to the
 * arms that already exist; absence degrades, it never blocks.
 */
export function recentAgentsAddressedBy(
  /** The person whose habit is being read. `null` answers `[]` rather than everybody's. */
  authorUserId: string | null,
  rows: readonly {
    seq: number;
    createdAt: string;
    authorUserId?: string | null;
    /** ⚠ **REQUIRED BY THE RULE, OPTIONAL IN THE TYPE, AND THE ASYMMETRY IS DELIBERATE** — see
     *  the `authorKind` note in the header. It is `string` rather than the `MessageAuthorKind`
     *  union so this file stays framework- and import-free for both trees, which is the whole
     *  reason it was split out. */
    authorKind?: string | null;
    recipientAgentIds?: readonly string[] | null;
    metadata?: Record<string, unknown> | null;
  }[],
  /** ⚠ `windowMs` OMITTED MEANS UNBOUNDED, which is what both real callers pass. `now` still
   *  defaults here rather than at a call site, for {@link recentAgentPosters}' reason: a component
   *  may not read a clock during render and a model may. */
  opts: { now?: number; windowMs?: number } = {}
): string[] {
  if (authorUserId === null) return [];
  const windowMs = opts.windowMs;
  // ⚠ THE CLOCK IS NOT READ AT ALL WITHOUT A WINDOW — not merely unused. The composer asks this
  // during render and the answer must not depend on the moment it was asked.
  const now = windowMs === undefined ? 0 : (opts.now ?? Date.now());
  const out: string[] = [];
  for (const row of [...rows].sort((a, b) => b.seq - a.seq)) {
    if (row.authorUserId !== authorUserId) continue;
    // ⚠ **MY OWN AGENTS POST AS ME, AND THIS LINE IS THE WHOLE OF THE 2026-09-15 FIX (F-704).**
    // `server/service-writes.ts` stamps EVERY row `author_user_id: ctx.userId` — an agent's
    // included — so the author filter above cannot tell *Samuel tagged @coder* from *Samuel's
    // orchestrator tagged @coder*. `author_kind` is the only field that can, and this walk did not
    // read it for eleven days: an agent-to-agent handoff re-pointed its operator's default
    // responder, which is the reported bug, four rounds running.
    // ⚠ **IT IS TESTED `=== "agent"`, NOT `!== "user"`, AND THAT IS NOT A STYLE CHOICE.** The
    // field is absent on rows read before it was projected, and an absent value must degrade to
    // the OLD behaviour rather than silently empty the list — INVARIANTS §11, UNKNOWN is not
    // EMPTY. `!== "user"` would read every legacy row as an agent's and delete the stickiness the
    // 2026-09-06 ruling exists to protect.
    // ⚠ **IT IS HERE, NOT IN `isAuthorTypedAgentTag`.** That predicate answers "was this tag
    // typed rather than server-picked" for ONE row and has other readers
    // (`serverRoutedAgentIds`'s complement); WHOSE habit is being read is this function's
    // question, and it already owns the author filter one line up. One question, one place.
    if (row.authorKind === "agent") continue;
    if (typeof row.metadata?.taskId === "string") continue;
    if (windowMs !== undefined) {
      const at = Date.parse(row.createdAt);
      if (!Number.isFinite(at) || now - at > windowMs) continue;
    }
    if (!isAuthorTypedAgentTag(row)) continue;
    // ⚠ ORDER WITHIN ONE ROW IS THE STORED ORDER. A message naming two agents addressed both, and
    // nothing in the row ranks them; the caller's liveness check decides which survives.
    for (const id of row.recipientAgentIds ?? []) {
      if (typeof id === "string" && id.length > 0 && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function recentAgentPosters(
  rows: readonly {
    seq: number;
    createdAt: string;
    authorKind?: string | null;
    clientMsgId?: string | null;
    metadata?: Record<string, unknown> | null;
  }[],
  /** ⚠ `now` DEFAULTS HERE RATHER THAN AT THE CALL SITE, the same arrangement
   *  `channels/components/agents-model.ts` uses for the same reason: a
   *  component may not read a clock during render, and a model may. The SERVER
   *  passes its own write-time clock explicitly. */
  opts: { now?: number; windowMs: number }
): string[] {
  const now = opts.now ?? Date.now();
  const out: string[] = [];
  for (const row of [...rows].sort((a, b) => b.seq - a.seq)) {
    if (row.authorKind !== "agent") continue;
    if (typeof row.metadata?.taskId === "string") continue;
    const at = Date.parse(row.createdAt);
    if (!Number.isFinite(at) || now - at > opts.windowMs) continue;
    const id = authorAgentIdOf(row);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}
