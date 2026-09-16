"use client";

/**
 * WHICH LANE A NARRATION FRAME IS IN — the stream's whole reading of main's
 * vocabulary, and nothing else (§1 split out of `agent-stream-model.ts`,
 * 2026-08-31).
 *
 * ⚠ THE SEAM IS "ONE FILE, ONE REASON TO CHANGE", not the line count that forced
 * the question. **This file moves when THE DESKTOP's `kind` / `lane` vocabulary
 * moves** — `main/session-narration.js › entryFor` is still growing members, and
 * every one of them is a row here and nothing anywhere else. `agent-stream-model.ts`
 * moves when the STREAM's own arithmetic moves: the post/echo dedupe, the held-draft
 * join, the TTL, the tool-run grouping — none of which has ever cared what a kind
 * is called. Two clocks, and until now one file.
 *
 * ⚠ IT MOVED VERBATIM and is RE-EXPORTED from `agent-stream-model.ts`, which stays
 * the import path of record — no importer changed, and a second canonical path for
 * one symbol is how two call sites come to disagree about which is authoritative.
 *
 * ⚠ THE FILE IS PURE AND TAKES ONE TYPE-ONLY IMPORT. It is the half of the stream
 * that can be reasoned about with no messages, no consent rows and no clock.
 */

import type { AgentNarrationEntry } from "./use-agent-narration";

/**
 * THE LANES A STREAM ROW CAN BE IN.
 *
 * `thinking` the agent's own words · `tool` a command it ran · `sent` what it
 * POSTED into the channel · `operator` something I said to it privately ·
 * `private` its private answer to me · `directed` **another of my agents said it
 * to this one** · `directed-reply` **this agent's answer to that** · `note` a
 * status line, or a frame this build does not recognise.
 *
 * ⚠ THE TWO DIRECTED LANES ARE SPLIT HERE WHERE THE WIRE KEEPS THEM TOGETHER
 * (2026-08-31, F-366's operator half). Main tags both `lane: 'directed'` and
 * tells them apart by `kind` — correct on the wire, where a lane is a statement
 * about AUDIENCE and both are equally private. This surface is not asking about
 * audience: Samuel's ruling is that an operator must be able to scan **who sent
 * what to whom**, which is a question about the SPEAKER, so the direction gets a
 * lane of its own rather than a flag the renderer has to remember to read.
 */
export type StreamLane =
  | "thinking"
  | "tool"
  | "sent"
  | "operator"
  | "private"
  | "directed"
  | "directed-reply"
  | "note";

/**
 * ⚠ ONE KIND, SEVERAL SPELLINGS, ON PURPOSE. Main and this tree ship separately,
 * so a kind can land on the wire before this file has heard of it and vice versa.
 * Each lane therefore accepts every spelling the desktop plausibly emits for it,
 * and anything unmatched falls to `note` — which still renders its text. Adding a
 * kind is adding a row here; it is never a code change anywhere else.
 */
const LANE_BY_KIND: Record<string, StreamLane> = {
  // The five that exist today (`session-narration.js › entryFor`).
  assistant: "thinking",
  tool: "tool",
  result: "tool",
  post: "sent",
  status: "note",
  // The vocabulary the desktop is growing as this lands.
  thinking: "thinking",
  step: "thinking",
  command: "tool",
  tool_use: "tool",
  tool_result: "tool",
  sent: "sent",
  posted: "sent",
  operator: "operator",
  steer: "operator",
  user: "operator",
  private: "private",
  reply: "private",
  // The private DIRECT lane (2026-08-31, `session-narration.js › entryFor` /
  // `› retagDirected`). ⚠ Rows here as well as in `frameLane`'s explicit branch:
  // the branch reads main's `lane`, and this covers a build that emits the kind
  // without one. Neither spelling may fall to `note`, which renders a direction
  // as an anonymous log line.
  directed: "directed",
  "directed-reply": "directed-reply",
};

/**
 * WHICH LANE THIS FRAME BELONGS IN.
 *
 * ⚠ `lane` WINS OVER `kind` WHEN MAIN SENDS ONE. An explicit lane is a statement
 * about audience — public post vs private steer — and audience is the one thing
 * this surface must not infer wrongly. `kind` describes the shape of the event;
 * when the two disagree, the one that says who can SEE it decides.
 * ⚠ Both are read defensively: neither is declared on the entry type, because the
 * wire is the DESKTOP's to widen and this side must survive either version.
 */
export function frameLane(entry: AgentNarrationEntry): StreamLane {
  const raw = entry as AgentNarrationEntry & { lane?: unknown };
  const lane = typeof raw.lane === "string" ? raw.lane.toLowerCase() : "";
  const kind = typeof entry.kind === "string" ? entry.kind.toLowerCase() : "";
  // ⚠ ONE WIRE LANE, TWO FACES, AND THE `kind` IS WHAT SPLITS THEM (2026-08-31).
  // This is the ONE place `kind` is consulted inside a `lane` branch, and it does
  // not weaken the precedence above it: the lane has already decided AUDIENCE
  // (private, and to this operator alone) and both kinds agree about it. What
  // `kind` decides here is only WHICH VOICE spoke — the thing the operator opened
  // this stream to scan. ⚠ ANYTHING ELSE ON THIS LANE IS THE INBOUND FACE, not
  // `note`: an unrecognised `directed` kind is still a direction, and the honest
  // degradation is the box that claims LESS (somebody said this TO the agent),
  // never an anonymous log line.
  if (lane === "directed") {
    return kind === "directed-reply" ? "directed-reply" : "directed";
  }
  if (lane === "private") return "private";
  if (lane === "operator") return "operator";
  if (lane === "channel" || lane === "sent") return "sent";
  return LANE_BY_KIND[kind] ?? "note";
}

/**
 * 🔒 **MAIN'S OWN END NOTICE, LIFTED OUT OF THE LOG SO THE WINDOW CAN WEAR IT AS A BADGE**
 * (Samuel, 2026-09-15: *"You see 'Ended by you.' Have 'Ended by you' be that black badge, right?
 * 'Ended by you' should be the badge, and then there won't have to be a badge on the top right
 * anymore."*).
 *
 * ⚠ **WHAT HE WAS POINTING AT IS A `status` FRAME, NOT A FOOTER THAT EXISTED.** `main/
 * session-narration.js › noteEnded` pushes one line when a session ends, worded by
 * `main/session-effects.js › endedStatusText` ("Ended by you" / "Ended after going inactive" /
 * "Ended because a person joined this channel" / "Ended after being left parked"), and it lands in
 * the `note` lane as the last muted row of the stream. So the badge's WORDS are already on the
 * wire; what this does is take that one row out of the scrolling log and hand it to the window.
 *
 * ⚠ **IT MATCHES ON MAIN'S TEXT, WHICH IS A KNOWN COST AND THE SAME ONE `agent-stream-model.ts ›
 * GATE_NOTE` ALREADY PAYS** — read that constant's note for the argument. **It fails in the safe
 * direction:** an end notice this predicate does not recognise (a future reason, or
 * `endedStatusText`'s raw-reason fallback, which returns the bare word for a reason its table has
 * not learned) simply stays in the log as the muted line it is today. Nothing is ever hidden
 * without being shown somewhere else.
 *
 * ⚠ **AND IT IS A PREFIX RATHER THAN THE FOUR SENTENCES**, because the four are main's to reword
 * and "Ended…" is the shape all of them share. Listing them here would be a second copy of that
 * table — the defect `agent-bits.tsx` opens with.
 */
const END_NOTE_PREFIX = "Ended";

/**
 * SPLIT ONE END NOTICE OFF THE FEED — `{ entries, endNote }`.
 *
 * ⚠ **THE LAST MATCH WINS AND EVERY MATCH IS REMOVED.** A retained ring can hold an earlier end
 * (a reopened key), and two black pills for one agent is exactly the doubling the badge's own
 * docblock refuses. The newest is the one that describes the agent on screen.
 * ⚠ **`null` IN IS `null` OUT** — "could not ask" is not "no end notice", and collapsing the two
 * here would make a browser render the window as a live agent's (INVARIANTS §11).
 * ⚠ **IT ALLOCATES NOTHING WHEN THERE IS NO END**, which is every live agent on a surface that
 * re-renders at telemetry rate: the array identity is returned unchanged so the stream's own
 * memos do not invalidate.
 */
export function splitEndNote(entries: AgentNarrationEntry[] | null): {
  entries: AgentNarrationEntry[] | null;
  endNote: string | null;
} {
  if (!entries) return { entries, endNote: null };
  let endNote: string | null = null;
  for (const entry of entries) {
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (text.startsWith(END_NOTE_PREFIX) && frameLane(entry) === "note") endNote = text;
  }
  if (endNote === null) return { entries, endNote: null };
  return {
    entries: entries.filter((entry) => {
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      return !(text.startsWith(END_NOTE_PREFIX) && frameLane(entry) === "note");
    }),
    endNote,
  };
}
