/**
 * THE AGENT-INSTANCE STAMP ON A `client_msg_id` — one parser, framework-free.
 *
 * ⚠ SPLIT OUT OF `components/channels-v2/agents-model.ts` ON 2026-08-31 AND
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
 * tie is representable — the same argument `findLastRoomAddressToAgent` makes.
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
export function recentAgentPosters(
  rows: readonly {
    seq: number;
    createdAt: string;
    authorKind?: string | null;
    clientMsgId?: string | null;
    metadata?: Record<string, unknown> | null;
  }[],
  /** ⚠ `now` DEFAULTS HERE RATHER THAN AT THE CALL SITE, the same arrangement
   *  `components/channels-v2/agents-model.ts` uses for the same reason: a
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
