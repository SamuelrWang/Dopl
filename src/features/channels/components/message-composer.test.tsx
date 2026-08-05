/**
 * The composer's DECISION logic (which payload a draft becomes, what it
 * refuses) lives in `lib/composer-mode.ts` and is pinned there — this repo's
 * vitest runs in the node environment with no DOM, so the mode cannot be
 * clicked here. What these cases pin is the RENDERED surface: the pill exists
 * INSIDE the input, message is what first paint shows, and message's chrome
 * carries none of the request affordances.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { COMPOSER_MODE_LABEL, MessageComposer } from "./message-composer";
import type { SendOptions } from "../lib/composer-mode";
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

/** A DM composer's markup, at rest (chat mode). */
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

function channelMarkup(memberCount: number) {
  const members = Array.from({ length: memberCount }, (_, i) =>
    member({ userId: i === 0 ? ME : `u-${i}` })
  );
  return renderToStaticMarkup(
    <MessageComposer onSend={noop} members={members} currentUserId={ME} />
  );
}

describe("MessageComposer — the Message / Request pill (rollback §3.2)", () => {
  it("shows the picked mode on a closed pill, not two always-visible tabs", () => {
    const markup = dmMarkup();
    expect(markup).toContain(">Message<");
    // The dropdown is closed at first paint, so the OTHER slot is not rendered
    // at all. A two-tab row would have painted both.
    expect(markup).not.toContain(">Request<");
    expect(markup).not.toContain('role="tablist"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
  });

  /**
   * §3.2 puts the pill INSIDE the input bubble. Pinned positionally, because
   * "inside the bubble" is the whole of what this phase changed: the control and
   * the field it governs are one object now, and a refactor that floats it back
   * out into its own row would look fine and be the old design again.
   */
  it("renders the pill INSIDE the concave input bubble, before send", () => {
    const markup = dmMarkup();
    const bubbleAt = markup.indexOf("concave-field");
    const pillAt = markup.indexOf(`${COMPOSER_MODE_LABEL}: Message`);
    const sendAt = markup.indexOf('aria-label="Send message"');
    expect(bubbleAt).toBeGreaterThan(-1);
    expect(pillAt).toBeGreaterThan(bubbleAt);
    expect(sendAt).toBeGreaterThan(pillAt);
  });

  it("opens in MESSAGE, so the resting state starts nobody's agent", () => {
    const markup = dmMarkup();
    expect(markup).toContain(`aria-label="${COMPOSER_MODE_LABEL}: Message"`);
    expect(markup).not.toContain(`aria-label="${COMPOSER_MODE_LABEL}: Request"`);
  });

  it("states the CONSEQUENCE under the composer, not just the mode name", () => {
    expect(dmMarkup()).toContain("Message the channel. No agent is started.");
  });

  /**
   * The accessible name CONTAINS the visible word rather than replacing it: a
   * bare `aria-label="Send as"` hid the one word on the control that says what
   * it is currently set to, which is also the word voice control needs.
   */
  it("names the pill without hiding the label it is showing", () => {
    const markup = dmMarkup();
    expect(markup).toContain(`aria-label="${COMPOSER_MODE_LABEL}: Message"`);
  });

  it("uses no em dashes in the composer's own copy", () => {
    expect(dmMarkup()).not.toContain("—");
  });
});

describe("MessageComposer — message mode hides the request chrome", () => {
  it("shows NO subject field in a DM (the operator can just talk)", () => {
    // The bare Subject field above the input was the operator's complaint: it
    // was always there, and filling it always poked the peer's machine.
    expect(dmMarkup()).not.toContain('aria-label="Subject"');
  });

  it("shows NO subject field and NO address picker in a channel", () => {
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
    expect(markup).not.toContain('aria-label="Subject"');
    expect(markup).not.toContain("Ask a specific agent");
  });

  it("still renders exactly one textarea and one send button", () => {
    const markup = dmMarkup();
    expect((markup.match(/<textarea/g) ?? []).length).toBe(1);
    expect(markup).toContain("Send message");
  });

  it("disables send on an empty draft", () => {
    const markup = dmMarkup();
    const sendAt = markup.indexOf('aria-label="Send message"');
    const openedAt = markup.lastIndexOf("<button", sendAt);
    expect(markup.slice(openedAt, sendAt)).toContain("disabled");
  });
});

/**
 * The unaddressed hint used to fire on every group-channel draft. Message mode
 * reaching no agent is now the POINT, so the warning there would train itself
 * away; it survives only for a REQUEST with nobody picked (whose refusal is
 * pinned as `missing-recipient` in the lib test).
 */
const UNADDRESSED_HINT = "No agent will pick this up unless you address it.";

describe("MessageComposer — the unaddressed-send hint", () => {
  it("stays silent in MESSAGE mode at the group threshold (that is its job)", () => {
    expect(channelMarkup(GROUP_CHANNEL_MIN_MEMBERS)).not.toContain(
      UNADDRESSED_HINT
    );
  });

  it("keeps quiet above the threshold too, while message is the mode", () => {
    expect(channelMarkup(GROUP_CHANNEL_MIN_MEMBERS + 3)).not.toContain(
      UNADDRESSED_HINT
    );
  });

  it("never warns in a DM", () => {
    expect(dmMarkup()).not.toContain(UNADDRESSED_HINT);
  });

  it("stays silent while the roster is still loading rather than guessing", () => {
    expect(channelMarkup(0)).not.toContain(UNADDRESSED_HINT);
  });
});

describe("MessageComposer chrome (shared with the desktop thread window)", () => {
  it("uses the ONE shared send button, not a local send recipe", () => {
    const markup = dmMarkup();
    // The thread window's face: raised black kit class, 30px, 8px radius.
    expect(markup).toContain("auth-btn-3d");
    expect(markup).toContain("h-[30px]");
    expect(markup).toContain("w-[30px]");
    expect(markup).toContain("rounded-[8px]");
    // The arrow glyph is the thread window's path, not a lucide icon.
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

  it("never hardcodes a hex color (design tokens only)", () => {
    expect(dmMarkup()).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("MessageComposer — the surfaces that are GONE", () => {
  // The `@` mention popup and the `/new-agent` slash hint both existed to reach
  // NAMED AGENTS, and went with them (rollback §1). Pinned as absences so a
  // future composer change cannot quietly reintroduce either.
  function composer() {
    return renderToStaticMarkup(
      <MessageComposer onSend={noop} members={roster} currentUserId={ME} isDirect />
    );
  }

  it("offers no slash-command hint", () => {
    expect(composer()).not.toContain("/new-agent");
  });

  it("offers no agent mention list", () => {
    expect(composer()).not.toContain("quartz");
  });
});
