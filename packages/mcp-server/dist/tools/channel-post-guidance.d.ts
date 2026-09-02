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
 * `dopl_channel(op="help")`.
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
import { type FactValue } from "./channel-facts";
/**
 * How many readers the SERVER resolved out of the body, read back off the
 * STORED message. ⚠ Tolerant in the same direction as `mentionedUserIdsOf`: a
 * missing key, or a value that is not an array of strings, counts as ZERO
 * rather than being trusted.
 */
export declare function resolvedMentionCount(message: ChannelMessage): number;
export type MentionKind = "agent" | "handle";
export type MentionToken = {
    token: string;
    kind: MentionKind;
};
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
export declare function classifyMentions(body: string): MentionToken[];
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
export declare function postMentionFacts(body: string, message: ChannelMessage): MentionFacts;
