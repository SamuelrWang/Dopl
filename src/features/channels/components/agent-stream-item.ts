"use client";

/**
 * **ONE ROW OF THE RENDERED STREAM — WHAT A ROW CAN CARRY, AND NOTHING ABOUT HOW ONE IS BUILT**
 * (split out of `agent-stream-model.ts`).
 *
 * ⚠ THE SEAM IS "ONE FILE, ONE REASON TO CHANGE", not the line count that forced the question —
 * the same seam that split `agent-stream-lanes.ts` and `agent-stream-groups.ts` off the same file,
 * and the third edge of it. **This file moves when a FACE needs a new FACT about a row**: every
 * field here exists because some component had to say something it could not say before (the
 * destination banner, the held-draft card, the run ordinal, the direction's sender, #3081's
 * arriving message and addressee pills). `agent-stream-model.ts` moves when the STREAM's own
 * ARITHMETIC moves: the post/echo dedupe, the held-draft join, the TTL, the ordering. Two clocks,
 * and until now one file.
 *
 * ⚠ IT MOVED VERBATIM and is RE-EXPORTED from `agent-stream-model.ts`, which stays the import path
 * of record — no importer changed, and a second canonical path for one symbol is how two call sites
 * come to disagree about which is authoritative.
 *
 * ⚠ THE FILE IS PURE AND TAKES TYPE-ONLY IMPORTS. It is the half of the stream that can be
 * reasoned about with no messages, no consent rows and no clock.
 */

import type { DisplayPayload } from "./view-model-display";
import type { PostDestination } from "./agents-model";
import type { StreamLane } from "./agent-stream-lanes";
import type { AgentColorKey } from "../types";


/** One row of the rendered stream. */
export interface StreamItem {
  key: string;
  lane: StreamLane;
  /** Epoch ms, for ordering. */
  at: number;
  text: string;
  /** `tool` rows only — the RAW tool name; shortened at render. */
  tool?: string;
  /** `tool` rows only — `false` on a result that failed. */
  ok?: boolean;
  /**
   * `tool` rows only — the run's tool-use ordinal as MAIN counted it
   * (`spa-bridge-narration.ts › DesktopNarrationEntry.runCount`), so the group's
   * number survives the ring evicting the head of a long run. Absent on an older
   * main, and {@link StreamGroup.tools} falls back to counting rows.
   */
  runCount?: number;
  /**
   * `sent` rows only — WHERE IT WENT, for the box's banner (Samuel, 2026-09-16:
   * *"I want it to say the name of the channel, or the thread, that it is posted to"*).
   *
   * ⚠ **IT WAS A BARE THREAD TITLE UNTIL THEN, AND THAT SHAPE COULD NOT SAY WHAT HE
   * ASKED FOR**: `null` meant both "the main channel" and "a thread I have no title
   * for", so the channel wording was a fallback rather than a destination.
   * {@link PostDestination} carries the KIND beside the NAME — see `agents-model.ts`.
   */
  to?: PostDestination | null;
  /**
   * `sent` rows only — THE DISPLAY this post carries (every decision too), set from the STORED
   * row's server-written metadata and never from a narration frame (the key is reserved).
   *
   * ⚠ ABSENT IS THE ORDINARY ANSWER and the row renders as the plain sent box, showing the same
   * words in prose — what a build without displays shows.
   */
  display?: DisplayPayload;
  /**
   * `sent` rows only — **this post has not gone out yet.** The outbound consent
   * gate is holding it and the card is the review surface (Samuel, 2026-08-25).
   * ⚠ Never set on a row built from a TRANSCRIPT message: that row exists on the
   * server, which is the definition of sent.
   */
  pending?: boolean;
  /**
   * `pending` rows only — the `channel_consent_requests` row the Post button
   * decides, or `null` when nothing decidable matches this draft.
   *
   * ⚠ **`null` IS "NOTHING TO PRESS", NOT "IT NEVER WENT" (corrected 2026-08-25).**
   * It covers the 15s between a Post and the desktop's poll delivering it, a row
   * denied on another surface, and a body-join that missed — none of which is a
   * failure the card may assert. Only {@link StreamItem.expired} says that.
   */
  requestId?: string | null;
  /**
   * `pending` rows only — this draft's own row is PAST ITS TTL, so nothing will
   * ever post it. The one condition under which the card may say "Not sent".
   *
   * ⚠ **IT IS COMPUTED HERE BECAUSE THE SERVER DOES NOT SWEEP.** INVARIANTS §6:
   * expiry is LAZY and `listConsentRequests` is deliberately unswept, so an
   * elapsed row is still returned with `status: "pending"`. Trusting that status
   * would put a live Post button on a row the decide route will refuse.
   */
  expired?: boolean;
  /**
   * MAIN CUT THIS LINE AT ITS PROSE CAP AND THE TAIL EXISTS NOWHERE (2026-08-31,
   * `spa-bridge-shapes.ts › DesktopNarrationEntry.truncated`). The cap equals the
   * renderer's own expanded ceiling, so a `length >` check can never detect a
   * main-cut line — this flag is the only marker there is, and every face that
   * shows the text must say so when it is set (INVARIANTS §9).
   * ⚠ Absent means ARRIVED WHOLE — only an explicit `true` counts.
   */
  truncated?: boolean;
  /**
   * `directed` rows only — **WHICH of this operator's agents filed the direction**
   * (F-376a, 2026-08-31): an 8-char agent instance id, not a display name.
   *
   * 🔒 **A CAPTION, AND AN UNVERIFIED ONE. Nothing may gate, filter or authorize on
   * it** (`spa-bridge-shapes.ts › DesktopNarrationEntry.senderAgentId` carries the
   * argument: the server derives it from a header that proves nothing about the
   * caller). It is safe to SHOW only because sender and recipient are the same
   * operator's agents by construction.
   * ⚠ **IT IS AN ID, SO A FACE MUST RESOLVE IT BEFORE RENDERING IT** — an agent id
   * is never printed at a person on this surface (`agent-id-visibility.test.ts`).
   * ⚠ Absent is the ORDINARY case, not unknown: an external orchestrator has no
   * session stamp. The fallback is the anonymous sentence, never a raw id.
   */
  senderAgentId?: string;
  /**
   * `inbound` rows only — **WHO SENT THE MESSAGE THAT WOKE THIS AGENT**, already
   * resolved to words by main (#3081;
   * `spa-bridge-narration.ts › DesktopNarrationEntry.senderName`).
   *
   * 🔒 **A CAPTION, PEER-TYPED, AND UNVERIFIED** — `senderAgentId`'s rule exactly:
   * nothing may gate, filter or authorize on it, and the face neutralizes it as a
   * React text child on a `truncate` line.
   * ⚠ ABSENT IS ORDINARY, not unknown (an older main stamps nothing, and
   * `authorLabel` has its own fallback): the face says the anonymous sentence, never
   * a blank.
   */
  senderName?: string;
  /** `inbound` rows only — the operator's own account sent it (#3081). ⚠ NOT a privacy
   *  claim: the message is in the channel either way, which is why it does not move the
   *  lane. Only an explicit `true` rides through. */
  fromOperator?: boolean;
  /**
   * `inbound` rows only — **WHAT KIND OF AUTHOR WROTE IT** (Samuel, 2026-10-12): `"user"` for a
   * person, `"agent"` for a machine, absent for "cannot say".
   *
   * ⚠ **SERVER-DERIVED FROM THE AUTHOR'S CREDENTIAL** (`main/session-dispatch.js ›
   * feedLiveSession`), never recovered from {@link StreamItem.senderName}, which is peer prose.
   * ⚠ **IT OUTRANKS {@link StreamItem.fromOperator} ON THE BANNER** — that flag folds the
   * operator's own agents into "you", and this face names an agent as an agent.
   * ⚠ ABSENT IS UNKNOWN AND PAINTS NOTHING: the neutral banner, never a human's black.
   */
  authorKind?: "user" | "agent";
  /**
   * `inbound` rows only, and only beside `authorKind: "agent"` — **THE OPERATOR'S NAME FOR THE
   * AGENT THAT WROTE IT** (2026-10-12), so the banner names `@the-agent` rather than
   * *"<person>'s agent"*.
   *
   * 🔒 A CAPTION, PEER-TYPED AND UNVERIFIED — {@link StreamItem.senderName}'s rule exactly.
   * ⚠ ABSENT IS ORDINARY: the face falls back through `senderName` to the anonymous sentence.
   */
  senderAgentName?: string;
  /**
   * `inbound` rows only, beside `authorKind: "agent"` — **THAT AGENT'S IDENTITY COLOUR**, the key
   * its banner is painted with (2026-10-12).
   *
   * ⚠ **ALREADY NARROWED TO ONE OF THE SIXTEEN** by `agent-stream-model.ts` through
   * `lib/agent-colors.ts › agentColorOrNull`, which is why the type is `AgentColorKey` here and a
   * bare `string` on the wire. ⚠ ABSENT IS THE NEUTRAL FACE: an uncoloured agent is legitimate, and
   * a renderer must degrade rather than invent a hue.
   */
  senderColor?: AgentColorKey;
  /**
   * `sent` rows FROM THE TRANSCRIPT only — **WHO THE POST WAS ADDRESSED TO**, as raw
   * ids for the face to resolve (#3081, Samuel: black pills naming the addressees in
   * the box's top bar).
   *
   * ⚠ **IDS, RESOLVED AT RENDER, NEVER FACES STORED ON A ROW** — `lib/recipient-tags.ts`
   * states the rule and the transcript's own tag row follows it, so a rename re-faces
   * history instead of baking a stale name into a stream item.
   * ⚠ **THE RULE FOR WHICH IDS IS NOT THIS FILE'S** — it is `messageTagIds`, the one
   * derivation `view-model-rows.ts` already uses for the transcript's tag row (people
   * from the stamped mention set; agents from `to=` EXCEPT an agent the server picked
   * for an unaddressed post, which was not named). Two spellings of "who did this post
   * address" is how one message comes to show different pills in two panes.
   * ⚠ **ABSENT ON A FRAME-BACKED ROW, AND THAT IS HONEST.** A narration `post` echo
   * carries no addressee at all, so the box draws no pills rather than guessing — the
   * same answer an unaddressed post or a `record` gets.
   */
  tagUserIds?: readonly string[];
  /** See {@link tagUserIds} — the agent half of the same derivation. */
  tagAgentIds?: readonly string[];
}
