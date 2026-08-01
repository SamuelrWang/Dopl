/**
 * THE HEADLINE INVARIANT, pinned from both sides:
 *
 *   Chat mode NEVER opens a thread and NEVER addresses anyone.
 *   Request mode NEVER sends without a subject and a recipient.
 *
 * Both used to be the same send, and that send always poked the other side's
 * machine. Everything below exists so a refactor that reintroduces one send
 * fails here instead of in someone's channel.
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
import type { ChannelAgent } from "../types";

const PEER = "u-ada";

function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return {
    id: "a1",
    channelId: "c1",
    workspaceId: "w1",
    ownerUserId: PEER,
    name: "quartz",
    status: "active",
    engagedAt: null,
    engagedBy: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

const ROSTER = [
  agent({ id: "a1", name: "quartz" }),
  agent({ id: "a2", name: "onyx" }),
];

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
    // This is the operator's actual complaint: a DM message was ALWAYS a
    // request, so there was no way to just talk to a teammate.
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

/**
 * THE OPERATOR'S CORE FLOW. Chat + @mentions is how an agent is given work, and
 * it is the one consequence in the composer decided by characters in the body
 * rather than by a control. It must address the AGENTS and never a person.
 */
describe("buildComposerPayload — CHAT addresses the agents the body mentions", () => {
  it("carries toAgents for a body that mentions agents, and no human addressee", () => {
    const built = buildComposerPayload(
      draft({ body: "@quartz @onyx work together on X", agents: ROSTER })
    );
    expect(built).toEqual({
      ok: true,
      payload: {
        kind: "chat",
        body: "@quartz @onyx work together on X",
        intent: "chat",
        toAgents: ["a1", "a2"],
      },
    });
  });

  it("OMITS toAgents entirely when nothing resolves (not an empty array)", () => {
    const built = buildComposerPayload(draft({ body: "morning", agents: ROSTER }));
    expect(built).toEqual({
      ok: true,
      payload: { kind: "chat", body: "morning", intent: "chat" },
    });
    if (!built.ok) return;
    expect(built.payload).not.toHaveProperty("toAgents");
  });

  it("still refuses to carry a human addressee, mentions or not", () => {
    const built = buildComposerPayload(
      draft({ body: "@quartz look", agents: ROSTER, toUserId: PEER, isDirect: true, peerId: PEER })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).not.toHaveProperty("toUserId");
    expect(built.payload).toHaveProperty("toAgents", ["a1"]);
  });

  it("addresses nobody when the surface has no agent roster", () => {
    const built = buildComposerPayload(draft({ body: "@quartz look" }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).not.toHaveProperty("toAgents");
  });

  it("REQUEST mode ignores mentions — a request is a title plus one person", () => {
    const built = buildComposerPayload(
      draft({
        mode: "request",
        body: "@quartz please",
        agents: ROSTER,
        toUserId: PEER,
        subject: "Migrate",
      })
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).not.toHaveProperty("toAgents");
    expect(built.payload.kind).toBe("thread");
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
    // The old composer used the body's first line as an implicit title. That
    // title is what the other operator reads in their consent prompt, so a
    // guessed one is how "asdf" becomes somebody's approval decision.
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

  /**
   * The consequence of a chat send now depends on characters in the body, so
   * the line has to move with them — and it names the RESOLVED handles, which
   * is the only way a typo announces itself before Enter.
   */
  it("names the agents that will act, from the resolved handles", () => {
    expect(composerModeHelp("chat", null, { mentionedHandles: ["quartz"] })).toBe(
      "quartz will act on this."
    );
    expect(
      composerModeHelp("chat", null, { mentionedHandles: ["quartz", "onyx"] })
    ).toBe("quartz and onyx will act on this.");
    expect(
      composerModeHelp("chat", null, {
        mentionedHandles: ["quartz", "onyx", "vega"],
      })
    ).toBe("quartz, onyx and vega will act on this.");
  });

  it("falls back to 'no agent is started' when nothing resolved", () => {
    expect(composerModeHelp("chat", null, { mentionedHandles: [] })).toBe(
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
      composerModeHelp("chat", null, { mentionedHandles: ["quartz", "onyx"] }),
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
      onCreateAgent: vi.fn(async () => ({})),
    };
  }

  it("posts a chat message with intent: chat and NO addressing", async () => {
    const s = spies();
    const result = await submitComposerDraft({ ...draft(), ...s });
    expect(result).toBe("sent");
    expect(s.onSend).toHaveBeenCalledWith("hello", { intent: "chat" });
    expect(s.onCreateThread).not.toHaveBeenCalled();
  });

  it("sends the mentioned agents as toAgents, and still no human addressee", async () => {
    const s = spies();
    await submitComposerDraft({
      ...draft({ body: "@quartz @onyx work together on X", agents: ROSTER }),
      ...s,
    });
    expect(s.onSend).toHaveBeenCalledWith("@quartz @onyx work together on X", {
      intent: "chat",
      toAgents: ["a1", "a2"],
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

  it("summons on /new-agent and NEVER posts, in either mode", async () => {
    for (const mode of ["chat", "request"] as const) {
      const s = spies();
      const result = await submitComposerDraft({
        ...draft({ mode, body: "/new-agent scout" }),
        ...s,
      });
      expect(result).toBe("created");
      expect(s.onCreateAgent).toHaveBeenCalledWith("scout");
      expect(s.onSend).not.toHaveBeenCalled();
      expect(s.onCreateThread).not.toHaveBeenCalled();
    }
  });

  it("posts an UNKNOWN command as chat text rather than swallowing it", async () => {
    const s = spies();
    await submitComposerDraft({ ...draft({ body: "/deploy now" }), ...s });
    expect(s.onCreateAgent).not.toHaveBeenCalled();
    expect(s.onSend).toHaveBeenCalledWith("/deploy now", { intent: "chat" });
  });

  it("propagates a failed create so the composer keeps the draft", async () => {
    const onSend = vi.fn(async () => {});
    const onCreateAgent = vi.fn(async () => {
      throw new Error("nope");
    });
    await expect(
      submitComposerDraft({
        ...draft({ body: "/new-agent" }),
        onSend,
        onCreateAgent,
      })
    ).rejects.toThrow("nope");
    expect(onSend).not.toHaveBeenCalled();
  });
});
