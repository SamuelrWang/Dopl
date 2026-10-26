// @vitest-environment jsdom
/**
 * MY OWN AGENTS' ACTIVITY ROWS above the composer (Samuel, 2026-08-25).
 *
 * The properties that fail quietly:
 *
 *  - **AN INDICATOR IS A POSITIVE CLAIM.** "Could not ask" (`null` sessions — a
 *    plain browser, or a main without the feed) must render NOTHING, not an
 *    empty-but-present strip and certainly not a row. INVARIANTS §11: UNKNOWN is
 *    not EMPTY.
 *  - **AN IDLE AGENT IS NOT A WORKING ONE.** It is listening, and a row for it
 *    would be a permanent band over every channel that has ever launched one.
 *  - **THE SCOPE TRACKS THE COMPOSER.** A thread-scoped composer must not
 *    advertise an agent working on a different thread of the same channel — the
 *    reader would wait for a reply that is not coming to the transcript they are
 *    looking at.
 *  - **THE NAME IS THE POINT.** These are the operator's own agents, renameable,
 *    and a row that keeps saying `#ab12` after a rename is a row about
 *    somebody they no longer recognise.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  AgentActivityRows,
  agentActivityText,
  ownAgentsWorking,
} from "./agent-activity";
import { CHANNEL_ID } from "./test-fixtures";

afterEach(cleanup);

const THREAD = "t-1";

function session(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    threadId: THREAD,
    agentId: "ab12cd34",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

describe("ownAgentsWorking — what the strip is allowed to claim", () => {
  it("takes a WORKING agent in this channel", () => {
    expect(ownAgentsWorking([session()], CHANNEL_ID)).toHaveLength(1);
  });

  it("leaves out idle and ended agents", () => {
    // ⚠ `idle` is LISTENING, not working. A row for it never clears, because
    // nothing about listening ends.
    const agents = ownAgentsWorking(
      [session({ sessionId: "s-i", state: "idle" }), session({ sessionId: "s-e", state: "ended" })],
      CHANNEL_ID
    );
    expect(agents).toHaveLength(0);
  });

  it("leaves out another channel's agent", () => {
    expect(
      ownAgentsWorking([session({ channelId: "ch-other" })], CHANNEL_ID)
    ).toHaveLength(0);
  });

  it("narrows to the OPEN THREAD when the composer is thread-scoped", () => {
    // ⚠ The row sits above the composer, so its scope has to be the composer's:
    // advertising a sibling thread's agent makes the reader wait on a transcript
    // they are not looking at.
    const agents = [session(), session({ sessionId: "s-2", threadId: "t-2" })];
    expect(ownAgentsWorking(agents, CHANNEL_ID, THREAD)).toHaveLength(1);
    expect(ownAgentsWorking(agents, CHANNEL_ID, THREAD)[0].threadId).toBe(THREAD);
  });

  it("shows the whole CHANNEL's agents when the composer is not thread-scoped", () => {
    const agents = [session(), session({ sessionId: "s-2", threadId: "t-2" })];
    expect(ownAgentsWorking(agents, CHANNEL_ID, null)).toHaveLength(2);
  });

  it("claims NOTHING when the feed could not be asked", () => {
    // ⚠ `null` is a plain browser or an older main — NOT an idle machine.
    expect(ownAgentsWorking(null, CHANNEL_ID)).toHaveLength(0);
  });
});

describe("the rows themselves", () => {
  it("renders one working agent, named", () => {
    // ⚠ **THE UNNAMED FACE IS `New Agent` SINCE 2026-09-15** (Samuel: *"if a user launches an
    // agent with no name, just give it the name, New Agent"*). It read `#ab12cd34` — the raw
    // instance id — which is the leak `shared/lib/agent-name.ts` removes; the next case names
    // its two agents, because that is how the product now tells two rows apart.
    render(<AgentActivityRows agents={ownAgentsWorking([session()], CHANNEL_ID)} />);
    expect(screen.getByText("New Agent")).toBeTruthy();
  });

  it("STACKS two, one row each — never a count", () => {
    // ⚠ Samuel's ruling: these are the operator's own agents and they have names.
    // Collapsing to "2 agents are working…" (which the PEER row does, because it
    // cannot say anything useful about which) throws that away.
    render(
      <AgentActivityRows
        agents={ownAgentsWorking(
          [
            session({ displayName: "Scout" }),
            session({ sessionId: "s-2", agentId: "zz99yy88", displayName: "Rover" }),
          ],
          CHANNEL_ID
        )}
      />
    );
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(screen.getByText("Rover")).toBeTruthy();
    expect(screen.queryByText(/2 agents/)).toBeNull();
  });

  it("renders NOTHING at all when nobody is working", () => {
    // ⚠ Not an empty strip: this band sits directly above the composer and a
    // permanent blank one is chrome every channel pays for forever.
    const { container } = render(<AgentActivityRows agents={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("reflects a RENAME, because the name comes from the feed", () => {
    // `agentDisplayName` prefers the operator's own `displayName` over the id.
    render(
      <AgentActivityRows
        agents={ownAgentsWorking([session({ displayName: "Scout" })], CHANNEL_ID)}
      />
    );
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(screen.queryByText(/#ab12cd34/)).toBeNull();
  });

  it("says the same word the PEER row says", () => {
    // ⚠ One vocabulary for "this agent is busy" across both lanes. The finer
    // local signal (`agentDetailLabel`) belongs on the cards, not on a caption
    // that would flicker once per tool call.
    // 🔒 **THE WORDS ARE GONE (Samuel, 2026-09-20: *"remove the is working… just
    // have it be the flashing dot and the name of the agent"*).** The pulse is the
    // working signal; the sentence repeated it once per agent, and the strip is
    // inline at the end of the recipient line now, where that is the difference
    // between fitting and eliding.
    expect(agentActivityText(session())).toBe("New Agent");
    expect(agentActivityText(session())).not.toMatch(/working/);
  });
});

/**
 * **THE PILL (Samuel, 2026-10-10: *"No dot. Agent name inside a pill; pill background
 * = the agent's dot color"*).**
 *
 * What fails quietly here, and is therefore what is asserted:
 *  - **A COLOUR THAT STOPS BEING THE FILL.** The hue is the only thing saying WHICH
 *    agent; painted on the wrong element it is decoration.
 *  - **A FALLBACK THAT PUTS WHITE ON NEAR-WHITE.** The old neutral was a DOT's
 *    hairline tint. As a pill fill it is unreadable and nothing would throw.
 *  - **A PILL THAT WILL NOT SHRINK.** `AGENT_PILL_FACE` ships `shrink-0`; three
 *    pills on the recipient line have to elide, and the override is a
 *    tailwind-merge behaviour, i.e. exactly the kind of thing that breaks on a
 *    dependency bump with no error.
 */
describe("the pill", () => {
  const PAINT = "var(--agent-color-07)";

  function renderOne(colors?: ReadonlyMap<string, string>) {
    render(
      <AgentActivityRows
        agents={ownAgentsWorking([session({ displayName: "Scout" })], CHANNEL_ID)}
        colors={colors ?? null}
      />
    );
    return screen.getByRole("status");
  }

  it("wears the agent's colour as its own BACKGROUND", () => {
    const pill = renderOne(new Map([["ab12cd34", PAINT]]));
    // ⚠ The element carrying the name is the element carrying the fill — that is the
    // whole change from a dot beside it, so it is asserted on ONE node.
    expect(pill.textContent).toContain("Scout");
    expect(pill.style.backgroundColor).toBe(PAINT);
  });

  it("carries NO dot any more", () => {
    const pill = renderOne(new Map([["ab12cd34", PAINT]]));
    // `rounded-full` was the dot's shape and nothing else here is round.
    expect(pill.querySelector(".rounded-full")).toBeNull();
    // The pulse moved into the ellipsis; no stock `animate-pulse` survives.
    expect(pill.querySelector(".animate-pulse")).toBeNull();
  });

  it("falls back to the CTA face — never to the dot's hairline neutral", () => {
    const pill = renderOne();
    // ⚠ NO inline style at all, so the face's own `bg-surface-cta` shows through.
    // `bg-border-strong` here would be white ink on a 12%-black tint.
    expect(pill.style.backgroundColor).toBe("");
    expect(pill.className).toContain("bg-surface-cta");
    expect(pill.className).not.toContain("bg-border-strong");
  });

  it("keeps the pill SHRINKABLE, so three of them elide", () => {
    const pill = renderOne(new Map([["ab12cd34", PAINT]]));
    const classes = pill.className.split(/\s+/);
    expect(classes).toContain("shrink");
    // ⚠ The face's `shrink-0` must have been MERGED AWAY, not merely out-ordered.
    expect(classes).not.toContain("shrink-0");
  });
});

/**
 * **THE CYCLING ELLIPSIS — four frames, "." → ".." → "..." → blank.**
 *
 * ⚠ **THE FRAMES THEMSELVES ARE CSS AND jsdom RUNS NO ANIMATION**, so what is testable
 * here is the STRUCTURE the frames need: three dots that are always in layout (which is
 * what reserves the width and stops the pill jittering), hidden from the accessibility
 * tree, and hooked to the stylesheet by class. The frame timing lives in
 * `globals.css › .working-dots` / `kit.css` and the reduced-motion arm with it — this
 * pins the contract between them.
 */
describe("the working dots", () => {
  function dots() {
    render(
      <AgentActivityRows
        agents={ownAgentsWorking([session({ displayName: "Scout" })], CHANNEL_ID)}
      />
    );
    return screen.getByRole("status").querySelector(".working-dots");
  }

  it("renders THREE dots, all present, so the width is reserved", () => {
    const el = dots();
    expect(el).not.toBeNull();
    // ⚠ THREE SPANS ALWAYS IN THE TREE. The cycle is `opacity`, so a frame showing one
    // dot still occupies three — mount-time absence would mean a resizing pill.
    expect(el?.querySelectorAll("span")).toHaveLength(3);
    expect(el?.textContent).toBe("...");
  });

  it("sits immediately after the name with NO separator", () => {
    render(
      <AgentActivityRows
        agents={ownAgentsWorking([session({ displayName: "Scout" })], CHANNEL_ID)}
      />
    );
    // ⚠ Samuel: *"Right after the name, NO space"*. A flex `gap` on the pill or a text
    // node between the two would both read as "Scout ..." and both are invisible in a
    // class assertion, so the rendered TEXT is what is checked.
    expect(screen.getByRole("status").textContent).toBe("Scout...");
  });

  it("is hidden from the accessibility tree", () => {
    // The live region announces the agent; three periods read aloud are noise.
    expect(dots()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not shrink away when the name is long", () => {
    // The name clips; the dots are the fixed half of the pill.
    expect(dots()?.className).toContain("shrink-0");
  });
});

/**
 * **SIX DOTS — THE NAME'S STATIC `…` PLUS THE THREE ANIMATED ONES** (Samuel,
 * 2026-10-12: *"a long name truncates with a static `…`, and the working animation
 * adds three animated dots, so six dots show … drop the static ellipsis and clip
 * cleanly, so the animated dots are the only dots"*).
 *
 * ⚠ **jsdom LAYS NOTHING OUT, so the overflow itself is not observable here** — a long
 * name does not actually overflow a zero-width box and no `…` is ever painted. What IS
 * observable, and what decides the painted result in a real browser, is the
 * `text-overflow` the name span carries. So the assertions are on that declaration,
 * which is also the only thing a regression would change.
 * ⚠ **THE TWO HALVES ARE ASSERTED TOGETHER ON PURPOSE.** The naive fix is
 * `cn("truncate", "text-clip")`, and tailwind-merge resolves that to `text-clip` ALONE —
 * same group — which drops `overflow-hidden` and `whitespace-nowrap` and wraps the pill
 * to two lines. A test that only checked for the absence of the ellipsis would pass on
 * that, so the presence of the other two is checked in the same case.
 */
describe("the name's overflow", () => {
  function pill(displayName: string) {
    render(
      <AgentActivityRows agents={ownAgentsWorking([session({ displayName })], CHANNEL_ID)} />
    );
    return screen.getByRole("status");
  }

  /** The element holding the name — the dots' own span is the other child. */
  function nameEl(displayName: string): HTMLElement {
    const el = pill(displayName);
    const name = [...el.querySelectorAll("span")].find(
      (s) => s.textContent === displayName
    );
    expect(name).toBeDefined();
    return name as HTMLElement;
  }

  const LONG = "Composer Polish Working Agent With A Very Long Name";

  it("CLIPS the name instead of eliding it", () => {
    const classes = nameEl(LONG).className.split(/\s+/);
    // ⚠ The whole ruling: no second ellipsis immediately before three animated dots.
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("text-ellipsis");
    expect(classes).toContain("text-clip");
  });

  it("still clips on ONE line — the overflow and the nowrap survive", () => {
    const classes = nameEl(LONG).className.split(/\s+/);
    // ⚠ What `cn("truncate","text-clip")` would have silently deleted.
    expect(classes).toContain("overflow-hidden");
    expect(classes).toContain("whitespace-nowrap");
    expect(classes).toContain("min-w-0");
  });

  it("leaves the STRIP's own pill-level `…` alone", () => {
    // ⚠ A long row still drops a whole pill with an ellipsis (2026-09-20). Only the
    // ellipsis INSIDE a pill went; the one BETWEEN pills is a different ruling.
    const strip = pill(LONG).parentElement;
    expect(strip?.className.split(/\s+/)).toContain("truncate");
  });

  it("keeps the dots as the pill's only dots", () => {
    const el = pill(LONG);
    // The rendered text is the name then exactly three periods — no `…` between them.
    expect(el.textContent).toBe(`${LONG}...`);
    expect(el.textContent).not.toContain("…");
  });
});
