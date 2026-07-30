import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelThread } from "./channel-thread";
import type {
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
} from "../types";

const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";
const ME = "u-me";

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: CHANNEL_ID,
    workspaceId: "w1",
    slug: "general",
    name: "general",
    topic: "",
    visibility: "public",
    isDirect: false,
    directPeer: null,
    createdBy: ME,
    archivedAt: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    memberCount: 2,
    lastMessageAt: "2026-07-28T00:05:00.000Z",
    role: "owner",
    isMember: true,
    lastReadAt: null,
    unread: false,
    myNotifyScope: "all",
    myAgentToolProfile: "read_only",
    onlineMemberCount: 1,
    ...over,
  };
}

function message(over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: "m1",
    seq: 1,
    channelId: CHANNEL_ID,
    authorUserId: ME,
    authorKind: "user",
    kind: "message",
    body: "THE-LAST-MESSAGE",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-07-28T00:05:00.000Z",
    authorName: "Me",
    authorAvatarUrl: null,
    ...over,
  };
}

function member(over: Partial<ChannelMember> & { userId: string }): ChannelMember {
  return {
    channelId: CHANNEL_ID,
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: null,
    joinedAt: "2026-07-01T00:00:00.000Z",
    displayName: null,
    email: null,
    avatarUrl: null,
    ...over,
  };
}

function consent(over: Partial<ChannelConsentRequest> = {}): ChannelConsentRequest {
  return {
    id: "cr1",
    channelId: CHANNEL_ID,
    workspaceId: "w1",
    operatorUserId: ME,
    requesterUserId: "u-ada",
    kind: "inbound",
    messageSeq: 1,
    summary: "THE-PENDING-ASK",
    bodyPreview: "Please run the migration check.",
    proposedReply: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-07-28T00:06:00.000Z",
    expiresAt: null,
    requesterName: "Ada",
    requesterAvatarUrl: null,
    ...over,
  };
}

const noopAsync = async () => {};
const noop = () => {};

function render(
  consentRequests: ChannelConsentRequest[],
  over: Partial<Channel> = {},
  messages: ChannelMessage[] = [message()]
) {
  return renderToStaticMarkup(
    <ChannelThread
      channel={channel(over)}
      messages={messages}
      tasks={[]}
      tasksLoading={false}
      loading={false}
      notifyScope="all"
      members={[member({ userId: ME, displayName: "Me" })]}
      currentUserId={ME}
      consentRequests={consentRequests}
      trustedIds={new Set()}
      trustBusyIds={new Set()}
      consentBusyIds={new Set()}
      onSend={noopAsync}
      onCloseTask={noopAsync}
      onReopenTask={noopAsync}
      onInvite={noop}
      onSetNotifyScope={noop}
      onSetToolProfile={noop}
      onToggleTrust={noop}
      onDecideConsent={noop}
      onToggleArchive={noop}
      onToggleVisibility={noop}
      onDelete={noop}
      onJoin={noop}
      onLeave={noop}
    />
  );
}

describe("ChannelThread pending requests placement", () => {
  it("renders a pending request AFTER the last message, not above the transcript", () => {
    const markup = render([consent()]);
    const lastMessage = markup.indexOf("THE-LAST-MESSAGE");
    const ask = markup.indexOf("THE-PENDING-ASK");
    expect(lastMessage).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(lastMessage);
  });

  it("keeps the request inside the scroller, above the composer", () => {
    const markup = render([consent()]);
    // The composer placeholder is the first thing after the scroller closes, so
    // a request that precedes it is inside the scrolling transcript.
    const ask = markup.indexOf("THE-PENDING-ASK");
    const composer = markup.indexOf("Message #general");
    expect(composer).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(composer);
  });

  it("keeps the amber consent-card container (waiting on a human)", () => {
    const markup = render([consent()]);
    expect(markup).toContain("border-warning/25");
    expect(markup).toContain("bg-warning/10");
  });

  it("keeps the request card full width (chat sides are for plain messages only)", () => {
    const markup = render([consent()]);
    // The bubble alignment recipe belongs to plain chat rows; a pending decision
    // is shared state and spans the column.
    const ask = markup.indexOf("THE-PENDING-ASK");
    const tail = markup.slice(ask);
    expect(tail).not.toContain("max-w-[66%]");
    expect(tail).not.toContain("self-end");
    expect(tail).not.toContain("self-start");
  });

  it("passes the channel's own tool profile to the inbound card", () => {
    const markup = render([consent()]);
    expect(markup).toContain("Read only");
  });

  it("falls back to the full tool scope when the caller has no profile row", () => {
    const markup = render([consent()], { myAgentToolProfile: null });
    expect(markup).toContain("Full access");
  });

  it("renders nothing consent-shaped when the queue is empty", () => {
    const markup = render([]);
    expect(markup).not.toContain("Pending requests");
    expect(markup).not.toContain("border-warning/25");
    expect(markup).toContain("THE-LAST-MESSAGE");
  });

  it("renders every pending request, in the order given", () => {
    const markup = render([
      consent({ id: "cr1", summary: "FIRST-ASK" }),
      consent({
        id: "cr2",
        kind: "outbound",
        requesterUserId: null,
        requesterName: null,
        summary: "SECOND-ASK",
        proposedReply: "Here is the draft.",
      }),
    ]);
    expect(markup.indexOf("FIRST-ASK")).toBeLessThan(markup.indexOf("SECOND-ASK"));
    // Both halves of the queue render on the same surface: an inbound approval
    // and an outbound review.
    expect(markup).toContain("Ada&#x27;s agent is asking");
    expect(markup).toContain("Your agent wants to reply");
  });

  it("labels the bottom stack for assistive tech", () => {
    const markup = render([consent()]);
    expect(markup).toContain('aria-label="Pending requests"');
  });

  it("shows a request on an empty transcript without the contradictory empty-state line", () => {
    const markup = render([consent()], {}, []);
    expect(markup).not.toContain("No messages yet.");
    expect(markup).toContain("THE-PENDING-ASK");
  });
});
