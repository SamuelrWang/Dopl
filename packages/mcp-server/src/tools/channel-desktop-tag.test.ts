/**
 * **WHAT AN OUTSIDE SESSION SEES IN A TRANSCRIPT** (2026-09-18, Samuel's ruling
 * on the external-session group tag).
 *
 * ⚠ **THE LOAD-BEARING CASE IS THE ONE ABOUT WHAT IS *STILL THERE*.** Samuel's
 * ruling (b), verbatim: *"it's much worse if a message meant for an
 * audience/agents is silently forgotten/dropped then like too many messages
 * going to an agent and the agent having to filter."* So the marks are a
 * SIGNAL, never a filter — and `the page is not filtered` below is the
 * regression that would matter most if it ever broke.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opRead } from "./channel-ops-read";

const SELF = "u-1";
const PEER = "u-2";

function stubClient(messages: Record<string, unknown>[]): DoplClient {
  return {
    listChannels: vi.fn(async () => [
      { id: "chan-1", slug: "general", name: "General", visibility: "private" },
    ]),
    readChannelMessages: vi.fn(async () => messages),
  } as unknown as DoplClient;
}

let nextSeq = 100;
function msg(over: Record<string, unknown> = {}) {
  nextSeq += 1;
  return {
    id: `m-${nextSeq}`,
    seq: nextSeq,
    channelId: "chan-1",
    authorUserId: PEER,
    authorKind: "agent",
    kind: "message",
    body: "hi",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-09-18T00:00:00Z",
    authorName: "Diana Taylor",
    // ⚠ BOTH COLUMNS PRESENT BY DEFAULT — absent is "this server computed no
    // verdict", a different case with its own assertions below.
    recipientAgentIds: [],
    recipientUserIds: [],
    ...over,
  };
}

/** The whole rendered result. */
const textOf = async (
  messages: Record<string, unknown>[],
  outside = true,
): Promise<string> => {
  const res = await opRead(
    stubClient(messages),
    "general",
    undefined,
    undefined,
    SELF,
    undefined,
    undefined,
    null,
    outside,
  );
  return res.content[0].text as string;
};

/** Just the message HEAD lines, in page order. ⚠ A body renders on its own
 *  indented continuation line, so a head filter is not a message filter. */
const linesOf = async (
  messages: Record<string, unknown>[],
  outside = true,
): Promise<string[]> =>
  (await textOf(messages, outside))
    .split("\n")
    .filter((l: string) => l.startsWith("- **#"));

describe("the author label", () => {
  it("says `outside session for <operator>`, not `agent for <operator>`", async () => {
    // ⚠ THE DEFECT: a Claude Code run posts under the operator's ACCOUNT, so
    // this line read `agent for Samuel Wang` and an in-channel agent answered
    // "@samuel-wang …" in short human-facing prose to another agent's question.
    // ⚠ **ANOTHER MEMBER'S SESSION, DELIBERATELY** (integration, 2026-09-19).
    // `PEER` rather than `SELF`: batch A's reader-aware `formatAuthor` renders
    // the READER'S OWN rows as `for you` and appends the reply handle, so a
    // self-authored row is the wrong fixture for the "is the operator NAMED"
    // question. The reader's own case is asserted immediately below, and in
    // `channel-render-addressing.test.ts`.
    const [line] = await linesOf([
      msg({
        authorUserId: PEER,
        authorName: "Samuel Wang",
        metadata: { external_session: true },
      }),
    ]);
    // ⚠ The name is rendered inside a code span (it is peer-typed and lands in
    // the line HEAD), so assert the label and the name separately.
    expect(line).toContain("outside session for");
    expect(line).toContain("Samuel Wang");
    expect(line).not.toContain("agent for");
    // ⚠ The group handle is PER OPERATOR: somebody else's session is never
    // offered a reply address that reaches the reader's own machine.
    expect(line).not.toContain("reply @desktop");
  });

  it("the READER'S OWN outside session says `for you` and offers the handle", async () => {
    const [line] = await linesOf([
      msg({
        authorUserId: SELF,
        authorName: "Samuel Wang",
        metadata: { external_session: true },
      }),
    ]);
    expect(line).toContain("outside session for you — reply @desktop");
  });

  it("falls back to `an outside session` when the name is unknown", async () => {
    const [line] = await linesOf([
      msg({
        authorUserId: null,
        authorName: null,
        metadata: { external_session: true },
      }),
    ]);
    expect(line).toContain("an outside session");
  });

  it("leaves a DESKTOP-RUN agent's label exactly as it was", async () => {
    const [line] = await linesOf([msg({ authorName: "Diana Taylor" })]);
    expect(line).toContain("agent for");
    expect(line).toContain("Diana Taylor");
    expect(line).not.toContain("outside session");
  });

  it("never promotes a HUMAN row, whatever metadata it carries", async () => {
    // ⚠ The write path cannot produce this row; the renderer must not be the
    // thing that trusts that.
    const [line] = await linesOf([
      msg({ authorKind: "user", metadata: { external_session: true } }),
    ]);
    expect(line).toContain("member ");
    expect(line).toContain("Diana Taylor");
    expect(line).not.toContain("outside session");
  });
});

describe("the arrow", () => {
  it("renders `→ @desktop` for the reader's own lane", async () => {
    const [line] = await linesOf([
      msg({ metadata: { to_desktop: SELF }, delivery: "posted" }),
    ]);
    expect(line).toContain("→ @desktop");
    // ⚠ NOT `→ nobody`: the recipient columns are empty on purpose (no machine
    // routes on this address), so an arrow reading only them would render a
    // deliberate address as a record.
    expect(line).not.toContain("→ nobody");
    expect(line).toContain("posted");
  });

  it("names WHOSE desktop when it is not the reader's", async () => {
    // ⚠ One handle per operator means a room holds several. An unqualified tag
    // on a peer's would invite this reader to adopt a message aimed at somebody
    // else's tooling.
    const [line] = await linesOf([msg({ metadata: { to_desktop: PEER } })]);
    expect(line).toContain("@desktop (");
    expect(line).toContain(PEER);
  });

  it("appears beside a co-addressed agent rather than replacing it", async () => {
    const [line] = await linesOf([
      msg({
        recipientAgentIds: ["deynelz3"],
        metadata: { to_desktop: SELF },
      }),
    ]);
    expect(line).toContain("@agent-`deynelz3`");
    expect(line).toContain("@desktop");
  });
});

describe("the never-drop marks", () => {
  it("shouts for an @desktop line and whispers for a likely one", async () => {
    const lines = await linesOf([
      msg({ metadata: { to_desktop: SELF } }),
      msg({ recipientUserIds: [SELF] }),
    ]);
    expect(lines[0]).toContain("⚠ FOR YOU");
    // ⚠ A GUESS MAY NOT SHOUT AS LOUD AS A FACT, or the fact stops being read.
    expect(lines[1]).toContain("likely for you");
    expect(lines[1]).not.toContain("⚠ FOR YOU");
  });

  it("marks an agent's RECORD that follows my own outside-session post", async () => {
    // (ii) — the shape of a reply to something you just said, filed rather than
    // addressed. Before `@desktop` existed this is most of the traffic.
    const lines = await linesOf([
      msg({ authorUserId: SELF, metadata: { external_session: true } }),
      msg({ body: "done, notes filed" }),
    ]);
    expect(lines[1]).toContain("likely for you");
  });

  it("does NOT mark an unaddressed post in a room my outside session never spoke in", async () => {
    // ⚠ THE PER-ROOM FENCE. A page can span channels, and relevance must not
    // leak from an exchange in a different one.
    const lines = await linesOf([
      msg({ authorUserId: SELF, metadata: { external_session: true } }),
      msg({ channelId: "chan-2", body: "unrelated room" }),
    ]);
    expect(lines[1]).not.toContain("likely for you");
  });

  it("does NOT mark a PRE-VERDICT row as unaddressed-and-therefore-mine", async () => {
    // ⚠ ABSENT COLUMNS ARE "no verdict was computed", NOT "resolved to nobody".
    // Collapsing them would mark every historical row on the page.
    const lines = await linesOf([
      msg({ authorUserId: SELF, metadata: { external_session: true } }),
      msg({ recipientAgentIds: undefined, recipientUserIds: undefined }),
    ]);
    expect(lines[1]).not.toContain("likely for you");
  });

  it("marks nothing at all for a caller whose own id is unknown", async () => {
    const res = await opRead(
      stubClient([msg({ metadata: { to_desktop: SELF } })]),
      "general",
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      null,
      true,
    );
    expect(res.content[0].text).not.toContain("FOR YOU");
  });

  it("marks nothing for a caller that is NOT an outside session", async () => {
    const lines = await linesOf(
      [msg({ metadata: { to_desktop: SELF } }), msg({ recipientUserIds: [SELF] })],
      false,
    );
    for (const line of lines) {
      expect(line).not.toContain("FOR YOU");
      expect(line).not.toContain("likely for you");
    }
  });
});

describe("🔒 the page is NOT filtered — marks are a signal, never a filter", () => {
  it("returns every message, including the ones marked nothing", async () => {
    // 🔒 SAMUEL'S RULING (b), AS AN ASSERTION. A hold returns on EVERY new
    // message in the channel exactly as it did before the tag existed; if this
    // ever breaks, a message meant for this lane is silently gone, which is the
    // outcome the ruling weighs heaviest.
    const page = [
      msg({ metadata: { to_desktop: SELF } }),
      msg({ recipientUserIds: [PEER], body: "for somebody else entirely" }),
      msg({ recipientAgentIds: ["deynelz3"], body: "agent chatter" }),
      msg({ authorKind: "user", body: "a human talking to nobody" }),
    ];
    const text = await textOf(page);
    const lines = (await textOf(page))
      .split("\n")
      .filter((l: string) => l.startsWith("- **#"));
    expect(lines).toHaveLength(4);
    // ⚠ EVERY BODY SURVIVES, including the ones aimed squarely elsewhere.
    expect(text).toContain("for somebody else entirely");
    expect(text).toContain("agent chatter");
    expect(text).toContain("a human talking to nobody");
    // ⚠ And the ones that are not mine carry NO mark rather than being hidden.
    expect(lines[1]).not.toContain("for you");
  });
});
