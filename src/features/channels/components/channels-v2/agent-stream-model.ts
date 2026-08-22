"use client";

/**
 * WHAT ONE AGENT HAS BEEN DOING, AS ONE ORDERED LIST — the pure half of the work
 * stream both agent surfaces render (Samuel, 2026-08-22: the slide-out panel
 * graduates from a Sent-lane to the full stream).
 *
 * ⚠ FOUR THINGS SHARE ONE COLUMN, AND THEY ARE NOT THE SAME KIND OF THING. The
 * agent's own reasoning, the tools it ran, what it POSTED into the channel, and
 * the private 1:1 traffic between it and its operator. Only the third is public;
 * the first two are local to this machine and reach nobody; the fourth is
 * deliberately out of band (`main/session-seed.js › frameOperatorTurn` tells the
 * agent so). Rendering them alike is how an operator comes to believe the
 * counterparty saw a private steer.
 *
 * ⚠ THE `kind` VOCABULARY IS MAIN'S AND IS STILL GROWING. `session-narration.js ›
 * entryFor` owns it, and the desktop is adding distinguishable kinds as this
 * lands. **So the mapping below is an ALIAS TABLE with a fallback, not a switch
 * over a closed set** — an unrecognised kind renders as a plain note carrying its
 * own text, never as a crash and never as a dropped line. A stream that silently
 * loses frames is worse than one that renders a frame plainly: the operator is
 * reading this to find out what happened.
 *
 * ⚠ AND AN OLDER MAIN'S FRAMES STILL WORK UNCHANGED. `assistant` / `tool` /
 * `result` / `post` / `status` are the five that exist today; every one of them
 * has a row here, so a build that emits nothing new renders exactly what it
 * rendered before this file existed.
 */

import type { AgentNarrationEntry } from "./use-agent-narration";
import type { ChannelMessage } from "../../types";

/**
 * THE LANES A STREAM ROW CAN BE IN.
 *
 * `thinking` the agent's own words · `tool` a command it ran · `sent` what it
 * POSTED into the channel · `operator` something I said to it privately ·
 * `private` its private answer to me · `note` a status line, or a frame this
 * build does not recognise.
 */
export type StreamLane =
  | "thinking"
  | "tool"
  | "sent"
  | "operator"
  | "private"
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
  if (lane === "private") return "private";
  if (lane === "operator") return "operator";
  if (lane === "channel" || lane === "sent") return "sent";
  const kind = typeof entry.kind === "string" ? entry.kind.toLowerCase() : "";
  return LANE_BY_KIND[kind] ?? "note";
}

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
  /** `sent` rows only — where it went, for the box's banner. */
  to?: string | null;
}

/** ISO → epoch ms, or 0 for an unparseable stamp. ⚠ 0 SORTS FIRST rather than
 *  dropping the row: a message with a bad timestamp is still a message. */
function epoch(iso: string): number {
  const ts = new Date(iso).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * THE STREAM, IN TIME ORDER.
 *
 * ⚠ THE TRANSCRIPT IS THE RECORD OF A POST; THE NARRATION FRAME IS A LOCAL ECHO
 * OF IT. Both describe the same act, so `sent` FRAMES ARE DROPPED whenever real
 * transcript rows are supplied — otherwise every post appears twice, once as a
 * box and once as a line, and the reader has no way to know it is one event. The
 * transcript row wins because it is the thing that actually exists on the server:
 * it has an id, the stored body, and a timestamp everybody agrees on.
 *
 * ⚠ WITH NO TRANSCRIPT ROWS THE FRAMES ARE KEPT. A surface that has narration and
 * no messages read (or a post that has not landed in the transcript yet) would
 * otherwise show an agent that thinks and runs tools and never says anything.
 *
 * ⚠ `null` ENTRIES ARE "COULD NOT ASK" AND ARE NOT `[]`. This function takes the
 * distinction as given and simply builds from what it has; the CALLER words the
 * two absences differently (INVARIANTS §11 — UNKNOWN is not EMPTY).
 *
 * ⚠ STABLE SORT, BY TIME ONLY. Frames and messages interleave, and within one
 * timestamp the input order is the desktop's own — re-ordering it would be this
 * file claiming to know better than the machine that watched it happen.
 */
export function buildAgentStream({
  entries,
  sent,
  threadTitle,
}: {
  entries: readonly AgentNarrationEntry[] | null;
  sent: readonly ChannelMessage[];
  /** Where a post went, for the sent box's banner. */
  threadTitle?: string | null;
}): StreamItem[] {
  const hasTranscript = sent.length > 0;
  const items: StreamItem[] = [];

  (entries ?? []).forEach((entry, i) => {
    const lane = frameLane(entry);
    if (lane === "sent" && hasTranscript) return;
    items.push({
      key: `f:${entry.at}:${i}`,
      lane,
      at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : 0,
      text: entry.text ?? "",
      tool: entry.tool,
      ok: entry.ok,
      to: lane === "sent" ? (threadTitle ?? null) : undefined,
    });
  });

  for (const message of sent) {
    items.push({
      key: `m:${message.id}`,
      lane: "sent",
      at: epoch(message.createdAt),
      text: message.body,
      to: threadTitle ?? null,
    });
  }

  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.at - b.item.at || a.i - b.i)
    .map(({ item }) => item);
}

/** `mcp__dopl__dopl_channel` → `dopl_channel`. ⚠ The segment after the LAST `__`,
 *  which is the rule `main/mcp-tool-names.js › mcpShortName` states: the server
 *  segment is the CLIENT's to choose and has never been ours to assume (F-139). */
export function shortToolName(name: string | undefined): string {
  if (!name) return "runs";
  return name.replace(/^mcp__.*__/i, "") || "runs";
}
