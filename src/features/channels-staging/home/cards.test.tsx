// @vitest-environment jsdom
/**
 * The two boxes Samuel restructured on 2026-10-22 (asks 6 and 6b), tested as faces: what the
 * box says, and that the presses land where he asked them to.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ThreadCardRow } from "@/features/channels/components/view-model-rows";
import { StagingThreadCard, type ThreadCardAgent } from "./thread-card";
import { StagingDecisionCard } from "./decision-card";
import { decisionMessage } from "../data/decision-fixture";
import { displayPayloadOf, displayViewFrom } from "@/features/channels/components/view-model-display";
import { CURRENT_USER_ID } from "../data/demo-imports";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import { StagingChannelsPage } from "../staging-channels-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const THREAD_ROW = {
  kind: "thread-card",
  id: "m1",
  seq: 9,
  side: "in",
  author: { userId: CURRENT_USER_ID, displayName: "Daniel Ortiz", email: "d@x.io" },
  authorLabel: "You",
  time: "12:00",
  threads: [{ id: "th-1", title: "Flaky test suite", status: "open" }],
  openThreadId: "th-1",
  preview: "Grace wants a repro before the quarantine list is cut.",
} as unknown as ThreadCardRow;

const agent = (over: Partial<ThreadCardAgent> = {}): ThreadCardAgent => ({
  key: "a1",
  name: "Teardown Order Fix",
  owner: "Yours",
  photo: null,
  color: null,
  logo: "/img/runtimes/claude.svg",
  state: { tone: "working", label: "Running" },
  ...over,
});

describe("the agent thread box (ask 6)", () => {
  it("heads with the thread's name, lists the agents inside, and keeps the actions out of the agent rows", () => {
    const opened: string[] = [];
    render(
      <StagingThreadCard
        row={THREAD_ROW}
        agents={[
          agent({ onOpen: () => opened.push("own") }),
          // A peer's agent runs on their machine: a row with no press.
          agent({ key: "a2", name: "End Notice Check", owner: "Grace's agent" }),
        ]}
        onOpen={() => opened.push("thread")}
        onLaunch={() => opened.push("launch")}
      />
    );

    // 1. The name stands where "Agent thread" did, and that label is gone.
    expect(screen.getByText("Flaky test suite")).toBeTruthy();
    expect(screen.queryByText("Agent thread")).toBeNull();

    // 2 + 3. Description, and the agents inside.
    expect(screen.getByText(/Grace wants a repro/)).toBeTruthy();
    expect(screen.getByText("2 agents in this thread")).toBeTruthy();

    // 4. An own agent's row opens that agent; the peer row is not a button.
    fireEvent.click(screen.getByRole("button", { name: "Open Teardown Order Fix" }));
    expect(opened).toEqual(["own"]);
    expect(screen.queryByRole("button", { name: "Open End Notice Check" })).toBeNull();

    // 5. Both actions live in the footer, outside every agent row.
    for (const label of ["Open thread", "Launch agent"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn.closest(".uis-tc-agent")).toBeNull();
      expect(btn.closest(".uis-tc-foot")).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    expect(opened).toEqual(["own", "thread", "launch"]);
  });

  /** First named instance of structure before font styling: the empty box must not be three stacked lines. */
  it("gives the empty state a shape, not a third line of text", () => {
    render(<StagingThreadCard row={THREAD_ROW} agents={[]} onOpen={() => {}} />);
    const empty = screen.getByText("No agents yet");
    // Inside the agents well, with an icon beside it — a compartment, not a bare line.
    expect(empty.closest(".uis-tc-agents")).toBeTruthy();
    expect(empty.querySelector("svg")).toBeTruthy();
    // And the count caption is not also rendered, so there is one line here, not two.
    expect(screen.queryByText(/in this thread/)).toBeNull();
  });
});

describe("the agent badge on a message (ask 6c final: flag + photo + name + time)", () => {
  it("fills the product's flag frame with the photo, name and time (no runtime icon, no agent chip)", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never;
    Element.prototype.scrollIntoView ??= () => {};
    render(<StagingChannelsPage />);

    await waitFor(() => expect(document.querySelector(".uis-ap")).toBeTruthy(), {
      timeout: 8000,
    });
    const badge = document.querySelector(".uis-ap") as HTMLElement;

    // Name and time are said; the "agent" chip is gone (Samuel, 2026-10-23).
    expect(badge.querySelector(".uis-ap-name")?.textContent?.trim()).toBeTruthy();
    expect(badge.querySelector(".uis-ap-time")?.textContent?.trim()).toBeTruthy();
    expect(badge.textContent).not.toMatch(/\bagent\b/);

    // The operator's photo stays; the small runtime icon is gone (Samuel, 2026-10-24).
    const face = badge.querySelector(".uis-ap-face") as HTMLElement;
    expect(face).toBeTruthy();
    expect(face.children.length).toBe(1);
    expect(badge.querySelectorAll("img").length).toBeLessThanOrEqual(1);

    // It sits inside the product's flag frame (the coloured span), which is not flattened.
    const frame = badge.closest(".uis-ap-host")?.parentElement as HTMLElement;
    expect(frame.className).toMatch(/border-\[3px\]/);
    expect(frame.style.borderColor).toBeTruthy();

    // The product pill it replaced is swapped out, and the row's vertical line stays.
    const row = badge.closest("article[data-message-id]") as HTMLElement;
    expect(row.querySelector("[data-attribution-pill]")?.closest("[data-lp-swapped]")).toBeTruthy();
    expect(row.getAttribute("data-agent-color")).toBeTruthy();
    expect(row.querySelector('span[aria-hidden][class*="w-[3px]"]')).toBeTruthy();
  }, 20_000);

  /**
   * Ask 6d: the product's own `Avatar` instances in the pane are lifted by a scoped rule in
   * `ui-staging/staging.css`. jsdom applies no stylesheet, so what is worth pinning is that
   * the rule's selector still has something to match — a dead override is the failure mode.
   */
  it("still has product avatars the staged size override can reach", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never;
    Element.prototype.scrollIntoView ??= () => {};
    render(<StagingChannelsPage />);

    await waitFor(() => expect(document.querySelector(".lp-demo-record")).toBeTruthy(), {
      timeout: 8000,
    });
    const pane = document.querySelector(".lp-demo-record") as HTMLElement;
    await waitFor(
      () =>
        expect(
          pane.querySelectorAll("span.rounded-full.w-6.h-6, span.rounded-full.w-8.h-8").length
        ).toBeGreaterThan(0),
      { timeout: 8000 }
    );
  }, 20_000);
});

describe("the decision box (ask 6b)", () => {
  const index = {
    currentUserId: CURRENT_USER_ID,
    byId: new Map(),
    agents: new Map(),
  } as unknown as AuthorIndex;

  const view = () => {
    const payload = displayPayloadOf(decisionMessage(10));
    if (!payload) throw new Error("the staged decision carries no display");
    return displayViewFrom(payload, index, new Map(), false);
  };

  it("reads as question, context, then options that carry their own consequence", () => {
    render(<StagingDecisionCard view={view()} paint="#000" />);

    expect(screen.getByText(/Ship the teardown fix behind a flag/)).toBeTruthy();
    expect(screen.getByText(/Two of the three coders are still mid review/)).toBeTruthy();

    const options = [...document.querySelectorAll(".uis-dc-opt")];
    expect(options).toHaveLength(3);
    // The consequence sits INSIDE the option it belongs to, not in a list above a letter strip.
    expect(within(options[0] as HTMLElement).getByText(/Goes out today with the flag off/)).toBeTruthy();
    // The recommendation rides on its option.
    expect(within(options[0] as HTMLElement).getByText("Recommended")).toBeTruthy();
    // No "Option A" letters anywhere.
    expect(document.body.textContent).not.toMatch(/Option [A-C]/);
  });

  it("settles into a chosen row and quiets the rest", () => {
    render(<StagingDecisionCard view={view()} paint="#000" />);
    fireEvent.click(screen.getByRole("button", { name: /Hold for the next release/ }));

    const options = [...document.querySelectorAll(".uis-dc-opt")];
    expect(options[1].getAttribute("data-chosen")).toBe("true");
    expect(options[0].getAttribute("data-quiet")).toBe("true");
    expect(options[2].getAttribute("data-quiet")).toBe("true");
    expect(screen.getByText(/You chose/)).toBeTruthy();
    // Settled: the rows stop being pressable.
    expect(screen.queryByRole("button", { name: /Ship behind a flag/ })).toBeNull();
  });

  /** The swap wiring, end to end: the hardcoded post reaches the pane and the staged face
   *  replaces the product card there (`demo-swap.ts` finds it by `data-display-id`). */
  it("is on #tech-debt, with the product card swapped out", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never;
    Element.prototype.scrollIntoView ??= () => {};
    render(<StagingChannelsPage />);

    await waitFor(() => expect(document.querySelector(".uis-dc")).toBeTruthy(), {
      timeout: 8000,
    });
    const product = document.querySelector("[data-display-id]");
    expect(product?.closest("[data-lp-swapped]") ?? product).toBeTruthy();
    expect(document.body.textContent).toMatch(/Ship the teardown fix behind a flag/);

    /**
     * The swap host lives INSIDE the staging window, which is what lets its rule be
     * scoped `.uis-window .uis-dc-host` rather than sitting at the top level of a sheet
     * that loads on all six playground routes. Pinned because the scoping is invisible
     * until something outside the window grows the same class.
     */
    const host = document.querySelector(".uis-dc-host");
    expect(host).toBeTruthy();
    expect(host?.closest(".uis-window")).toBeTruthy();
  }, 20_000);
});
