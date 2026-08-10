import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelTranscript } from "./channel-transcript";
import { pendingMessageId } from "../lib/optimistic-cache";
import type { ChannelAgent, ChannelMessage } from "../types";

const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";
const ME = "u-me";
const PEER = "u-ada";
const TASK_ID = `task-${CHANNEL_ID}-7`;
const AVATAR = "https://avatars.test/face.png";
const MEMBER_NAMES = new Map([
  [ME, "Me"],
  [PEER, "Ada"],
]);

function message(over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: "m1",
    seq: 1,
    channelId: CHANNEL_ID,
    authorUserId: ME,
    authorKind: "user",
    kind: "message",
    body: "hello there",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-07-28T00:05:00.000Z",
    authorName: "Me",
    authorAvatarUrl: null,
    ...over,
  };
}

/** My own plain message — the right-hand side. */
function mine(over: Partial<ChannelMessage> = {}): ChannelMessage {
  return message({ id: "mine", body: "MY-TEXT", ...over });
}

/** A teammate's plain message — the left-hand side. */
function theirs(over: Partial<ChannelMessage> = {}): ChannelMessage {
  return message({
    id: "theirs",
    seq: 2,
    authorUserId: PEER,
    authorName: "Ada",
    body: "THEIR-TEXT",
    ...over,
  });
}

function render(messages: ChannelMessage[]): string {
  return renderToStaticMarkup(
    <ChannelTranscript
      messages={messages}
      memberNames={MEMBER_NAMES}
      threads={[]}
      threadsLoading={false}
      currentUserId={ME}
    />
  );
}

/** Every chat bubble's class list, in render order (session cards carry an
 *  `id` before their class, so this matches plain bubbles only). */
function bubbleClasses(markup: string): string[] {
  return [...markup.matchAll(/<article class="([^"]*)"/g)].map((m) => m[1]);
}

/** The class list of the first element inside the bubble — its meta (author +
 *  time) row. */
function metaRowClass(markup: string): string {
  const divAt = markup.indexOf("<div", markup.indexOf("<article"));
  return /class="([^"]*)"/.exec(markup.slice(divAt, divAt + 240))?.[1] ?? "";
}

/** The class list of the div that directly encloses `text` (the receipt line). */
function enclosingDivClass(markup: string, text: string): string {
  const at = markup.indexOf(text);
  expect(at).toBeGreaterThan(-1);
  const openedAt = markup.lastIndexOf("<div", at);
  return /class="([^"]*)"/.exec(markup.slice(openedAt, at))?.[1] ?? "";
}

describe("ChannelTranscript chat-style alignment", () => {
  it("right-aligns my own message at the ~2/3 cap", () => {
    const [bubble] = bubbleClasses(render([mine()]));
    expect(bubble).toContain("self-end");
    expect(bubble).toContain("max-w-[66%]");
    expect(bubble).not.toContain("self-start");
  });

  it("left-aligns a teammate's message at the same cap", () => {
    const [bubble] = bubbleClasses(render([theirs()]));
    expect(bubble).toContain("self-start");
    expect(bubble).toContain("max-w-[66%]");
    expect(bubble).not.toContain("self-end");
  });

  it("left-aligns an agent message even when it carries my own user id", () => {
    // My agent speaks for itself, not for me: an agent row is never "mine".
    const [bubble] = bubbleClasses(
      render([mine({ authorKind: "agent", authorName: "Ada's agent" })])
    );
    expect(bubble).toContain("self-start");
    expect(bubble).not.toContain("self-end");
  });

  it("puts the two sides on opposite edges in one thread, same cap", () => {
    const classes = bubbleClasses(render([mine(), theirs()]));
    expect(classes).toHaveLength(2);
    expect(classes[0]).toContain("self-end");
    expect(classes[1]).toContain("self-start");
    for (const cls of classes) expect(cls).toContain("max-w-[66%]");
  });

  it("drops the redundant avatar on my own bubble", () => {
    const markup = render([mine({ authorAvatarUrl: AVATAR })]);
    expect(markup).not.toContain(AVATAR);
    expect(markup).not.toContain("<img");
    // The author line itself survives — only the second identity marker goes.
    expect(markup).toContain("Me");
  });

  it("keeps the avatar on a message from someone else", () => {
    const markup = render([theirs({ authorAvatarUrl: AVATAR })]);
    expect(markup).toContain(AVATAR);
  });

  it("flushes my own author line to the right, and theirs to the left", () => {
    expect(metaRowClass(render([mine()]))).toContain("justify-end");
    expect(metaRowClass(render([theirs()]))).not.toContain("justify-end");
  });

  it("aligns the receipt line with the message it belongs to", () => {
    // An addressed own message earns a receipt ("Sent" with nothing linked yet).
    const markup = render([mine({ metadata: { to_user_id: PEER } })]);
    expect(markup).toContain("Sent");
    expect(enclosingDivClass(markup, "Sent")).toContain("justify-end");
  });
});

describe("ChannelTranscript full-width rows (not chat bubbles)", () => {
  it("keeps a session card full width", () => {
    const markup = render([
      message({
        id: "s1",
        seq: 7,
        authorUserId: PEER,
        authorKind: "agent",
        authorName: "Ada",
        kind: "task_started",
        body: "Started working",
        metadata: { taskId: TASK_ID },
      }),
      message({
        id: "s2",
        seq: 8,
        authorUserId: PEER,
        authorKind: "agent",
        authorName: "Ada",
        body: "Here is the answer.",
        metadata: { taskId: TASK_ID },
      }),
    ]);
    expect(markup).toContain("Here is the answer.");
    expect(markup).not.toContain("max-w-[66%]");
    expect(markup).not.toContain("self-end");
    expect(markup).not.toContain("self-start");
  });

  it("keeps an activity / lifecycle event row full width", () => {
    const markup = render([
      message({
        id: "e1",
        kind: "system",
        authorKind: "system",
        authorUserId: null,
        authorName: null,
        body: "Ada joined the channel",
      }),
    ]);
    expect(markup).toContain("Ada joined the channel");
    expect(markup).not.toContain("<article");
    expect(markup).not.toContain("max-w-[66%]");
    expect(markup).not.toContain("self-end");
    expect(markup).not.toContain("self-start");
  });
});

/** The bubble's own opening tag — attributes on the `<article>` and nothing
 *  inside it, so a nested `opacity-*` utility cannot fake a pass. */
function bubbleTag(markup: string): string {
  const at = markup.indexOf("<article");
  expect(at).toBeGreaterThan(-1);
  return markup.slice(at, markup.indexOf(">", at) + 1);
}

/**
 * PENDING. An optimistic send paints the bubble one frame after the click, and
 * rendered identically to a sent one it is a small lie — the user cannot tell a
 * message in flight from one the server has stored, and a failed send simply
 * vanishes. The pending id `buildPendingMessage` mints is the marker; the
 * `pending.ts` recipe is the treatment. `SessionCard` has had this since the
 * optimistic layer landed and the plain bubble did not.
 */
describe("ChannelTranscript pending bubble", () => {
  it("dims an unacknowledged message and makes it inert", () => {
    const markup = render([
      mine({ id: pendingMessageId("c-1"), clientMsgId: "c-1" }),
    ]);
    const article = bubbleTag(markup);
    expect(article).toContain('data-pending=""');
    expect(article).toContain("opacity-60");
    expect(article).toContain("pointer-events-none");
    // The REAL content, dimmed — not a skeleton, and not a lost message.
    expect(markup).toContain("MY-TEXT");
  });

  it("leaves a settled message untouched", () => {
    const article = bubbleTag(render([mine()]));
    expect(article).not.toContain("data-pending");
    expect(article).not.toContain("opacity-60");
    expect(article).not.toContain("pointer-events-none");
  });

  it("keeps the alignment and width the bubble already had", () => {
    // The recipe COMPOSES over the row's own classes; it never restyles it.
    const [bubble] = bubbleClasses(
      render([mine({ id: pendingMessageId("c-2"), clientMsgId: "c-2" })])
    );
    expect(bubble).toContain("self-end");
    expect(bubble).toContain("max-w-[66%]");
  });
});

/**
 * Agent attribution: a message stamped with `metadata.author_agent_id` says
 * WHICH agent wrote it. The key is display only — anything unresolvable falls
 * back to the plain "agent" pill this surface has always rendered.
 */
function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return { id: "ag-1", ownerUserId: PEER, name: "quartz", ...over };
}

function renderWithAgents(
  messages: ChannelMessage[],
  agents: ChannelAgent[]
): string {
  return renderToStaticMarkup(
    <ChannelTranscript
      messages={messages}
      memberNames={MEMBER_NAMES}
      threads={[]}
      threadsLoading={false}
      currentUserId={ME}
      agents={agents}
    />
  );
}

/** An agent-authored plain message carrying the given metadata. */
function agentMessage(metadata: Record<string, unknown>): ChannelMessage {
  return message({
    id: "am",
    seq: 3,
    authorUserId: PEER,
    authorKind: "agent",
    authorName: "Ada",
    body: "AGENT-TEXT",
    metadata,
  });
}

describe("ChannelTranscript agent attribution", () => {
  it("names the agent and whose it is when the id resolves", () => {
    const markup = renderWithAgents(
      [agentMessage({ author_agent_id: "ag-1" })],
      [agent()]
    );
    expect(markup).toContain("quartz");
    expect(markup).toContain("Ada&#x27;s agent");
  });

  it("says 'Your agent' for the viewer's own agent", () => {
    const markup = renderWithAgents(
      [agentMessage({ author_agent_id: "ag-1" })],
      [agent({ ownerUserId: ME })]
    );
    expect(markup).toContain("Your agent");
  });

  it("falls back to today's plain pill when the id names no loaded agent", () => {
    const markup = renderWithAgents(
      [agentMessage({ author_agent_id: "ag-gone" })],
      [agent()]
    );
    expect(markup).toContain(">agent<");
    expect(markup).not.toContain("quartz");
  });

  it("falls back when the message carries no agent id at all", () => {
    expect(renderWithAgents([agentMessage({})], [agent()])).toContain(">agent<");
  });

  it("falls back when the key is not a string (never trusted as more)", () => {
    const markup = renderWithAgents(
      [agentMessage({ author_agent_id: { id: "ag-1" } })],
      [agent()]
    );
    expect(markup).toContain(">agent<");
  });

  it("renders unchanged when no agents are passed at all (agents still loading)", () => {
    expect(render([agentMessage({ author_agent_id: "ag-1" })])).toContain(
      ">agent<"
    );
  });

  it("never attributes a HUMAN message to an agent", () => {
    const markup = renderWithAgents(
      [message({ metadata: { author_agent_id: "ag-1" } })],
      [agent()]
    );
    expect(markup).not.toContain("quartz");
  });
});
