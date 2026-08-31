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
