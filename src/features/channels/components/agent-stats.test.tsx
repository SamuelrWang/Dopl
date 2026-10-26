// @vitest-environment jsdom
/** The agent's numbers in the card well: never a denominator it was not given. */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { AgentStats } from "./agent-stats";
import { CHANNEL_ID } from "./test-fixtures";

afterEach(cleanup);

const agent = (over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary => ({
  sessionId: "s-1",
  channelId: CHANNEL_ID,
  threadId: "t-1",
  name: "flint",
  state: "working",
  channelName: "Website",
  threadTitle: "UI-kit design",
  contextUsed: null,
  contextWindow: null,
  tokensSpent: null,
  startedAt: null,
  lastActivityAt: null,
  ...over,
});

describe("AgentStats", () => {
  it("prints used / window over a meter in the agent's colour", () => {
    const { container } = render(
      <AgentStats agent={agent({ contextUsed: 84_000, contextWindow: 200_000 })} color="agent-07" />
    );
    expect(container.querySelector(".card-well")?.textContent).toContain("84k / 200k");
    const fill = container.querySelector<HTMLElement>("[style*='width']");
    expect(fill?.style.width).toBe("42%");
    expect(fill?.style.background).toBe("var(--agent-color-07)");
  });

  it("prints the used number alone when no window is reported, over an empty bar", () => {
    const { container } = render(<AgentStats agent={agent({ contextUsed: 84_000 })} />);
    expect(container.textContent).toContain("84k");
    expect(container.textContent).not.toContain("/");
    expect(container.querySelector<HTMLElement>("[style*='width']")?.style.width).toBe("0%");
  });

  it("hands the fill to the warning colour as the window fills", () => {
    const { container } = render(
      <AgentStats agent={agent({ contextUsed: 190_000, contextWindow: 200_000 })} color="agent-07" />
    );
    const fill = container.querySelector<HTMLElement>("[style*='width']");
    expect(fill?.className).toContain("bg-danger");
    expect(fill?.style.background).toBe("");
  });

  it("drops the meta line when nothing on it was measured", () => {
    const { container } = render(<AgentStats agent={agent()} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
