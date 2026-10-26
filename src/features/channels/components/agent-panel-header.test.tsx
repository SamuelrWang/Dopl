// @vitest-environment jsdom
/** The agent view's header: the identity face, the work line and one status element. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { useAgentIdentity } from "./agent-face";
import { AgentPanelHeader } from "./agent-panel-header";
import { NO_THREAD_LABEL } from "./agents-model";
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

const FACE = { photo: null, name: "Flint", ring: "agent-05" } as const;

describe("AgentPanelHeader", () => {
  it("wears the identity face and a status pill, never a bot glyph", () => {
    const { container } = render(
      <AgentPanelHeader agent={agent()} face={FACE} onClose={() => {}} />
    );
    expect(container.querySelector("[data-identity-face]")).not.toBeNull();
    expect(container.querySelector(".lucide-bot")).toBeNull();
    expect(container.querySelector(".status-pill")).not.toBeNull();
    expect(screen.getByText("in UI-kit design")).toBeTruthy();
  });

  it("draws the runtime badge only when the host hands a logo", () => {
    const { container, rerender } = render(
      <AgentPanelHeader agent={agent()} face={FACE} onClose={() => {}} />
    );
    expect(container.querySelectorAll("[data-identity-face] img")).toHaveLength(0);
    rerender(
      <AgentPanelHeader
        agent={agent()}
        face={{ ...FACE, runtimeLogo: "/logo.svg" }}
        onClose={() => {}}
      />
    );
    expect(container.querySelector("[data-identity-face] img[src='/logo.svg']")).not.toBeNull();
  });

  it("badges the session's runtime through the shared logo map", () => {
    function Host() {
      const face = useAgentIdentity({ photo: null, name: "Flint", color: "agent-05", runtime: "claude" });
      return <AgentPanelHeader agent={agent({ runtimeId: "claude" })} face={face} onClose={() => {}} />;
    }
    const { container } = render(<Host />);
    expect(
      container.querySelector("[data-identity-face] img[src='/img/onboarding/claude-logo.svg']")
    ).not.toBeNull();
  });

  it("replaces the status with the ended pill, and names a threadless agent's place", () => {
    const { container } = render(
      <AgentPanelHeader
        agent={agent({ state: "ended", threadTitle: null })}
        face={FACE}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(container.querySelector(".status-pill")).toBeNull();
    expect(screen.getByText(`in ${NO_THREAD_LABEL}`)).toBeTruthy();
  });

  it("closes from a round control", () => {
    const onClose = vi.fn();
    render(<AgentPanelHeader agent={agent()} face={FACE} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close agent view" });
    expect(close.className).toContain("rounded-full");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
