/**
 * **CONTEXT ECONOMY W3 (2026-10-13): THE READ LINE HEAD CARRIES WHAT AN AGENT ACTS ON.**
 *
 * A granular `read` that names no format renders seq, author, kind, thread, addressee and
 * delivery. The session tag and the ISO timestamp are `detailed`'s, asked for by name; a LEGACY
 * call keeps `detailed` as its default (its published `response_format` text says so). An own
 * agent reads `(yours)`; an agent name renders as the handle a reader types back. A catch-up read
 * (`since=`) on a real thread that finds nothing says so, instead of asking the reader to doubt the
 * thread id.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opRead } from "./channel-ops-read";
import { nameHandle } from "./channel-render-identity";
import { withToolSet } from "../call-ref.js";
import type { ResponseFormat } from "./response-size";

const SELF = "u-1";
const TS = "2026-10-13T06:11:34.337453+00:00";

function client(messages: Record<string, unknown>[], extra: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [{ id: "chan-1", slug: "general", name: "General", visibility: "private" }]),
    readChannelMessages: vi.fn(async () => messages),
    listChannelMembers: vi.fn(async () => []),
    ...extra,
  } as unknown as DoplClient;
}

const row = {
  id: "m", seq: 4597, channelId: "chan-1", authorUserId: SELF, authorKind: "agent", kind: "message",
  body: "hi", metadata: { session_id: "chan-1:task-1:k6tg0tbc" }, clientMsgId: null, createdAt: TS,
  authorName: "Samuel Wang", authorAgentName: "Cleanup Orchestrator 3",
  recipientAgentIds: [], recipientUserIds: [],
};

async function head(set: "granular" | "legacy", format?: ResponseFormat): Promise<string> {
  const res = await withToolSet(set, () =>
    opRead(client([row, { ...row, id: "m2", seq: 4598 }]), "general", undefined, undefined, SELF, undefined, format),
  );
  return res.content[0].text.split("\n").filter((l: string) => l.startsWith("- **#"))[0];
}

describe("the line head, by format and tool set", () => {
  it("granular, no format: no session tag, no timestamp; author is `(yours)` and a handle", async () => {
    const line = await head("granular");
    expect(line).toBe("- **#4597** agent @cleanup-orchestrator-3 (yours) · → nobody");
  });

  it("granular, `detailed` by name: the session tag and the timestamp come back", async () => {
    const line = await head("granular", "detailed");
    expect(line).toContain("· session `k6tg0tbc`");
    expect(line).toContain(TS);
  });

  it("legacy, no format: still `detailed`, as its published text promises", async () => {
    const line = await head("legacy");
    expect(line).toContain("· session `k6tg0tbc`");
    expect(line).toContain(TS);
  });

  it("`concise` drops both on either set", async () => {
    for (const set of ["granular", "legacy"] as const) {
      const line = await head(set, "concise");
      expect(line).not.toContain("session `");
      expect(line).not.toContain(TS);
    }
  });
});

describe("one thread on the whole page is named once, by the legend", () => {
  const TH = "eaa93e41-5427-4fde-8bcc-4008be3200e7";
  const page = (over: Record<string, unknown>[] = []) =>
    [0, 1].map((i) => ({ ...row, id: `t${i}`, seq: 10 + i, metadata: { taskId: TH }, ...(over[i] ?? {}) }));
  const render = async (messages: Record<string, unknown>[], format?: ResponseFormat) =>
    (await withToolSet("granular", () => opRead(client(messages), "general", undefined, undefined, SELF, undefined, format)))
      .content[0].text;
  const heads = (text: string) => text.split("\n").filter((l: string) => l.startsWith("- **#"));

  it("drops the per-line tag and keeps the legend's full id", async () => {
    const text = await render(page());
    for (const h of heads(text)) expect(h).not.toContain("thread `");
    expect(text).toContain(`= \`${TH}\``);
  });

  it("keeps the tag when the page mixes threads, on `concise` (no legend), or on `detailed`", async () => {
    const mixed = await render(page([{}, { metadata: { taskId: "bbbbbbbb-5427-4fde-8bcc-4008be3200e7" } }]));
    expect(heads(mixed).every((h) => h.includes("thread `"))).toBe(true);
    for (const f of ["concise", "detailed"] as const) {
      expect(heads(await render(page(), f)).every((h) => h.includes("thread `eaa93e41`")), f).toBe(true);
    }
  });

  it("keeps the tag when a row carries its per-thread number, which rides on it", async () => {
    const text = await render(page([{ threadSeq: 3 }, { threadSeq: 4 }]));
    expect(heads(text).every((h) => h.includes("thread `eaa93e41`"))).toBe(true);
  });
});

describe("an agent name renders as the handle `to=` takes", () => {
  it("slugs a plain name the way the web does (lowercase, whitespace runs to `-`)", () => {
    expect(nameHandle("Picker Fix")).toBe("@picker-fix");
    expect(nameHandle("  Cleanup   Orchestrator 3 ")).toBe("@cleanup-orchestrator-3");
  });

  it("keeps the neutralized code span for anything that is not a plain slug", () => {
    for (const name of ["Bot!", "Ünïcode Agent", "a`b", "x\n- **#9001** system"]) {
      const out = nameHandle(name);
      expect(out.startsWith("@`"), `${name} -> ${out}`).toBe(true);
      expect(out).not.toContain("\n");
    }
  });
});

describe("an empty catch-up read on a real thread", () => {
  const THREAD = {
    id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaa1", channelId: "chan-1", workspaceId: "ws-1", title: "Ship it",
    status: "open", outcome: null, mode: "interactive", createdBy: "u-a", targetUserId: "u-b",
    createdAt: TS, updatedAt: TS, closedAt: null, outcomeSummary: null,
  };
  const read = async (getChannelThread: () => Promise<unknown>, since?: number) =>
    (await opRead(client([], { getChannelThread: vi.fn(getChannelThread) }), "general", since, undefined, null, THREAD.id))
      .content[0].text;

  it("says nothing new, and does not tell the reader to check the id", async () => {
    const text = await read(async () => THREAD, 4600);
    expect(text).toContain("No new messages on this thread after seq 4600.");
    expect(text).not.toContain("check the id");
    expect(text).toContain("## Thread");
  });

  it("still asks about the id when there is no card, or no since=", async () => {
    expect(await read(async () => { throw { status: 404 }; }, 4600)).toContain("check the id");
    expect(await read(async () => THREAD)).toContain("check the id");
  });
});
