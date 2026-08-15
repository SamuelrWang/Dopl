/**
 * ⚠ THE HEADLINE INVARIANT, pinned from both sides:
 *   Chat mode NEVER opens a thread and NEVER addresses anyone.
 *   Request mode NEVER sends without a subject and a recipient.
 * A refactor collapsing these back into one send must fail here.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildComposerPayload,
  composerModeHelp,
  COMPOSER_MODE_OPTIONS,
  DEFAULT_COMPOSER_MODE,
  resolveRequestTarget,
  submitComposerDraft,
  type ComposerDraft,
} from "./composer-mode";

const PEER = "u-ada";

function draft(over: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    mode: "chat",
    body: "hello",
    subject: "",
    isDirect: false,
    peerId: null,
    toUserId: null,
    ...over,
  };
}

describe("composer mode defaults", () => {
  it("defaults to CHAT — the resting state must be the one that costs nothing", () => {
    expect(DEFAULT_COMPOSER_MODE).toBe("chat");
  });

  it("offers exactly the two modes, chat first", () => {
    expect(COMPOSER_MODE_OPTIONS.map((o) => o.key)).toEqual(["chat", "request"]);
  });
});

describe("buildComposerPayload — CHAT never becomes a thread", () => {
  it("builds an unaddressed chat payload stamped intent: chat", () => {
    const built = buildComposerPayload(draft({ body: "  morning  " }));
    expect(built).toEqual({
      ok: true,
      payload: { kind: "chat", body: "morning", intent: "chat" },
    });
  });

  it("stays chat even with a picked addressee left over from request mode", () => {
    const built = buildComposerPayload(
      draft({ toUserId: PEER, subject: "still here" })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.kind).toBe("chat");
    expect(built.payload).not.toHaveProperty("toUserId");
    expect(built.payload).not.toHaveProperty("title");
  });

  it("stays chat in a DM, where the peer used to be auto-addressed", () => {
    const built = buildComposerPayload(
      draft({ isDirect: true, peerId: PEER, subject: "hi" })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toEqual({
      kind: "chat",
      body: "hello",
      intent: "chat",
    });
  });

  it("refuses an empty (or whitespace-only) draft", () => {
    expect(buildComposerPayload(draft({ body: "   \n " }))).toEqual({
      ok: false,
      reason: "empty-body",
    });
  });
});

describe("buildComposerPayload — REQUEST requires a subject and a recipient", () => {
  it("builds the thread payload from subject + body + picked member", () => {
    expect(
      buildComposerPayload(
        draft({
          mode: "request",
          toUserId: PEER,
          subject: "  Migrate the schema  ",
          body: "  can you take this?  ",
        })
      )
    ).toEqual({
      ok: true,
      payload: {
        kind: "thread",
        title: "Migrate the schema",
        body: "can you take this?",
        toUserId: PEER,
      },
    });
  });

  it("REFUSES without a subject rather than guessing one from the body", () => {
    // ⚠ Never derive the title from the body's first line — it is what the
    // other operator reads in their consent prompt.
    expect(
      buildComposerPayload(
        draft({ mode: "request", toUserId: PEER, body: "first line\nsecond" })
      )
    ).toEqual({ ok: false, reason: "missing-subject" });
  });

  it("treats a whitespace-only subject as no subject", () => {
    expect(
      buildComposerPayload(
        draft({ mode: "request", toUserId: PEER, subject: "   " })
      )
    ).toEqual({ ok: false, reason: "missing-subject" });
  });

  it("refuses with nobody picked", () => {
    expect(
      buildComposerPayload(draft({ mode: "request", subject: "Do the thing" }))
    ).toEqual({ ok: false, reason: "missing-recipient" });
  });

  it("auto-targets the DM peer, so a DM request needs no picker", () => {
    const built = buildComposerPayload(
      draft({ mode: "request", isDirect: true, peerId: PEER, subject: "Ship it" })
    );
    expect(built.ok).toBe(true);
    if (!built.ok || built.payload.kind !== "thread") return;
    expect(built.payload.toUserId).toBe(PEER);
  });

  it("refuses a DM whose peer has not resolved yet", () => {
    expect(
      buildComposerPayload(
        draft({ mode: "request", isDirect: true, peerId: null, subject: "Ship it" })
      )
    ).toEqual({ ok: false, reason: "missing-recipient" });
  });

  it("ignores a stale picked addressee in a DM (the peer is the only target)", () => {
    const built = buildComposerPayload(
      draft({
        mode: "request",
        isDirect: true,
        peerId: PEER,
        toUserId: "u-someone-else",
        subject: "Ship it",
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok || built.payload.kind !== "thread") return;
    expect(built.payload.toUserId).toBe(PEER);
  });
});

describe("resolveRequestTarget", () => {
  it("prefers the DM peer over any picked addressee", () => {
    expect(
      resolveRequestTarget({ isDirect: true, peerId: PEER, toUserId: "other" })
    ).toBe(PEER);
  });

  it("uses the picked addressee in a normal channel", () => {
    expect(
      resolveRequestTarget({ isDirect: false, peerId: "ignored", toUserId: PEER })
    ).toBe(PEER);
  });
});

describe("the send gate is buildComposerPayload's own `ok`", () => {
  it("lets a plain chat draft send", () => {
    expect(buildComposerPayload(draft()).ok).toBe(true);
  });

  it("holds a request draft until it has both fields, and says which is missing", () => {
    expect(buildComposerPayload(draft({ mode: "request" }))).toEqual({
      ok: false,
      reason: "missing-recipient",
    });
    expect(
      buildComposerPayload(draft({ mode: "request", toUserId: PEER }))
    ).toEqual({ ok: false, reason: "missing-subject" });
    expect(
      buildComposerPayload(draft({ mode: "request", toUserId: PEER, subject: "x" }))
        .ok
    ).toBe(true);
  });
});

/**
 * ⚠ `useChannelMembers` is `keepPreviousData`, so for a frame or two after a
 * channel switch `members` is the PREVIOUS channel's roster, and request mode
 * is the one thing that turns a roster into a wire `toUserId`. Sharp case: a DM
 * sent before the roster lands resolves `peerId` to the last channel's peer →
 * 400 `ChannelAddresseeNotMemberError` with the optimistic row already painted.
 * The gate lives HERE, where the draft becomes a payload.
 */
describe("buildComposerPayload — a REQUEST refuses a stale roster (M4)", () => {
  it("blocks a DM request whose peer came from the previous channel's roster", () => {
    expect(
      buildComposerPayload(
        draft({
          mode: "request",
          isDirect: true,
          peerId: PEER,
          subject: "Ship it",
          rosterStale: true,
        })
      )
    ).toEqual({ ok: false, reason: "stale-roster" });
  });

  it("blocks a picked addressee too — a name picked off the old list is the same wrong id", () => {
    expect(
      buildComposerPayload(
        draft({
          mode: "request",
          toUserId: PEER,
          subject: "Ship it",
          rosterStale: true,
        })
      )
    ).toEqual({ ok: false, reason: "stale-roster" });
  });

  it("is checked BEFORE the target resolves, so the block does not depend on which field is missing", () => {
    expect(
      buildComposerPayload(draft({ mode: "request", rosterStale: true }))
    ).toEqual({ ok: false, reason: "stale-roster" });
  });

  it("does NOT gate chat: a chat send reads no roster, so a switch never blocks talking", () => {
    const built = buildComposerPayload(draft({ rosterStale: true }));
    expect(built).toEqual({
      ok: true,
      payload: { kind: "chat", body: "hello", intent: "chat" },
    });
  });

  it("clears itself the moment the roster is this channel's", () => {
    const settled = draft({
      mode: "request",
      isDirect: true,
      peerId: PEER,
      subject: "Ship it",
      rosterStale: false,
    });
    expect(buildComposerPayload(settled).ok).toBe(true);
  });

  it("an empty body still reports the empty body — the gate is not a catch-all", () => {
    expect(
      buildComposerPayload(
        draft({ mode: "request", body: "   ", rosterStale: true })
      )
    ).toEqual({ ok: false, reason: "empty-body" });
  });

  it("REFUSES rather than sends, through the submit path too", async () => {
    const onSend = vi.fn(async () => {});
    const onCreateThread = vi.fn(async () => ({}));
    const result = await submitComposerDraft({
      ...draft({
        mode: "request",
        isDirect: true,
        peerId: PEER,
        subject: "Ship it",
        rosterStale: true,
      }),
      onSend,
      onCreateThread,
    });
    expect(result).toBe("blocked");
    expect(onCreateThread).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("composerModeHelp — the stale-roster line (M4)", () => {
  /**
   * Send disabled AND the line says why. ⚠ The line must NOT name the addressee
   * it would otherwise resolve — that name is the previous channel's peer.
   */
  it("says the roster is loading, and names nobody, while it is stale", () => {
    expect(
      composerModeHelp("request", "Ada", { blocked: "stale-roster" })
    ).toBe("Loading who's in this channel…");
  });

  it("says it ahead of every other reason, including a missing subject", () => {
    expect(composerModeHelp("request", null, { blocked: "stale-roster" })).toBe(
      "Loading who's in this channel…"
    );
  });

  it("leaves chat's line alone — chat is never gated on the roster", () => {
    expect(composerModeHelp("chat", null, { blocked: "stale-roster" })).toBe(
      "Message the channel. No agent is started."
    );
  });
});

describe("composerModeHelp — the consequence, in one line", () => {
  it("says chat starts nothing", () => {
    expect(composerModeHelp("chat", "Ada")).toBe(
      "Message the channel. No agent is started."
    );
  });

  it("names whose agent a request starts", () => {
    expect(composerModeHelp("request", "Ada")).toBe(
      "Opens a thread and starts Ada's agent."
    );
  });

  it("says what is missing rather than promising an outcome", () => {
    expect(composerModeHelp("request", null)).toBe(
      "Pick who this is for. Sending opens a thread and starts their agent."
    );
  });

  /** ⚠ Chat's line is FIXED whatever is typed — `@` is plain text. */
  it("says the same thing whatever the body mentions", () => {
    expect(composerModeHelp("chat", null)).toBe(
      "Message the channel. No agent is started."
    );
    expect(composerModeHelp("chat", "Ada", { blocked: null })).toBe(
      "Message the channel. No agent is started."
    );
  });

  it("says WHY a request is held back on a missing subject", () => {
    expect(
      composerModeHelp("request", "Ada", { blocked: "missing-subject" })
    ).toBe("Add a subject. Ada sees it when they are asked to approve.");
  });

  it("does not nag about an empty body (it explains itself)", () => {
    expect(composerModeHelp("request", "Ada", { blocked: "empty-body" })).toBe(
      "Opens a thread and starts Ada's agent."
    );
  });

  it("uses no em dashes anywhere (product copy rule)", () => {
    const copy = [
      composerModeHelp("chat", null),
      composerModeHelp("request", "Ada"),
      composerModeHelp("request", "Ada", { blocked: "missing-subject" }),
      composerModeHelp("request", null),
    ].join(" ");
    expect(copy).not.toContain("—");
  });
});

describe("submitComposerDraft — which path a draft actually takes", () => {
  function spies() {
    return {
      onSend: vi.fn(async () => {}),
      onCreateThread: vi.fn(async () => ({})),
    };
  }

  it("posts a chat message with intent: chat and NO addressing", async () => {
    const s = spies();
    const result = await submitComposerDraft({ ...draft(), ...s });
    expect(result).toBe("sent");
    expect(s.onSend).toHaveBeenCalledWith("hello", { intent: "chat" });
    expect(s.onCreateThread).not.toHaveBeenCalled();
  });

  it("treats an @handle as plain text, addressing nobody", async () => {
    // Nothing resolves an `@` — body goes out verbatim, options carry intent.
    const s = spies();
    await submitComposerDraft({
      ...draft({ body: "@quartz @onyx work together on X" }),
      ...s,
    });
    expect(s.onSend).toHaveBeenCalledWith("@quartz @onyx work together on X", {
      intent: "chat",
    });
    expect(s.onCreateThread).not.toHaveBeenCalled();
  });

  it("never opens a thread from chat mode, even with everything else filled in", async () => {
    const s = spies();
    await submitComposerDraft({
      ...draft({ toUserId: PEER, subject: "Migrate", isDirect: true, peerId: PEER }),
      ...s,
    });
    expect(s.onCreateThread).not.toHaveBeenCalled();
    expect(s.onSend).toHaveBeenCalledWith("hello", { intent: "chat" });
  });

  it("opens a thread from request mode, title = subject", async () => {
    const s = spies();
    const result = await submitComposerDraft({
      ...draft({
        mode: "request",
        toUserId: PEER,
        subject: "Migrate the schema",
        body: "can you take this?",
      }),
      ...s,
    });
    expect(result).toBe("opened");
    expect(s.onCreateThread).toHaveBeenCalledWith({
      title: "Migrate the schema",
      body: "can you take this?",
      toUserId: PEER,
    });
    expect(s.onSend).not.toHaveBeenCalled();
  });

  it("blocks a request with no subject instead of downgrading it to a post", async () => {
    const s = spies();
    const result = await submitComposerDraft({
      ...draft({ mode: "request", toUserId: PEER }),
      ...s,
    });
    expect(result).toBe("blocked");
    expect(s.onSend).not.toHaveBeenCalled();
    expect(s.onCreateThread).not.toHaveBeenCalled();
  });

  it("blocks rather than posting when the surface has no create-thread path", async () => {
    const onSend = vi.fn(async () => {});
    const result = await submitComposerDraft({
      ...draft({ mode: "request", toUserId: PEER, subject: "Migrate" }),
      onSend,
    });
    expect(result).toBe("blocked");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("posts a SLASH DRAFT as ordinary text — there are no commands left", async () => {
    // No command lane at all — a leading slash is prose.
    const s = spies();
    for (const body of ["/new-agent scout", "/deploy now"]) {
      const result = await submitComposerDraft({ ...draft({ body }), ...s });
      expect(result).toBe("sent");
      expect(s.onSend).toHaveBeenCalledWith(body, { intent: "chat" });
      expect(s.onCreateThread).not.toHaveBeenCalled();
    }
  });
});
