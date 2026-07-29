import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityEventRow } from "./activity-event-row";
import type { ChannelMessage } from "../types";

/** An ungrouped task_failed row (no taskId, so it never folded into a card). */
function failedRow(metadata: Record<string, unknown>, body = "Failed"): ChannelMessage {
  return {
    id: "e1",
    seq: 3,
    channelId: "c1",
    authorUserId: "u-agent",
    authorKind: "agent",
    kind: "task_failed",
    body,
    metadata,
    clientMsgId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    authorName: null,
    authorAvatarUrl: null,
  };
}

describe("ActivityEventRow calm-terminal parity", () => {
  it("gives an ungrouped capped row a neutral dot, not the danger red", () => {
    const markup = renderToStaticMarkup(
      <ActivityEventRow message={failedRow({ capped: true }, "Turn limit reached")} />
    );
    expect(markup).toContain("bg-text-disabled");
    expect(markup).not.toContain("bg-danger");
  });

  it("gives an ungrouped ended row a neutral dot", () => {
    const markup = renderToStaticMarkup(
      <ActivityEventRow message={failedRow({ ended: true }, "Session ended")} />
    );
    expect(markup).toContain("bg-text-disabled");
    expect(markup).not.toContain("bg-danger");
  });

  it("keeps a genuine failure (no calm flag) on the danger dot", () => {
    const markup = renderToStaticMarkup(
      <ActivityEventRow message={failedRow({}, "Crashed")} />
    );
    expect(markup).toContain("bg-danger");
    expect(markup).not.toContain("bg-text-disabled");
  });

  it("does not soften a real failure when capped is truthy-but-not-strictly-true", () => {
    const markup = renderToStaticMarkup(
      <ActivityEventRow message={failedRow({ capped: "true" }, "Crashed")} />
    );
    expect(markup).toContain("bg-danger");
    expect(markup).not.toContain("bg-text-disabled");
  });
});
