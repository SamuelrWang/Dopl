import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MessageComposer,
  resolveSendOptions,
  type SendOptions,
} from "./message-composer";
import { GROUP_CHANNEL_MIN_MEMBERS } from "../constants";
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
        // NOT a broadcast: the desktop's `classify` gives a 3+ member channel no
        // implicit recipient, so this message is picked up by no agent at all.
        body: "unaddressed",
      })
    ).toBeUndefined();
  });
});

/** A DM composer's markup (the shape that shows the Subject field). */
function dmMarkup() {
  return renderToStaticMarkup(
    <MessageComposer
      onSend={noop}
      members={roster}
      currentUserId={ME}
      isDirect
      placeholder="Message Ada"
    />
  );
}

describe("MessageComposer render (one unified input, no mode slider)", () => {
  it("renders exactly one textarea and no Message|Task slider in a DM", () => {
    const markup = dmMarkup();
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

/**
 * The unaddressed hint is the ONE web string that tells the truth about group
 * routing, and it was unpinned: nothing asserted it rendered at all, so a
 * refactor could have dropped it and left the surface silently teaching the DM
 * model. These cases pin BOTH directions — it must appear exactly where the
 * implicit recipient stops existing, and nowhere the implicit recipient still
 * does, or it becomes a false warning instead of a true one.
 */
const UNADDRESSED_HINT = "No agent will pick this up unless you address it.";

function channelMarkup(memberCount: number) {
  const members = Array.from({ length: memberCount }, (_, i) =>
    member({ userId: i === 0 ? ME : `u-${i}` })
  );
  return renderToStaticMarkup(
    <MessageComposer onSend={noop} members={members} currentUserId={ME} />
  );
}

describe("MessageComposer — the unaddressed-send hint (N-party honesty)", () => {
  it("warns in a channel at the group threshold, where nothing picks it up", () => {
    expect(channelMarkup(GROUP_CHANNEL_MIN_MEMBERS)).toContain(UNADDRESSED_HINT);
  });

  it("keeps warning above the threshold", () => {
    expect(channelMarkup(GROUP_CHANNEL_MIN_MEMBERS + 3)).toContain(
      UNADDRESSED_HINT
    );
  });

  it("stays silent one member below it, where the peer IS the implicit target", () => {
    // A two-member NON-direct channel still triggers on an unaddressed send
    // (`classify`'s knownTwo branch), so the warning would be a lie here.
    expect(channelMarkup(GROUP_CHANNEL_MIN_MEMBERS - 1)).not.toContain(
      UNADDRESSED_HINT
    );
  });

  it("never warns in a DM, which always has an implicit peer", () => {
    expect(dmMarkup()).not.toContain(UNADDRESSED_HINT);
  });

  it("stays silent while the roster is still loading rather than guessing", () => {
    // `useChannelMembers` yields [] before the first read resolves. Absent beats
    // wrong: a hint that flashes on every channel open would train it away.
    expect(channelMarkup(0)).not.toContain(UNADDRESSED_HINT);
  });
});

describe("MessageComposer chrome (shared with the desktop session window)", () => {
  it("uses the ONE shared send button, not a local send recipe", () => {
    const markup = dmMarkup();
    // The session window's face: raised black kit class, 30px, 8px radius.
    expect(markup).toContain("auth-btn-3d");
    expect(markup).toContain("h-[30px]");
    expect(markup).toContain("w-[30px]");
    expect(markup).toContain("rounded-[8px]");
    // The arrow glyph is the session window's path, not a lucide icon.
    expect(markup).toContain("M8 13V3.6M8 3.2 3.9 7.3M8 3.2l4.1 4.1");
    expect(markup).not.toContain("lucide-send-horizontal");
    // The accessible name the composer has always used is preserved.
    expect(markup).toContain('aria-label="Send message"');
  });

  it("caps the auto-grow at three lines and scrolls past it", () => {
    const markup = dmMarkup();
    // 1.625em per line (leading-relaxed) + 8px of py-1 padding: one line at rest,
    // three lines at the cap. The hook's inline height rides inside this clamp.
    expect(markup).toContain("min-h-[calc(1.625em_+_8px)]");
    expect(markup).toContain("max-h-[calc(4.875em_+_8px)]");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain('rows="1"');
    // The old fixed 10rem cap is gone.
    expect(markup).not.toContain("max-h-40");
  });

  it("labels the optional one-liner Subject, in a DM and in a channel", () => {
    const dm = dmMarkup();
    expect(dm).toContain('placeholder="Subject"');
    expect(dm).toContain('aria-label="Subject"');
    expect(dm).not.toContain("One-line intent");

    // The channel variant renders the same field once an addressee is picked;
    // the label constant is shared, so pin the DM copy and the absence of the
    // old string everywhere.
    const channel = renderToStaticMarkup(
      <MessageComposer
        onSend={noop}
        members={[member({ userId: ME }), member({ userId: PEER }), member({ userId: "third" })]}
        currentUserId={ME}
      />
    );
    expect(channel).not.toContain("One-line intent");
  });
});
