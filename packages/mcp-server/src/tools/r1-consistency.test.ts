/**
 * THE ROUND-1 CONSISTENCY BATCH, PINNED — the behaviours whose whole value is
 * that they say ONE thing in ONE way across two surfaces. Each of these was a
 * place where two tools, or a row and its heading, answered the same question
 * differently, so the test that matters is the CROSS-SURFACE one: a per-file
 * assertion would pass while the divergence it exists to stop came back.
 *
 * ⚠ It is one file rather than six because the unit under test is the
 * AGREEMENT, not any one module.
 */

import { describe, it, expect } from "vitest";
import type { ChannelMessage } from "@dopl/client";
import { duplicateNameNote } from "./duplicate-name";
import { AUDIENCE_LABELS } from "./audience-label";
import { bodyDigest, bodyFact } from "./body-digest";
import { formatAuthor, NO_MEMBER_VIEW, type MemberView } from "./channel-render-identity";
import { deliveryFact } from "./channel-facts";
import { GRANT_LEVEL_ARG_DESCRIPTION } from "./grant";
import { RESPONSE_FORMAT_FIELD } from "./response-size";

const ME = "11111111-1111-1111-1111-111111111111";
const HOME = "aaaaaaaa-0000-0000-0000-000000000001";
const CHANNEL = "bbbbbbbb-0000-0000-0000-000000000002";

// ── S42 / Q3 — the duplicate-name warning ───────────────────────────────────

describe("a create WARNS about a name already used in another container (Q3)", () => {
  const row = (id: string, name: string, workspaceId: string) => ({ id, name, workspaceId });

  it("names the other CONTAINER, tells the agent to rename or describe, and never refuses", () => {
    // ⚠ Samuel's ruling, verbatim: *"we should recommend to the agent to change
    // to prevent confusion, or if it's a resource that has a description
    // option, then it should clarify in description."* Both halves, one line.
    const note = duplicateNameNote(
      row("new", "Notes", CHANNEL),
      [row("new", "Notes", CHANNEL), row("old", "Notes", HOME)],
      "knowledge base",
      true,
    );
    expect(note).toContain(HOME);
    expect(note).toContain("DUPLICATE NAME");
    expect(note).toContain("Rename one of them");
    expect(note).toContain("`description`");
    // ⚠ IT IS A NOTE, NOT A REFUSAL — the same name in your home space and in a
    // channel is a shape the operator already uses.
    expect(note.startsWith("\n\n")).toBe(true);
  });

  it("is silent for a name that collides with nothing, and for the row's OWN container", () => {
    const alone = duplicateNameNote(row("new", "Notes", CHANNEL), [row("new", "Notes", CHANNEL)], "x", true);
    expect(alone).toBe("");
    // ⚠ TWO ROWS OF ONE NAME IN ONE CONTAINER IS NOT THIS WARNING'S CASE: the
    // slug collision that motivates it is ACROSS containers (`ambiguous_slug`).
    const sameContainer = duplicateNameNote(
      row("new", "Notes", CHANNEL),
      [row("new", "Notes", CHANNEL), row("other", "Notes", CHANNEL)],
      "x",
      true,
    );
    expect(sameContainer).toBe("");
  });

  it("folds case, because the resolvers do", () => {
    // `resolveTemplateRef` matches names case-insensitively and a base's slug is
    // folded from its name — so "Notes" and "notes" collide in exactly the way
    // this warns about.
    const note = duplicateNameNote(
      row("new", "Notes", CHANNEL),
      [row("new", "Notes", CHANNEL), row("old", "  notes ", HOME)],
      "agent template",
      false,
    );
    expect(note).toContain("agent template");
    // ⚠ NO DESCRIPTION BRANCH when the resource has no description to put it in.
    expect(note).not.toContain("`description`");
  });

  it("says nothing at all for an empty name — there is nothing to collide", () => {
    expect(duplicateNameNote(row("new", "  ", CHANNEL), [row("old", "", HOME)], "x", true)).toBe("");
  });
});

// ── S21 / S23 — the row label answers "who can see this" ────────────────────

describe("the audience label is a table both list surfaces read (S21/S23)", () => {
  it("never reads as a VISIBILITY COLUMN VALUE", () => {
    // ⚠ THE WHOLE POINT. A base shared into a home channel is STORED `private`,
    // so a row that printed its column said the opposite of the truth. Every
    // label here answers the reader's question instead of the database's.
    for (const label of Object.values(AUDIENCE_LABELS)) {
      expect(["private", "public", "workspace"]).not.toContain(label);
    }
    expect(AUDIENCE_LABELS.channel).toContain("channel");
    expect(AUDIENCE_LABELS.you).toBe("only you");
  });
});

// ── S33 / S47 — size and fingerprint, the same string on both sides ─────────

describe("a body's size and fingerprint read the same on a write and a read", () => {
  it("prints one string both surfaces can compare", () => {
    expect(bodyFact("hello")).toBe(`5 chars · sha256:${bodyDigest("hello")}`);
  });

  it("is stable, short, and changes with the body", () => {
    expect(bodyDigest("a")).toHaveLength(12);
    expect(bodyDigest("a")).toBe(bodyDigest("a"));
    expect(bodyDigest("a")).not.toBe(bodyDigest("b"));
  });

  it("distinguishes bodies a whitespace-only edit separates", () => {
    // ⚠ The question it answers is "did MY write land", and a trailing newline
    // is a real difference between two candidate bodies.
    expect(bodyDigest("x\n")).not.toBe(bodyDigest("x"));
  });
});

// ── S45 — a sibling agent is named as one ───────────────────────────────────

describe("a SIBLING agent renders `for you` (S45)", () => {
  const agentMsg = (authorUserId: string | null): ChannelMessage =>
    ({
      authorKind: "agent",
      authorUserId,
      authorName: "Samuel Wang",
      authorAgentName: "picker-fix",
      metadata: {},
    }) as unknown as ChannelMessage;

  it("says so when the author IS the reader's own account", () => {
    const view: MemberView = { selfUserId: ME, names: new Map() };
    const out = formatAuthor(agentMsg(ME), view);
    expect(out).toContain("for you");
    // ⚠ The handle is neutralized before it is spliced — this asserts the
    // rendered form, not the raw name.
    expect(out).toContain("picker-fix");
    // ⚠ THE OPERATOR CLAUSE IS REPLACED, NOT JOINED — the operator IS the reader.
    expect(out).not.toContain("Samuel Wang");
  });

  it("names the other member when the author is somebody ELSE's agent", () => {
    const view: MemberView = { selfUserId: "22222222-2222-2222-2222-222222222222", names: new Map() };
    const out = formatAuthor(agentMsg(ME), view);
    expect(out).toContain("Samuel Wang");
    expect(out).not.toContain("for you");
  });

  it("falls back to the old rendering when the caller is UNRESOLVED", () => {
    // ⚠ "I do not know who I am" must never render as "not yours" — the boot
    // ping can fail, and `selfUserId` is null then.
    expect(formatAuthor(agentMsg(ME), NO_MEMBER_VIEW)).toBe(formatAuthor(agentMsg(ME)));
    expect(formatAuthor(agentMsg(ME))).toContain("Samuel Wang");
  });

  it("never claims a sibling on a NULL author id", () => {
    const view: MemberView = { selfUserId: null, names: new Map() };
    expect(formatAuthor(agentMsg(null), view)).not.toContain("for you");
  });
});

// ── S26 — the delivery verdict names its own tense ──────────────────────────

describe("`delivery` says which tense it is in (S26)", () => {
  it("is an unmistakable predicted/receipt pair, not a question mark", () => {
    expect(deliveryFact("woken", null)).toBe("woken(predicted)");
    expect(deliveryFact("woken", "2026-09-18T00:00:00Z")).toBe("woken(confirmed)");
    // ⚠ A QUESTION MARK READ AS "THE SERVER IS UNSURE", which it never meant.
    expect(deliveryFact("woken", null)).not.toContain("?");
  });

  it("still distinguishes ABSENT from `none` — an older server computes neither", () => {
    expect(deliveryFact(undefined, null)).toBeUndefined();
    expect(deliveryFact(null, null)).toBeUndefined();
  });
});

// ── Q4 / S16 — two describes that had to stop saying something untrue ───────

describe("the pushed describes say what the code actually does", () => {
  it("a CHANNEL grant level is an audience, and it says peers get no write (Q4)", () => {
    expect(GRANT_LEVEL_ARG_DESCRIPTION).toContain("READ-ONLY");
    expect(GRANT_LEVEL_ARG_DESCRIPTION).toContain("AUDIENCES");
    // ⚠ **THE `guest_write` RULE IS NOT HERE, DELIBERATELY** — it is on the
    // grant RESULT (`grant.ts › levelReach`), which is per-call and outside the
    // pushed budget. A describe carries the CONTRACT of its argument.
    expect(GRANT_LEVEL_ARG_DESCRIPTION).not.toContain("guest_write");
  });

  it("`response_format` stops naming ops the tool it is on does not have (S16)", () => {
    const prose = (RESPONSE_FORMAT_FIELD as { description?: string }).description ?? "";
    // ⚠ ONE WORDING FOR FIVE TOOLS IS THE POINT, so the list stays a union —
    // what changed is that it now SAYS it is one.
    expect(prose).toMatch(/whichever of/i);
    expect(prose).toContain("THIS tool");
    expect(prose).not.toContain('op="read" / "status"');
    // ⚠ THE GUARANTEE IS WHAT MAKES THE KNOB SAFE TO REACH FOR, and it stayed
    // when the illustration was spent.
    expect(prose).toContain("never a body or a count");
  });
});
