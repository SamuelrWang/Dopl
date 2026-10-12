// @vitest-environment jsdom
/**
 * **WHO WROTE IT, AS A WEIGHT** — the inbound card's author paint and the name it prints
 * (Samuel, 2026-10-12): a HUMAN member's message wears the black banner and a black edge, an
 * AGENT's wears that agent's own identity colour, and an agent is named by its own handle.
 *
 * ⚠ **ITS OWN FILE ON THE 500-LINE CAP**, split off `agent-stream-inbound.test.tsx` the way that
 * file was split off `agent-stream.test.tsx` — and on a seam rather than at an arbitrary cut:
 * that file pins WHICH LANE a frame lands on, how the face reads and which addressee pills it
 * draws; this one pins WHO THE AUTHOR IS and what the card does about it. The units under it are
 * `agent-stream-inbound-box.tsx › inboundLabel` + `› InboundBox`, `agent-stream-model.ts ›
 * buildAgentStream`'s inbound arm, and `lib/agent-mentions.ts › agentNameHandle`.
 *
 * Every property here fails quietly, and two of them fail by saying something FALSE rather than
 * by saying nothing:
 *
 *  - **"you" OVER A MACHINE'S WORDS.** Ruling 2 (2026-09-25) folds the operator's own agents into
 *    `fromOperator`, so their orchestrator's post read back at them as *"Message received from
 *    you"* — their own name over words they never wrote. The ruling is NARROWED for this face
 *    (INVARIANTS §11, 2026-10-12): `authorKind` is read FIRST, and "you" is only for what the
 *    operator typed.
 *  - **A KIND RECOVERED FROM PROSE.** `senderName` is main's already-resolved label and a display
 *    name somebody typed can read *"X's agent"*; sniffing it would let a peer choose how this card
 *    is painted. The kind is server-derived from the author's credential, or it is ABSENT.
 *  - **UNKNOWN PAINTED AS A PERSON.** An older main stamps no kind. Absent must keep the neutral
 *    inset banner, because black here is a claim that a HUMAN member wrote the words.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentStream } from "./agent-stream";
import {
  INBOUND_ANON_LABEL,
  INBOUND_OPERATOR_LABEL,
  inboundLabel,
} from "./agent-stream-inbound-box";
import { buildAgentStream } from "./agent-stream-model";
import type { AgentNarrationEntry } from "./use-agent-narration";

afterEach(cleanup);

/** An `inbound` frame as `main/session-narration.js › entryFor` emits one. */
function inboundFrame(over: Record<string, unknown> = {}): AgentNarrationEntry {
  return {
    at: 1_000,
    kind: "inbound",
    lane: "inbound",
    text: "please review the picker fix",
    senderName: "Diana Taylor",
    ...over,
  } as unknown as AgentNarrationEntry;
}

/** ⚠ THROUGH THE WHOLE STREAM, NOT THE BOX ALONE: the 2026-10-11 defect in this card's family was
 *  a field that rode every layer but the last one, so the wiring is part of every paint case. */
function renderStream(over: Partial<React.ComponentProps<typeof AgentStream>> = {}) {
  return render(<AgentStream entries={[]} supported sent={[]} {...over} />);
}


/**
 * 🔴 **THE BANNER CARRIES THE AUTHOR'S WEIGHT: BLACK FOR A PERSON, THE AGENT'S OWN COLOUR FOR AN
 * AGENT** (Samuel, 2026-10-12). Every property here fails quietly, and two of them fail by saying
 * something FALSE rather than by saying nothing:
 *
 *  - **"you" OVER A MACHINE'S WORDS.** Ruling 2 (2026-09-25) folds the operator's own agents into
 *    `fromOperator`, so their orchestrator's post read back at them as *"Message received from
 *    you"* — their own name over words they never wrote. The ruling is NARROWED for this face:
 *    `authorKind` is read first, and "you" is only for what the operator typed.
 *  - **A KIND RECOVERED FROM PROSE.** `senderName` is main's already-resolved label and a display
 *    name somebody typed can read *"X's agent"*; sniffing it would let a peer choose how this card
 *    is painted. The kind is server-derived from the author's credential or it is ABSENT.
 *  - **UNKNOWN PAINTED AS A PERSON.** An older main stamps no kind. Absent must keep the neutral
 *    inset banner, because black here is a claim that a HUMAN member wrote the words.
 */
describe("the inbound banner's author weight", () => {
  /** The banner strip and the card, by the hook the face exposes for exactly this question. */
  function painted(container: HTMLElement) {
    const card = container.querySelector("[data-stream-inbound]") as HTMLElement | null;
    return {
      weight: card?.getAttribute("data-stream-inbound-paint") ?? null,
      cardStyle: card?.getAttribute("style") ?? "",
      banner: card?.firstElementChild as HTMLElement | null,
    };
  }

  it("names an AGENT by its own handle and never as 'you', even from the operator's account", () => {
    // ⚠ THE NARROWING, IN ONE LINE: same `fromOperator: true` the operator's own typing carries,
    // and the agent is named instead. The handle is `mentionSlug`'s — the form the picker inserts
    // and the mention resolver accepts — so the banner cannot spell one nobody could retype.
    expect(inboundLabel("Sam Wang", true, "agent", "Cleanup Orchestrator")).toBe(
      "Message received from @cleanup-orchestrator"
    );
    expect(inboundLabel("Sam Wang", true, "agent", "Cleanup Orchestrator")).not.toBe(
      INBOUND_OPERATOR_LABEL
    );
    // A PEER's agent reads the same way — the agent is the author either way.
    expect(inboundLabel("Diana Taylor's agent", false, "agent", "Picker Fix")).toBe(
      "Message received from @picker-fix"
    );
  });

  it("degrades through the facts it has, and never to a blank or an id", () => {
    // No agent name: the resolved label is still TRUE, so it is what shows.
    expect(inboundLabel("Sam Wang's agent", true, "agent")).toBe(
      "Message received from Sam Wang's agent"
    );
    expect(inboundLabel("Sam Wang's agent", true, "agent")).not.toBe(INBOUND_OPERATOR_LABEL);
    // Neither one: the anonymous sentence, which is a complete fact.
    expect(inboundLabel(null, true, "agent")).toBe(INBOUND_ANON_LABEL);
    expect(inboundLabel("  ", false, "agent", "   ")).toBe(INBOUND_ANON_LABEL);
    // A name that slugs to nothing is still somebody — printed as given, never as a bare "@".
    expect(inboundLabel(null, false, "agent", "!!!")).toBe("Message received from !!!");
  });

  it("keeps 'you' for what the operator TYPED, and keeps today's answer when the kind is unknown", () => {
    expect(inboundLabel("Sam Wang", true, "user")).toBe(INBOUND_OPERATOR_LABEL);
    expect(inboundLabel("Diana Taylor", false, "user")).toBe("Message received from Diana Taylor");
    // ⚠ ABSENT IS UNKNOWN: an older main's frame must read exactly as it did before this wave.
    expect(inboundLabel("Sam Wang", true)).toBe(INBOUND_OPERATOR_LABEL);
    expect(inboundLabel("Diana Taylor")).toBe("Message received from Diana Taylor");
  });

  it("paints a HUMAN member's message black, banner AND edge, with the on-black ink", () => {
    const { container } = renderStream({
      entries: [inboundFrame({ senderName: "Diana Taylor", authorKind: "user" })],
    });
    const { weight, cardStyle, banner } = painted(container);
    expect(weight).toBe("human");
    // ⚠ THE TOKEN, NOT A HEX — docs/DESIGN-SYSTEM.md forbids a colour value in a component, and
    // `--surface-cta` is the one black this tree has (`globals.css` aliases `--black` to it).
    expect(cardStyle).toContain("var(--surface-cta)");
    expect(banner?.getAttribute("style")).toContain("var(--surface-cta)");
    // ⚠ BOTH HALVES: the banner may not keep the inset fill it is painted over...
    expect(banner?.className).not.toContain("bg-bg-inset");
    // ...and the label must wear the ink that reads on black.
    expect(banner?.querySelector("span")?.className).toContain("text-text-on-cta");
  });

  it("leaves an UNKNOWN author kind on the neutral face — black is a claim about a person", () => {
    const { container } = renderStream({ entries: [inboundFrame()] });
    const { weight, cardStyle, banner } = painted(container);
    expect(weight).toBe("neutral");
    expect(cardStyle).toBe("");
    expect(banner?.className).toContain("bg-bg-inset");
    expect(banner?.querySelector("span")?.className).toContain("text-text-secondary");
  });

  it("paints an AGENT's message in that agent's own colour, never in the human's black", () => {
    // ⚠ THE COLOUR THE READER HAS ALREADY BEEN TAUGHT — the key that agent's avatar, its
    // transcript accent and its own posted banner wear (docs/specs/agent-colors.md item 5).
    const { container } = renderStream({
      entries: [
        inboundFrame({
          senderName: "Sam Wang",
          fromOperator: true,
          authorKind: "agent",
          senderAgentName: "Cleanup Orchestrator",
          senderColor: "agent-03",
        }),
      ],
    });
    const { weight, cardStyle, banner } = painted(container);
    expect(weight).toBe("agent");
    // ⚠ THROUGH THE ONE PAINT ROUTE (`lib/agent-colors.ts › agentColorVar`) — a key becomes a
    // `var()` in exactly one place, and no hex ever reaches a component.
    expect(cardStyle).toContain("var(--agent-color-03)");
    expect(banner?.getAttribute("style")).toContain("var(--agent-color-03)");
    // ⚠ AND IT IS NOT THE HUMAN'S BLACK: that fill is this surface's claim that a PERSON wrote it.
    expect(cardStyle).not.toContain("var(--surface-cta)");
    // The ink is the badge's own decision, which every one of the sixteen dark ramps shares.
    expect(banner?.querySelector("span")?.className).toContain("text-text-on-cta");
  });

  it("leaves an UNCOLOURED agent neutral rather than borrowing the human's black", () => {
    // A seventeenth live agent in one room runs with no key (`lib/agent-colors.ts`), and an older
    // server sends none at all. Both must degrade, and neither may be painted as a person.
    for (const over of [{}, { senderColor: "agent-99" }, { senderColor: "" }]) {
      cleanup();
      const { container } = renderStream({
        entries: [
          inboundFrame({ authorKind: "agent", senderAgentName: "Merge Owner", ...over }),
        ],
      });
      const { weight, cardStyle, banner } = painted(container);
      expect(weight).toBe("neutral");
      expect(cardStyle).toBe("");
      expect(banner?.className).toContain("bg-bg-inset");
    }
  });

  it("carries the kind onto the item lane-gated, and drops a spelling it does not know", () => {
    const [item] = buildAgentStream({
      entries: [
        inboundFrame({ authorKind: "agent", senderAgentName: "Cleanup Orchestrator" }),
      ],
      sent: [],
    });
    expect(item.authorKind).toBe("agent");
    expect(item.senderAgentName).toBe("Cleanup Orchestrator");
    // ⚠ AN UNKNOWN VALUE IS ABSENT, NOT PASSED THROUGH: the face must see "cannot say".
    const [odd] = buildAgentStream({
      entries: [inboundFrame({ authorKind: "system" })],
      sent: [],
    });
    expect("authorKind" in odd).toBe(false);
    // ⚠ AND AN AGENT NAME NEVER RIDES A ROW THE FACE WOULD READ AS A PERSON'S.
    const [human] = buildAgentStream({
      entries: [inboundFrame({ authorKind: "user", senderAgentName: "Cleanup Orchestrator" })],
      sent: [],
    });
    expect("senderAgentName" in human).toBe(false);
    // ⚠ NOR A LANE WITH NOWHERE TO PUT IT — `senderName`'s rule, one case per field.
    const [thinking] = buildAgentStream({
      entries: [
        { at: 1, kind: "assistant", text: "x", authorKind: "user" } as unknown as AgentNarrationEntry,
      ],
      sent: [],
    });
    expect("authorKind" in thinking).toBe(false);
  });

  it("🔒 narrows the colour key at ONE boundary, so an unknown one can never reach a `var()`", () => {
    const [ok] = buildAgentStream({
      entries: [inboundFrame({ authorKind: "agent", senderColor: "agent-16" })],
      sent: [],
    });
    expect(ok.senderColor).toBe("agent-16");
    // ⚠ EVERY NEAR-MISS IS ABSENT, not passed through: `var(--agent-color-99)` resolves to nothing
    // and paints an INVISIBLE banner, which is worse than the neutral face it replaced.
    for (const bad of ["agent-99", "agent-3", "AGENT-03", "", "red", "var(--x)", 3]) {
      const [item] = buildAgentStream({
        entries: [inboundFrame({ authorKind: "agent", senderColor: bad })],
        sent: [],
      });
      expect("senderColor" in item, `unknown key must not ride: ${String(bad)}`).toBe(false);
    }
    // ⚠ AND A COLOUR NEVER RIDES A HUMAN'S ROW — the kind gate, same as the name's.
    const [human] = buildAgentStream({
      entries: [inboundFrame({ authorKind: "user", senderColor: "agent-03" })],
      sent: [],
    });
    expect("senderColor" in human).toBe(false);
  });

  it("🔒 THREADS the kind from the item to the face", () => {
    // The 2026-10-11 defect in this file's §1 was a field that rode every layer but the last one.
    renderStream({
      entries: [
        inboundFrame({
          senderName: "Sam Wang",
          fromOperator: true,
          authorKind: "agent",
          senderAgentName: "Cleanup Orchestrator",
        }),
      ],
    });
    expect(screen.getByText("Message received from @cleanup-orchestrator")).toBeTruthy();
    expect(screen.queryByText(INBOUND_OPERATOR_LABEL)).toBeNull();
  });
});
