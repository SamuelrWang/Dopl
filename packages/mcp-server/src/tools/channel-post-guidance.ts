/**
 * WHAT BECAME OF THE `@…` TOKENS IN A POST — the two FACTS a post result carries
 * about them, and nothing else.
 *
 * ⚠ WHAT THIS FILE USED TO BE (T10/T12, 2026-09-02). It held four standing
 * paragraphs — the per-mention breakdown, the five reasons a member handle
 * resolves to nobody, the main-room sparseness bar, and the when-to-tag note —
 * and `postGuidanceLines` spliced up to three of them under EVERY successful
 * post. Every one of them was true before the call and true after it, so every
 * one of them is now stated ONCE in `channel-doctrine.ts` and reachable with
 * `dopl_channel(op="rooms", action="help")`.
 *
 * ⚠ WHAT DID **NOT** MOVE, AND MUST NOT. The server's own mention RESOLUTION is
 * a fact about THIS write that the caller cannot derive: an exact-match resolver
 * posts a misspelled handle successfully and reaches nobody, so without a report
 * the agent believes it escalated (INVARIANTS §10). The paragraph left; the
 * VERDICT stayed, as `tags=<resolved>/<attempted>`. Likewise the agent handles a
 * body carried ride back as `wake=`, because "which agent did I just name" is
 * something only the body knows and the five-cause paragraph never answered.
 *
 * ⚠ AGENT HANDLES AND MEMBER HANDLES ARE COUNTED SEPARATELY, and that split is
 * the whole reason `classifyMentions` exists. The server's stamp is over the
 * HUMAN roster only, so folding an `@agent-<id>` into the `tags=` fraction would
 * report a `0/1` for a token nobody was ever going to stamp — the exact
 * mis-narration a live orchestrator acted on (ENGINEERING, 2026-08-31).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) and by the removed-vocabulary source scan
 * (channel-law.test.ts).
 */

import type { ChannelMessage } from "@dopl/client";
import { tagFact, type FactValue } from "./channel-facts";

/**
 * ⚠ HAND-COPIED from `src/features/channels/lib/mentions.ts ›
 * MENTIONS_METADATA_KEY` (no shared source tree between the app and this
 * package — the same arrangement `channel-addressing.ts ›
 * GROUP_CHANNEL_MIN_MEMBERS` lives under). It is the reserved key the server
 * stamps its OWN resolution into; a caller cannot set it (INVARIANTS §5), which
 * is exactly why reading it back is worth anything.
 */
const MENTIONS_METADATA_KEY = "mentionedUserIds";

/**
 * How many readers the SERVER resolved out of the body, read back off the
 * STORED message. ⚠ Tolerant in the same direction as `mentionedUserIdsOf`: a
 * missing key, or a value that is not an array of strings, counts as ZERO
 * rather than being trusted.
 */
export function resolvedMentionCount(message: ChannelMessage): number {
  const value = (message.metadata as Record<string, unknown> | undefined)?.[
    MENTIONS_METADATA_KEY
  ];
  if (!Array.isArray(value)) return 0;
  return value.filter((id) => typeof id === "string").length;
}

/**
 * ⚠ HAND-COPIED from `src/features/channels/lib/mentions.ts › MENTION_TOKEN_RE`
 * — `@` plus one or more non-whitespace, non-`@` characters, at any position,
 * mid-word included. A stricter rule here would report "you tagged nobody" over
 * a body the server's parser reads as a tag, which is the two-parsers-disagreeing
 * bug that module exists to prevent.
 *
 * ⚠ IT DOES NOT MIRROR THE CODE RULE, DELIBERATELY (2026-08-22). The server
 * skips a handle inside a code span or a fenced block; this does not, so a body
 * whose only handle is backticked still reports `tags=0/1` — which is the signal
 * that sends a reader to the doctrine's first cause. Teaching the exception here
 * would swallow the report and leave the agent believing the tag was never
 * written. This asks "did the AUTHOR write one"; only the server answers "did it
 * land".
 */
const MENTION_TOKEN_RE = /@([^\s@]+)/g;

/**
 * ⚠ HAND-COPIED from `dopl-desktop-app/main/session-dispatch.js ›
 * mentionedAgentIds` — the ID DOOR, both forms, the `agent-` prefix optional
 * exactly as it is there. The lookbehind is NOT reproduced: that regex scans
 * free prose and needs it so the bare alternative cannot also match inside
 * `@agent-<id>`; this one is anchored against ONE already-extracted token, where
 * the two forms cannot overlap.
 */
const AGENT_HANDLE_RE = /^(?:agent-)?[a-z][a-z0-9]{7}$/;

/** ⚠ TRAILING PUNCTUATION IS STRIPPED, LEADING IS NOT — `mentions.ts ›
 *  mentionHandleOf`'s rule, restated so `@agent-x2sz1ztt.` at the end of a
 *  sentence classifies as the handle it plainly is. */
function stripTrailing(token: string): string {
  return token.replace(/[^\p{L}\p{N}_-]+$/u, "");
}

export type MentionKind = "agent" | "handle";

export type MentionToken = { token: string; kind: MentionKind };

/**
 * Every `@…` in the body, in order, de-duplicated, classified by SHAPE.
 * ⚠ De-duplicated because the report is about which ADDRESSES were written, not
 * how many times; a body naming one agent four times has one address in it.
 *
 * ⚠ THE GRAMMAR IS PUBLIC, SO THE ID FORM IS DECIDABLE HERE, EXACTLY — but
 * whether an agent handle REACHES anything is not decidable here or on the
 * server at all: the resolver is the operator's desktop, over ids minted on that
 * machine. So `wake=` says what the body NAMED, never that it arrived.
 */
export function classifyMentions(body: string): MentionToken[] {
  const out: MentionToken[] = [];
  const seen = new Set<string>();
  for (const m of String(body ?? "").matchAll(MENTION_TOKEN_RE)) {
    const token = stripTrailing(m[1] ?? "");
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({
      token,
      kind: AGENT_HANDLE_RE.test(token) ? "agent" : "handle",
    });
  }
  return out;
}

/** The two mention facts a post result carries. ⚠ `undefined` ⇒ renders `-`. */
export interface MentionFacts {
  /** `<resolved>/<attempted>` over MEMBER handles, or absent when none was written. */
  tags: FactValue;
  /** The `@agent-…` handles this body named, or absent when it named none. */
  wake: FactValue;
}

/**
 * THE WHOLE CONTRIBUTION OF THIS MODULE TO A POST RESULT. ⚠ Both fields are
 * absent (not zero) when the body carried no token of that kind — a `tags=0/0`
 * would read as a failed tag on the overwhelming majority of posts, which carry
 * no `@` at all.
 */
export function postMentionFacts(
  body: string,
  message: ChannelMessage,
): MentionFacts {
  const mentions = classifyMentions(body);
  const handles = mentions.filter((m) => m.kind === "handle");
  const agents = mentions.filter((m) => m.kind === "agent");
  return {
    tags: tagFact(resolvedMentionCount(message), handles.length),
    // ⚠ The tokens AS WRITTEN, prefixed the one way the desktop parser and the
    // Dopl app both spell them, so a reader can compare what it meant to name
    // against what it did. `channel-facts.ts` neutralizes and clips them.
    wake:
      agents.length === 0
        ? undefined
        : agents
            .map((m) => (m.token.startsWith("agent-") ? m.token : `agent-${m.token}`))
            .map((t) => `@${t}`)
            .join(","),
  };
}
