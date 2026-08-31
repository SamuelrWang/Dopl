import type { ChannelEscalationInput } from "@dopl/client";
/**
 * THE HUMAN-READABLE RENDER OF AN ESCALATION — the `body` an `op="escalate"`
 * post carries.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) — a handler, schema fragment or description string in an
 * unprefixed file is invisible to every drift guard.
 *
 * ── WHY THE BODY CARRIES ALL FOUR FIELDS, WHEN THE METADATA ALREADY DOES ───
 * The card is `kind='message'` plus reserved `metadata.escalation`
 * (INVARIANTS §5). Four live surfaces know nothing about that key and never
 * will: `dopl_channel(op="read")`, a plain browser, the pop-out thread window,
 * and every desktop build older than the card. **If the body were a stub, an
 * escalation would render on those surfaces as an empty row** — which is the
 * one failure a question nobody can see cannot survive. So the body is the whole
 * question in prose, and the card is a BETTER rendering of the same words rather
 * than the only one.
 *
 * ── WHY THIS IS A HAND COPY ────────────────────────────────────────────────
 * ⚠ `src/features/channels/escalation.ts › escalationBody` is the same function
 * in the app tree, and `packages/` cannot import from `src/`. The pair is
 * maintained the way `dopl-desktop-app/main/agent-handles.js` is maintained
 * against `src/features/channels/lib/mentions.ts`: **one fixture table, driven
 * from both sides** — `channel-escalate-render.test.ts` here and
 * `src/features/channels/escalation-body-parity.test.ts` there, over the shared
 * cases in {@link ESCALATION_BODY_PARITY_CASES}. Either tree changing the render
 * alone fails a suite.
 *
 * ⚠ NOT MARKDOWN-ESCAPED, AND MUST NOT BECOME SO. The body is rendered as a
 * BODY — the zone INVARIANTS §10 says is rendered as itself — so escaping it
 * would show an agent's own formatting as backslashes to every reader falling
 * back to the prose.
 */
export declare function escalationBody(e: ChannelEscalationInput): string;
/**
 * THE PARITY TABLE, declared HERE and read by BOTH suites.
 *
 * ⚠ It lives on this side because this is the side that can be forgotten: the
 * app tree's copy is under `npm test` and `npm run typecheck`, while this one
 * only fails if somebody remembers to look. A shared table makes forgetting fail
 * loudly instead.
 *
 * ⚠ Cases must exercise the OPTIONAL arms — no context, no recommendation, both
 * absent — because those are the branches where two hand copies actually drift.
 */
export declare const ESCALATION_BODY_PARITY_CASES: ChannelEscalationInput[];
