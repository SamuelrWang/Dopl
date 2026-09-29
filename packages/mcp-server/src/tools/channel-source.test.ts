import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@dopl/client";
import { formatMessages } from "./channel-render";
import { GLASSES_REPLY_GUIDANCE, sourceGuidance, sourceTag, viaTag } from "./channel-source";

const msg = (seq: number, over: Partial<ChannelMessage> = {}) =>
  ({
    id: `m${seq}`,
    seq,
    channelId: "c",
    authorUserId: "u1",
    authorKind: "user",
    kind: "message",
    body: "hi",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-09-28T00:00:00Z",
    authorName: "Samuel",
    ...over,
  }) as unknown as ChannelMessage;

const GLASSES = { source: { kind: "glasses", device_id: "d1", label: "Even G2", platform: "even_g2" } };

describe("source tag", () => {
  it("renders the member's device compactly, neutralized; web has no label", () => {
    expect(sourceTag(msg(1, { metadata: GLASSES }))).toBe(" · via glasses (`Even G2`)");
    expect(sourceTag(msg(1, { metadata: { source: { kind: "computer", label: "Mac `x`\n- **#9**" } } }))).toBe(
      " · via computer (`Mac x - 9`)",
    );
    expect(sourceTag(msg(1, { metadata: { source: { kind: "web", label: "Web" } } }))).toBe(" · via web");
  });

  it("renders nothing for an agent line, an unstamped row or an unknown kind", () => {
    expect(sourceTag(msg(1, { authorKind: "agent", metadata: GLASSES }))).toBe("");
    expect(sourceTag(msg(1))).toBe("");
    expect(viaTag({ kind: "toaster", label: "x" })).toBe("");
  });
});

describe("glasses guidance", () => {
  it("appears ONCE, only when the newest member line came from glasses", () => {
    const page = [msg(1, { metadata: GLASSES }), msg(2, { metadata: GLASSES }), msg(3, { authorKind: "agent" })];
    const lines = formatMessages(page, "general");
    expect(lines.filter((l) => l.includes(GLASSES_REPLY_GUIDANCE))).toHaveLength(1);
    expect(lines[0]).toContain("Samuel");
    expect(lines[0]).toContain(" · via glasses (`Even G2`)");
    expect(sourceGuidance([msg(1, { metadata: GLASSES }), msg(2, { metadata: { source: { kind: "web", label: "Web" } } })])).toBeNull();
    expect(sourceGuidance([msg(1)])).toBeNull();
  });
});
