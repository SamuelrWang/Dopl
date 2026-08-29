// @vitest-environment jsdom
/**
 * THE COMPOSER'S @-PICKER — F-210, both halves.
 *
 *  - **IT WAS INERT.** The popover listed candidates and highlighted the first,
 *    and nothing clicked, arrowed or Tabbed one into the draft. Samuel's
 *    interaction-completeness ruling treats an inert control on a wired surface
 *    as worse than an absent one.
 *  - **AND IT SUGGESTED WIDER THAN THE RESOLVER RESOLVES.** The filter is a
 *    SUBSTRING of the display label; `lib/mentions.ts` is lowercase EXACT
 *    equality against a handle set. So `@Tay` offered "Diana Taylor" and
 *    `@Taylor` tagged nobody.
 *
 * ⚠ THE FIX IS NOT A NARROWER FILTER. A picker suggests and a human confirms;
 * widening the resolver instead would tag `@dan` at everybody whose name
 * contains "dan". What the confirmation now inserts is
 * `lib/mentions.ts › insertableHandle` — derived from the resolver's OWN index
 * — so the inserted token resolves BY CONSTRUCTION. The last case in this file
 * is the one that matters: whatever the picker put in the draft, feed it back
 * through `buildMentionIndex` and it must name the person who was picked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: send },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

const send = vi.fn();

import { ChannelsV2Composer } from "./composer";
import {
  insertMentionHandle,
  mentionQuery,
  mentionSuggestions,
  MENTION_NO_MATCHES,
} from "./composer-mentions";
import { buildMentionIndex, resolveMentions } from "../../lib/mentions";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

const THIRD = "u-third";
const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang", email: "sam@example.com" }),
  member({
    userId: PEER,
    displayName: "Diana Taylor",
    email: "diana@example.com",
    role: "member",
  }),
  member({
    userId: THIRD,
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    role: "member",
  }),
];

beforeEach(() => send.mockClear());
afterEach(cleanup);

function mount() {
  render(
    <ChannelsV2Composer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
    />
  );
  return screen.getByLabelText("Message") as HTMLTextAreaElement;
}

const type = (field: HTMLTextAreaElement, value: string) =>
  fireEvent.change(field, { target: { value } });

const options = () => screen.queryAllByRole("option");
const highlighted = () =>
  options().find((o) => o.getAttribute("aria-selected") === "true");

describe("the picker opens and closes on the token", () => {
  it("opens on a trailing @token and lists the roster", () => {
    const body = mount();
    type(body, "hey @di");
    // ⚠ Matched by accessible NAME, not `textContent`: each row carries an
    // initials avatar, so its text is "DDiana Taylor".
    expect(options()).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Diana Taylor/ })).toBeTruthy();
  });

  it("does not open when the caret is not in a token", () => {
    const body = mount();
    type(body, "no tags here");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says NO MATCHES rather than vanishing mid-word", () => {
    // ⚠ A popover that disappears is indistinguishable from one that never
    // opened, and the reader is left typing at a control that gave up.
    const body = mount();
    type(body, "hey @zzzz");
    expect(screen.getByText(MENTION_NO_MATCHES)).toBeTruthy();
    expect(options()).toHaveLength(0);
  });
});

describe("selecting a candidate", () => {
  it("INSERTS on click, and the popover closes because the token is finished", () => {
    const body = mount();
    type(body, "hey @di");
    // ⚠ mouseDown, not click: a click steals focus from the textarea first.
    fireEvent.mouseDown(screen.getByRole("option", { name: /Diana Taylor/ }));
    expect(body.value).toBe("hey @diana-taylor ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves the highlight with the arrows and inserts the one it lands on", () => {
    const body = mount();
    type(body, "@a"); // Sam Wang (s-a-m? no) → matches "Diana Taylor"? no → "Ada Lovelace" + "Diana Taylor"
    const names = options().map((o) => o.textContent);
    expect(names.length).toBeGreaterThan(1);
    expect(highlighted()?.textContent).toBe(names[0]);

    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(highlighted()?.textContent).toBe(names[1]);

    fireEvent.keyDown(body, { key: "ArrowUp" });
    expect(highlighted()?.textContent).toBe(names[0]);
  });

  it("WRAPS at both ends, so the list has no dead direction", () => {
    const body = mount();
    type(body, "@a");
    const count = options().length;
    fireEvent.keyDown(body, { key: "ArrowUp" });
    expect(highlighted()?.textContent).toBe(
      options()[count - 1].textContent
    );
  });

  it("inserts on Enter", () => {
    const body = mount();
    type(body, "hey @di");
    fireEvent.keyDown(body, { key: "Enter" });
    expect(body.value).toBe("hey @diana-taylor ");
    // ⚠ AND DOES NOT SEND. Posting the half-typed `@di` instead is the
    // behaviour every chat client has trained the reader out of expecting.
    expect(send).not.toHaveBeenCalled();
  });

  it("inserts on Tab", () => {
    const body = mount();
    type(body, "hey @di");
    fireEvent.keyDown(body, { key: "Tab" });
    expect(body.value).toBe("hey @diana-taylor ");
  });

  it("leaves Shift+Enter alone — that is a line break, picker open or not", () => {
    const body = mount();
    type(body, "hey @di");
    fireEvent.keyDown(body, { key: "Enter", shiftKey: true });
    expect(body.value).toBe("hey @di");
    expect(send).not.toHaveBeenCalled();
  });

  it("still SENDS on Enter with no picker open", () => {
    const body = mount();
    type(body, "morning");
    fireEvent.keyDown(body, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/**
 * ⚠ THE IME GUARD COVERS THE WHOLE HANDLER, NOT JUST SEND. A composition's own
 * Enter CONFIRMS a candidate and its arrows MOVE through one; stealing either
 * rewrites what the IME is offering, or posts a half-typed word. The composer
 * already had this rule for Enter — the picker's keys inherit it.
 */
describe("the IME guard", () => {
  const composing = (key: string) => ({ key, isComposing: true });

  it("does not insert on an Enter that belongs to a composition", () => {
    const body = mount();
    type(body, "hey @di");
    fireEvent.keyDown(body, composing("Enter"));
    expect(body.value).toBe("hey @di");
  });

  it("does not move the highlight on a composition's arrows", () => {
    const body = mount();
    type(body, "@a");
    const first = highlighted()?.textContent;
    fireEvent.keyDown(body, composing("ArrowDown"));
    expect(highlighted()?.textContent).toBe(first);
  });

  it("does not send on a composition's Enter", () => {
    const body = mount();
    type(body, "morning");
    fireEvent.keyDown(body, composing("Enter"));
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * THE PROPERTY THE WHOLE FIX EXISTS FOR. Not "the inserted string looks like a
 * handle" — that it RESOLVES, through the very index the server's stamp is
 * built from.
 */
describe("what the picker inserts RESOLVES", () => {
  it("resolves to the member who was picked, through buildMentionIndex", () => {
    const body = mount();
    type(body, "hey @tay"); // ⚠ a SUBSTRING the resolver would never match
    fireEvent.keyDown(body, { key: "Enter" });

    expect(resolveMentions(body.value, MEMBERS)).toEqual([PEER]);
    const index = buildMentionIndex(MEMBERS);
    expect(index.get("dianataylor")).toBe(PEER);
  });

  it("is the case that used to fail: typing the SUGGESTED label tags nobody", () => {
    // The worked case from F-210. Kept as the contrast the fix is measured
    // against — the picker's suggestion is still wider than the resolver, and
    // that is correct; what changed is that there is now something to confirm
    // WITH.
    expect(resolveMentions("hey @Taylor", MEMBERS)).toEqual([]);
  });

  it("never offers a member whose every handle is CONTESTED", () => {
    // Ambiguity fails closed in the parser (rule 5), so a contested handle
    // resolves to nobody — offering it would be the inert control again, one
    // row deep.
    const twins = [
      member({ userId: "u-a", displayName: "Alex", email: null }),
      member({ userId: "u-b", displayName: "Alex", email: null }),
    ];
    expect(mentionSuggestions({ members: twins, currentUserId: ME, query: "ale" })).toEqual([]);
  });

  it("falls THROUGH a contested handle to one that still lands", () => {
    // `@diana` is contested by two Dianas; each full name is not.
    const twoDianas = [
      member({ userId: PEER, displayName: "Diana Taylor", email: null }),
      member({ userId: "u-d2", displayName: "Diana Prince", email: null }),
    ];
    expect(mentionSuggestions({ members: twoDianas, currentUserId: ME, query: "diana" }).map((s) => s.handle)).toEqual([
      "diana-taylor",
      "diana-prince",
    ]);
  });

  /**
   * THE HANDLE CONVENTION (Samuel, 2026-08-27): lowercase, spaces to hyphens.
   *
   * ⚠ WHAT THE PICKER INSERTS IS THE PRODUCT DECISION; what the RESOLVER accepts is wider, and
   * these two cases pin both halves. The slug is first in `handlesOf`, which is the only reason
   * `insertableHandle` returns it — an ordering change would silently move the convention back.
   */
  it("inserts the SLUG — `Samuel Wang` is `@samuel-wang`", () => {
    const roster = [member({ userId: PEER, displayName: "Samuel Wang", email: null })];
    expect(mentionSuggestions({ members: roster, currentUserId: ME, query: "samuel" }).map((s) => s.handle)).toEqual(["samuel-wang"]);
    // A one-word name has no whitespace to replace and is unchanged.
    const oneWord = [member({ userId: PEER, displayName: "Prince", email: null })];
    expect(mentionSuggestions({ members: oneWord, currentUserId: ME, query: "pri" }).map((s) => s.handle)).toEqual(["prince"]);
  });

  it("KEEPS resolving the older forms — bodies already written still tag", () => {
    // ⚠ THE TOKEN IS PLAIN TEXT IN THE BODY; there is no id under it. Dropping the squashed form
    // would un-tag every `@dianataylor` ever written, which is why the set only grows.
    const index = buildMentionIndex([
      member({ userId: PEER, displayName: "Diana Taylor", email: null }),
    ]);
    expect(index.get("diana-taylor")).toBe(PEER);
    expect(index.get("dianataylor")).toBe(PEER);
    expect(index.get("diana")).toBe(PEER);
  });
});

describe("the pure helpers", () => {
  it("reads the trailing token, lowercased, and nothing else", () => {
    expect(mentionQuery("hey @Di")).toBe("di");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("hey @di there")).toBeNull();
    expect(mentionQuery("mail@example.com")).toBeNull();
  });

  it("rewrites exactly the token the query read, and ends it with a space", () => {
    expect(insertMentionHandle("hey @di", "dianataylor")).toBe("hey @dianataylor ");
    expect(insertMentionHandle("@", "sam")).toBe("@sam ");
    // The rest of the draft is untouched.
    expect(insertMentionHandle("a @b c @d", "diana")).toBe("a @b c @diana ");
  });
});

/**
 * WHO THE PICKER OFFERS (Samuel, 2026-08-27).
 *
 * ⚠ NOT YOURSELF. The SERVER already drops the author from the stamped mention set
 * (`service-writes-metadata-mentions.ts`), so a row for your own name offered a token that reaches
 * nobody — an inert row in a picker whose whole job is that every row lands.
 * ⚠ BUT YOU STAY IN THE INDEX, which is a different question: ambiguity is a property of the ROOM
 * (rule 5), so dropping yourself from the DERIVATION would offer a peer's `@sam` as unambiguous
 * while your own name contested it, and the message would tag nobody.
 */
describe("who the picker offers", () => {
  it("never offers the caller", () => {
    const roster = [
      member({ userId: ME, displayName: "Samuel Wang" }),
      member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
    ];
    const rows = mentionSuggestions({ members: roster, currentUserId: ME, query: "" });
    expect(rows.map((r) => r.handle)).toEqual(["diana-taylor"]);
  });

  it("still COUNTS the caller for ambiguity — a contested handle reaches nobody", () => {
    // ⚠ THE CALLER IS ALSO A "Diana". Offering the peer `@diana` would insert a token the server
    // resolves to NEITHER of them.
    const roster = [
      member({ userId: ME, displayName: "Diana Prince" }),
      member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
    ];
    const rows = mentionSuggestions({ members: roster, currentUserId: ME, query: "diana" });
    expect(rows.map((r) => r.handle)).toEqual(["diana-taylor"]);
  });

  it("offers MY OWN AGENTS, by slugged name or `agent-<id>`", () => {
    const roster = [member({ userId: ME, displayName: "Samuel Wang" })];
    const agents = [
      { agentId: "k3v7d2mq", displayName: "Research Bot" },
      { agentId: "zzzzzzzz", displayName: null },
    ];
    const rows = mentionSuggestions({ members: roster, agents, currentUserId: ME, query: "" });
    expect(rows.map((r) => r.kind)).toEqual(["agent", "agent"]);
    // ⚠ THE SLUG WHERE THERE IS A NAME, the id form otherwise — `lib/agent-mentions.ts`'s rule,
    // and the SAME slugger the roster uses so one name cannot be spelled two ways.
    expect(rows.map((r) => r.handle)).toEqual(["research-bot", "agent-zzzzzzzz"]);
  });

  it("drops an agent whose name is contested — fail closed, as members do", () => {
    const agents = [
      { agentId: "k3v7d2mq", displayName: "Twin" },
      { agentId: "zzzzzzzz", displayName: "Twin" },
    ];
    const rows = mentionSuggestions({ members: [], agents, currentUserId: ME, query: "twin" });
    expect(rows).toEqual([]);
  });
});

/**
 * THE PICKER BELONGS TO THE CHAT FIELD AND GOES WHERE IT GOES (2026-08-28).
 *
 * ⚠ TWO WAVES, ONE SURFACE, AND THE SEAM BETWEEN THEM IS WHAT THIS PINS. "One edit surface at a
 * time" (2026-08-26) UNMOUNTS the chat textarea while either panel is open; the @-picker
 * (2026-08-27) is a pure function of the DRAFT (`mentionQuery`), and a draft is state that
 * survives the unmount. So a half-typed `@di` left in the box kept the popover floating over the
 * panel, anchored to a field that was no longer there — and the `@` glyph, which appends its
 * token to that same invisible draft and then focuses a null ref, was a control whose only
 * effect was to summon it.
 *
 * ⚠ THE PROPERTY IS AN ABSENCE, which is the kind that comes back silently: nothing else in this
 * file or in `composer.test.tsx` fails if the popover starts rendering over a panel again.
 * ⚠ AND THE DRAFT MUST SURVIVE, which is the other half — a fix that CLEARED the draft would
 * make this absence true and throw away the operator's half-typed message to do it.
 */
describe("the picker is gone while a panel is open", () => {
  const openThreadPanel = () =>
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

  it("takes the popover down with the field, and brings both back", () => {
    const body = mount();
    type(body, "hey @di");
    expect(options().length).toBeGreaterThan(0);

    openThreadPanel();
    // The field went (the 2026-08-26 rule) — and so must the popover anchored to it.
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Mention a member" })).toBeNull();
    expect(options()).toEqual([]);

    // ⚠ THE DRAFT IS STILL THERE. Shutting the panel restores the half-typed message AND its
    // popover — the state the operator left, not a cleared box.
    fireEvent.click(screen.getByRole("button", { name: "Close new thread" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("hey @di");
    expect(options().length).toBeGreaterThan(0);
  });

  it("takes the `@` glyph too — a control that could only misfire", () => {
    mount();
    expect(screen.getByRole("button", { name: "Mention" })).toBeTruthy();
    openThreadPanel();
    // ABSENT, not disabled: with a panel up there is no chat field to mention into at all.
    expect(screen.queryByRole("button", { name: "Mention" })).toBeNull();
  });
});
