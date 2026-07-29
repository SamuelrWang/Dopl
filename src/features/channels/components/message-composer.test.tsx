import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MessageComposer,
  resolveSendOptions,
  type SendOptions,
} from "./message-composer";
import type { ChannelMember } from "../types";

const ME = "me";
const PEER = "peer";

function member(over: Partial<ChannelMember> & { userId: string }): ChannelMember {
  return {
    channelId: "c1",
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    agentOnline: true,
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    addedBy: null,
    joinedAt: "2026-07-01T00:00:00.000Z",
    displayName: null,
    email: null,
    avatarUrl: null,
    ...over,
  };
}

const noop: (body: string, opts?: SendOptions) => Promise<void> = async () => {};
const roster: ChannelMember[] = [
  member({ userId: ME, displayName: "Me" }),
  member({ userId: PEER, displayName: "Ada" }),
];

describe("resolveSendOptions (unified composer send model)", () => {
  it("auto-addresses the peer in a DM", () => {
    expect(
      resolveSendOptions({
        isDirect: true,
        peerId: PEER,
        toUserId: null,
        summary: "",
        body: "hello",
      })
    ).toEqual({ toUserId: PEER, summary: undefined });
  });

  it("carries the trimmed one-liner as the DM summary", () => {
    expect(
      resolveSendOptions({
        isDirect: true,
        peerId: PEER,
        toUserId: null,
        summary: "  ship it  ",
        body: "body",
      })
    ).toEqual({ toUserId: PEER, summary: "ship it" });
  });

  it("returns nothing for a DM with no resolvable peer", () => {
    expect(
      resolveSendOptions({
        isDirect: true,
        peerId: null,
        toUserId: null,
        summary: "x",
        body: "body",
      })
    ).toBeUndefined();
  });

  it("addresses the picked teammate in a channel, with the explicit summary", () => {
    expect(
      resolveSendOptions({
        isDirect: false,
        peerId: null,
        toUserId: PEER,
        summary: "review the plan",
        body: "here is the plan",
      })
    ).toEqual({ toUserId: PEER, summary: "review the plan" });
  });

  it("uses the first body line as an implicit intent when no summary is typed", () => {
    expect(
      resolveSendOptions({
        isDirect: false,
        peerId: null,
        toUserId: PEER,
        summary: "",
        body: "first line\nsecond line",
      })
    ).toEqual({ toUserId: PEER, summary: "first line" });
  });

  it("returns nothing for an unaddressed channel send", () => {
    expect(
      resolveSendOptions({
        isDirect: false,
        peerId: null,
        toUserId: null,
        summary: "",
        body: "broadcast",
      })
    ).toBeUndefined();
  });
});

describe("MessageComposer render (one unified input, no mode slider)", () => {
  it("renders exactly one textarea and no Message|Task slider in a DM", () => {
    const markup = renderToStaticMarkup(
      <MessageComposer
        onSend={noop}
        members={roster}
        currentUserId={ME}
        isDirect
        placeholder="Message Ada"
      />
    );
    expect((markup.match(/<textarea/g) ?? []).length).toBe(1);
    // The removed Message|Task SegmentedControl no longer renders.
    expect(markup).not.toContain("Task");
    expect(markup).toContain("Send message");
  });

  it("renders one input and the address picker in a multi-member channel", () => {
    const markup = renderToStaticMarkup(
      <MessageComposer
        onSend={noop}
        members={[
          member({ userId: ME }),
          member({ userId: PEER }),
          member({ userId: "third" }),
        ]}
        currentUserId={ME}
        placeholder="Message #general"
      />
    );
    expect((markup.match(/<textarea/g) ?? []).length).toBe(1);
    expect(markup).not.toContain("Task");
    expect(markup).toContain("Ask a specific agent");
  });
});
