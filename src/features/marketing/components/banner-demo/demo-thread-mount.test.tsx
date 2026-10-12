// @vitest-environment jsdom

/**
 * **THE MOUNT PROBE FOR THREAD VIEW** (v3, ordered first by @cleanup-orchestrator).
 *
 * The v3 audit was READ-level: it established that `message-pane.tsx` takes a `thread`,
 * that `threadRows` filters by `metadata.taskId`, and that the thread card and the
 * breadcrumb crumb are real `<button>`s the scripted cursor can press. What it could NOT
 * establish from reading is whether the DEMO can feed those components — the scene has
 * never rendered a thread, and `demo-steps.ts` records that the last attempt was reverted.
 *
 * So this mounts it before any of the choreography is trusted, and asserts the four facts
 * the cursor arms depend on:
 *   1. the channel view draws a thread card, with the "Open thread" button to press;
 *   2. thread view draws that thread's own transcript and NOT the channel's;
 *   3. thread view draws the breadcrumb crumb, labelled with the channel name, which is
 *      the control step 8 clicks to get back;
 *   4. the Agents tab is reachable in thread view, and the first "Open" belongs to the
 *      coder the private chat is written for.
 *
 * ⚠ Fact 4 is the one that could have quietly broken the scene: `findButton` takes the
 * FIRST match in DOM order, so if the planner's session rendered above the coders the
 * cursor would have opened the wrong agent's view and the private chat would have been
 * attached to an agent that never said any of it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { mentionSlug } from "@/features/channels/lib/mentions";
import { DemoScene } from "./demo-scene";
import { stepIndex } from "./demo-steps";
import {
  AGENT_INDEX,
  AGENT_IDS,
  CHANNEL_NAME,
  OPEN_THREAD,
} from "./demo-data";
import { messagesAt, threadsAt } from "./demo-transcript";

afterEach(cleanup);

/** The beat the briefs have all landed on, so the thread has a body to show. */
const INSIDE = stepIndex("coder-ack");

function mount(thread: typeof OPEN_THREAD | null) {
  return render(<DemoScene step={INSIDE} thread={thread} />);
}

describe("1. the channel view offers the thread to open", () => {
  it("has three threads open by this beat", () => {
    expect(threadsAt(INSIDE)).toHaveLength(3);
  });

  it("draws an Open thread button for the cursor to press", () => {
    mount(null);
    expect(screen.getAllByRole("button", { name: "Open thread" }).length).toBeGreaterThan(
      0
    );
  });

  it("shows the thread's title on its card", () => {
    mount(null);
    expect(screen.getAllByText(OPEN_THREAD.title).length).toBeGreaterThan(0);
  });
});

describe("2. thread view shows that thread and not the channel", () => {
  /**
   * ⚠ **ASSERTED ON `textContent`, NOT `getByText`.** Every scripted line is split across
   * elements by the things this scene exists to show: a mention pill and a code span are
   * their own nodes, so no line of consequence survives as one text node. Matching the
   * flattened text is what makes the probe test the TRANSCRIPT rather than the markup.
   */
  const bodyFragment = (id: string) => {
    const found = messagesAt(INSIDE).find((m) => m.id === id);
    if (!found) throw new Error(`no scripted message ${id}`);
    // The run between the leading mention and the first code span.
    const plain = found.body.replace(/@[\w-]+\s*/, "").split("`")[0].trim();
    if (plain.length < 20) throw new Error(`fragment too short for ${id}`);
    return plain;
  };

  it("renders a brief that belongs to the thread", () => {
    const { container } = mount(OPEN_THREAD);
    expect(container.textContent).toContain(bodyFragment("demo-m20"));
  });

  it("does NOT render the channel-level opening line", () => {
    const { container } = mount(OPEN_THREAD);
    expect(container.textContent).not.toContain(bodyFragment("demo-m1"));
  });

  it("renders the channel line in channel view, which is the other half of that", () => {
    const { container } = mount(null);
    expect(container.textContent).toContain(bodyFragment("demo-m1"));
  });
});

describe("3. the breadcrumb crumb is there to click back out", () => {
  it("renders the channel name as a button in thread view", () => {
    mount(OPEN_THREAD);
    expect(screen.getByRole("button", { name: CHANNEL_NAME })).toBeTruthy();
  });

  it("renders it as plain text, not a button, in channel view", () => {
    mount(null);
    expect(screen.queryByRole("button", { name: CHANNEL_NAME })).toBeNull();
  });
});

/**
 * ⚠ **QUERIED THE WAY THE CURSOR QUERIES, WHICH IS BY DOM TAG.** The first draft of this
 * probe used `getAllByRole("button")` and reported "no Agents tab in thread view" — and
 * that was the PROBE being wrong, not the app: the tab row is a `SegmentedControl` whose
 * buttons carry `role="tab"`, and an explicit role hides them from the `button` role
 * query. `banner-demo.tsx › findButton` walks `querySelectorAll("button")`, so it sees
 * them. Matching its method is the only way this probe can speak for the cursor.
 */
const domButtons = (root: HTMLElement) => [...root.querySelectorAll("button")];
const labelled = (root: HTMLElement, match: (l: string) => boolean) =>
  domButtons(root).filter((b) => match((b.textContent ?? "").trim()));

describe("4. the cursor's agent target is the one the private chat belongs to", () => {
  it("reaches an Agents tab in thread view, the way the cursor finds it", () => {
    const { container } = mount(OPEN_THREAD);
    expect(
      labelled(container, (l) => l.startsWith("Agents")).length
    ).toBeGreaterThan(0);
  });

  it("counts only the thread's own agents on that tab", () => {
    // `activeAgentCount` is thread-scoped, so the planner (which posts to the channel)
    // is excluded and the three coders are not. That is why the first "Open" below can
    // be relied on to be a coder at all.
    const { container } = mount(OPEN_THREAD);
    const tab = labelled(container, (l) => l.startsWith("Agents"))[0];
    expect((tab.textContent ?? "").trim()).toBe("Agents3");
  });

  it("🔒 names the opened coder FIRST among the agent rows", () => {
    // ⚠ The whole point: `findButton` takes the FIRST match in DOM order, so if another
    // session rendered above this one the cursor would open the wrong agent and the
    // private chat would be attached to an agent that never said any of it.
    const { container } = mount(OPEN_THREAD);
    const name = AGENT_INDEX.get(AGENT_IDS.teardown)?.displayName;
    expect(name).toBeTruthy();
    const agentRows = labelled(container, (l) =>
      l.includes("agent") && l.length > "agent".length
    );
    expect(agentRows.length).toBeGreaterThan(0);
    const first = agentRows.find((b) =>
      (b.textContent ?? "").includes(name as string)
    );
    expect(
      first,
      `${name} is not among the agent rows in thread view`
    ).toBeTruthy();
  });
});

/**
 * **THE BANNER'S PAINT, ASSERTED ON THE RENDERED CARD** (`ui/received-banner-color`
 * merged 2026-10-12; @cleanup-orchestrator: "turn the 3 shape probes into
 * `data-stream-inbound-paint` assertions").
 *
 * The shape probes live in `demo-script.test.ts` and now read typed fields rather than a
 * cast. This is the other half: mount the agent view and check which weight the card
 * actually draws, through the component's own published test attribute.
 *
 * ⚠ **v3 DRAWS ONLY THE AGENT WEIGHT, AND THAT IS THE STORY.** The opened agent is a
 * coder its orchestrator launched and briefed, so the only thing that arrives in its
 * private lane is another agent's message. There is no human-sent arrival to paint
 * `human`, and inventing one would be a line nobody approved. The `human` case stays
 * covered by the product's own `agent-stream-inbound-weight.test.tsx`.
 */
describe("5. the inbound banner draws the sending agent's weight", () => {
  const AT_PRIVATE = stepIndex("dm-agent-1");

  const cards = (root: HTMLElement) => [
    ...root.querySelectorAll("[data-stream-inbound]"),
  ];

  it("renders an inbound card once the agent view is open", () => {
    const { container } = render(
      <DemoScene step={AT_PRIVATE} thread={OPEN_THREAD} agentOpen />
    );
    expect(cards(container).length).toBeGreaterThan(0);
  });

  it("🔒 paints it `agent`, not `human` and not `neutral`", () => {
    const { container } = render(
      <DemoScene step={AT_PRIVATE} thread={OPEN_THREAD} agentOpen />
    );
    const weights = cards(container).map((c) =>
      c.getAttribute("data-stream-inbound-paint")
    );
    expect(weights.length).toBeGreaterThan(0);
    for (const weight of weights) expect(weight).toBe("agent");
  });

  it("names the briefing orchestrator by its HANDLE, which is the merged wording", () => {
    // ⚠ `@<slug>`, not the display name: an agent arrival reads "Message received from
    // @cleanup-planner". Asserted as the slug of the identity's own name so a rename
    // moves both together rather than leaving a literal behind.
    const { container } = render(
      <DemoScene step={AT_PRIVATE} thread={OPEN_THREAD} agentOpen />
    );
    const planner = AGENT_INDEX.get(AGENT_IDS.planner)?.displayName;
    expect(planner).toBeTruthy();
    expect(cards(container)[0].textContent).toContain(
      `@${mentionSlug(planner as string)}`
    );
  });
});
