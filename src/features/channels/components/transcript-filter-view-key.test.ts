/**
 * **THE TRANSCRIPT CROSS-FADE'S VIEW KEY** (2026-10-10, option I of KB
 * `dopl-development › Channel Switch Latency 2026-10-10`).
 *
 * `FadeSwap` uses this string as a React `key`, so what it names is what a change
 * TEARS DOWN AND REBUILDS. Option I took the CHANNEL ID out of it: with the id in,
 * every switch unmounted the whole transcript subtree — up to a page of rows —
 * and faded the new one in over 140ms, which was a floor on how fast a switch
 * could feel. A switch with the same filter on both sides is a DIFF now.
 *
 * ⚠ **ITS OWN FILE, AND THE REASON IS WHAT THIS COVERS.**
 * `transcript-filter.test.tsx` is the filter's RULE (which rows pass) and is near
 * the cap; `transcript-filter-menu.test.tsx` is the control. Neither reads this
 * function — it had NO test at all, so putting the channel id back, the exact
 * regression option I removes, failed nothing and the 140ms would have come back
 * silently. These cases are that regression's only alarm.
 *
 * ⚠ **A PURE STRING, NO DOM** — `@vitest-environment` is deliberately unset.
 */

import { describe, expect, it } from "vitest";

import {
  TRANSCRIPT_FILTER_ALL,
  TRANSCRIPT_FILTER_PEOPLE,
  agentTranscriptFilter,
  transcriptFilterViewKey,
  type TranscriptFilter,
} from "./transcript-filter";

const CHANNEL_A = "c-1";
const CHANNEL_B = "c-2";

/**
 * The same function seen through the signature a CHANNEL-SCOPED key would have.
 *
 * ⚠ **THE CAST IS THE TEST, NOT A CONVENIENCE.** Inside this pure module a
 * channel id can only arrive as an argument, so "the key is not channel-scoped"
 * is only assertable by OFFERING one and watching the answer not move. Called
 * straight, both sides would read the same whatever the body did with a channel.
 */
const viewKey = transcriptFilterViewKey as (
  filter: TranscriptFilter,
  channelId?: string
) => string;

describe("transcriptFilterViewKey", () => {
  it("🔒 IS EQUAL ACROSS TWO CHANNELS THAT SHARE A FILTER — the switch is a diff, not a remount", () => {
    // 🔒 THE REGRESSION ALARM. The key names the SELECTION only; a channel id in
    // it makes every switch a full teardown of the transcript subtree plus a
    // 140ms fade, and nothing else in the tree would notice.
    expect(viewKey(TRANSCRIPT_FILTER_ALL, CHANNEL_A)).toBe(
      viewKey(TRANSCRIPT_FILTER_ALL, CHANNEL_B)
    );
    expect(viewKey(TRANSCRIPT_FILTER_PEOPLE, CHANNEL_A)).toBe(
      viewKey(TRANSCRIPT_FILTER_PEOPLE, CHANNEL_B)
    );
    expect(viewKey(agentTranscriptFilter("a-7"), CHANNEL_A)).toBe(
      viewKey(agentTranscriptFilter("a-7"), CHANNEL_B)
    );
    // And the blunt alarm: it TAKES one argument. A second parameter is the
    // regression's only possible shape here.
    expect(transcriptFilterViewKey.length).toBe(1);
  });

  it("DIFFERS when `people` differs — a genuine change of what is on screen", () => {
    expect(transcriptFilterViewKey(TRANSCRIPT_FILTER_PEOPLE)).not.toBe(
      transcriptFilterViewKey(TRANSCRIPT_FILTER_ALL)
    );
  });

  it("DIFFERS when `agentIds` differ, including a subset", () => {
    const one = agentTranscriptFilter("a-1");
    const two: TranscriptFilter = { people: false, agentIds: ["a-1", "a-2"] };

    expect(transcriptFilterViewKey(one)).not.toBe(transcriptFilterViewKey(two));
    expect(transcriptFilterViewKey(agentTranscriptFilter("a-2"))).not.toBe(
      transcriptFilterViewKey(one)
    );
    // People + one agent is not the same view as that agent alone.
    expect(
      transcriptFilterViewKey({ people: true, agentIds: ["a-1"] })
    ).not.toBe(transcriptFilterViewKey(one));
  });

  it("is ONE spelling per set — agent ids are sorted, so tick order cannot fade", () => {
    expect(
      transcriptFilterViewKey({ people: true, agentIds: ["a-2", "a-1"] })
    ).toBe(transcriptFilterViewKey({ people: true, agentIds: ["a-1", "a-2"] }));
  });

  it("does not MUTATE the selection it is handed", () => {
    // ⚠ `[...]` before `.sort()`: the filter object is a memo dependency
    // upstream (`message-pane.tsx › visibleRows`), and sorting it in place would
    // reorder a value other readers hold.
    const filter: TranscriptFilter = { people: false, agentIds: ["a-2", "a-1"] };
    transcriptFilterViewKey(filter);
    expect(filter.agentIds).toEqual(["a-2", "a-1"]);
  });
});
