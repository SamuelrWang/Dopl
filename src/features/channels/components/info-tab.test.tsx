// @vitest-environment jsdom
/**
 * THE CHANNEL INFO TAB's NAME AND DESCRIPTION ROWS — what they SAY (ruling,
 * Samuel, 2026-09-15) and, since 2026-09-16, that they EDIT IN PLACE.
 *
 * ⚠ **THE ROW IS `channels.topic` WEARING THE PRODUCT'S WORD** — pinned here so
 * a later wave cannot "fix" the label/field mismatch by adding a second field.
 *
 * ⚠ THE EMPTY CASE IS THE ONE THAT ROTS QUIETLY: the column is `NOT NULL DEFAULT
 * ''`, so an absent description is the COMMON row and a blank cell would read as
 * a render bug. "None", muted, no explainer sentence (minimal-copy ruling) — and
 * since the edit landed it is also the CLICK TARGET, which is why the empty case
 * has a case of its own below and not only a display assertion.
 *
 * ⚠ **THE DISPLAY CASES MOUNT WITHOUT `headerEdit` ON PURPOSE.** Absent is the
 * face a host that has not wired the write gets, so keeping the original cases
 * on it is what proves the edit ADDED a face rather than replacing one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InfoTab } from "./info-tab";
import type { ChannelHeaderEdit } from "./info-inline-edit";
import { channel, member, ME } from "./test-fixtures";
import type { Channel } from "../types";

afterEach(cleanup);

const MEMBERS = [member({ userId: ME, displayName: "Sam Wang" })];

function mountTab(
  over: Partial<Channel>,
  headerEdit?: ChannelHeaderEdit,
  channelName = "Website"
) {
  render(
    <InfoTab
      channel={channel(over)}
      channelName={channelName}
      members={MEMBERS}
      mentions={[]}
      mentionsTruncated={false}
      mentionsLoading={false}
      index={{ currentUserId: ME, byId: new Map(), agents: new Map() }}
      onOpenMention={vi.fn()}
      onMarkAllMentionsRead={vi.fn()}
      headerEdit={headerEdit}
    />
  );
}

function mount(topic: string) {
  mountTab({ topic });
}

/** A wired host: manage rights, both verbs spied. */
function editing(over: Partial<ChannelHeaderEdit> = {}) {
  const edit: ChannelHeaderEdit = {
    canEdit: true,
    onSaveName: vi.fn(),
    onSaveTopic: vi.fn(),
    busy: false,
    ...over,
  };
  return edit;
}

const nameField = () => screen.getByLabelText("Channel name") as HTMLInputElement;
const topicField = () =>
  screen.getByLabelText("Channel description") as HTMLInputElement;

describe("the Description row", () => {
  it("shows the channel's own topic under the product's word", () => {
    mount("The redesign");
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("The redesign")).toBeTruthy();
  });

  it("says None — not an empty cell — when the channel has no description", () => {
    mount("");
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
  });

  it("sits between Name and Creator, where the subject's own facts are", () => {
    // ⚠ POSITION IS THE ASSERTION: the card reads subject → what it is about →
    // who made it. The same ladder is composed a second time on /home
    // (`apps/desktop-ui › person-info-tab.tsx`), and the two are meant to match.
    mount("The redesign");
    const name = screen.getByText("Name");
    const description = screen.getByText("Description");
    const creator = screen.getByText("Creator");
    expect(
      name.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(creator) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

/**
 * 🔒 **NAME AND DESCRIPTION EDIT IN PLACE** (Samuel, 2026-09-16), superseding the
 * *"DISPLAY ONLY: editing a channel's header is channel management's"* ruling
 * this file used to encode by omission.
 *
 * ⚠ **THE FOUR CASES ARE THE FOUR WAYS THIS GOES WRONG**, not a walk of the
 * happy path: a DM offering a field bound to a column nobody reads; a viewer
 * offered an affordance the PATCH will 403; a blur writing a value that did not
 * move; and an empty name emptying a room nobody can find again.
 */
describe("click-to-edit — the Name row", () => {
  it("opens on the STORED name and saves on blur", () => {
    // ⚠ THE READ FACE IS THE DERIVED NAME AND THE FIELD IS THE STORED ONE, which
    // is only visible when they differ — so the mount names the channel one thing
    // and hands `channelName` another.
    const edit = editing();
    mountTab({ name: "Website" }, edit, "Website");
    fireEvent.click(screen.getByLabelText("Edit Channel name"));
    expect(nameField().value).toBe("Website");
    fireEvent.change(nameField(), { target: { value: "  Marketing site  " } });
    fireEvent.blur(nameField());
    // ⚠ TRIMMED, because the server's `safeLabel` will trim it anyway and the
    // caller must not learn a different string than the one that was stored.
    expect(edit.onSaveName).toHaveBeenCalledWith("Marketing site");
  });

  it("writes NOTHING when the value did not move", () => {
    // ⚠ A CLICK THAT ONLY PASSED THROUGH A LINE IS NOT AN EDIT. The PATCH would
    // bump `updated_at` — the channels list's sort key — and reorder somebody's
    // sidebar because they looked at a name.
    const edit = editing();
    mountTab({ name: "Website" }, edit);
    fireEvent.click(screen.getByLabelText("Edit Channel name"));
    fireEvent.blur(nameField());
    expect(edit.onSaveName).not.toHaveBeenCalled();
  });

  it("🔒 refuses an EMPTY name — it is a cancel, not an empty room", () => {
    // ⚠ The server refuses it (`safeLabel` has a min) and a channel with no name
    // cannot be found again in anybody's sidebar, so the line must not send one.
    const edit = editing();
    mountTab({ name: "Website" }, edit);
    fireEvent.click(screen.getByLabelText("Edit Channel name"));
    fireEvent.change(nameField(), { target: { value: "   " } });
    fireEvent.blur(nameField());
    expect(edit.onSaveName).not.toHaveBeenCalled();
  });

  it("Escape cancels without writing", () => {
    const edit = editing();
    mountTab({ name: "Website" }, edit);
    fireEvent.click(screen.getByLabelText("Edit Channel name"));
    fireEvent.change(nameField(), { target: { value: "Nope" } });
    fireEvent.keyDown(nameField(), { key: "Escape" });
    expect(edit.onSaveName).not.toHaveBeenCalled();
  });
});

describe("click-to-edit — the Description row", () => {
  it("saves on blur, and an EMPTY description is legal — it clears the row", () => {
    // ⚠ THE ASYMMETRY WITH `name` IS THE RULING: the column is NOT NULL DEFAULT
    // '', so clearing a description is a real edit where clearing a name is not.
    const edit = editing();
    mountTab({ topic: "The redesign" }, edit);
    fireEvent.click(screen.getByLabelText("Edit Channel description"));
    fireEvent.change(topicField(), { target: { value: "" } });
    fireEvent.blur(topicField());
    expect(edit.onSaveTopic).toHaveBeenCalledWith("");
  });

  it("opens from the EMPTY face — None is the click target, not the value", () => {
    const edit = editing();
    mountTab({ topic: "" }, edit);
    // ⚠ The read face still says None (the display case above pins that); what
    // this asserts is that the FIELD opens on the empty string rather than on
    // the word, which is how a placeholder becomes somebody's description.
    fireEvent.click(screen.getByLabelText("Edit Channel description"));
    expect(topicField().value).toBe("");
  });
});

describe("who gets the editable face", () => {
  it("🔒 a DM stays DISPLAY-ONLY on both rows", () => {
    // ⚠ A 1:1 IS TITLED AFTER THE OTHER MEMBER, so `channel.name` is a column
    // nobody reads: a field bound to it lets somebody type over an invisible
    // value, and one bound to the derived name writes the peer's name into the
    // room. Neither is an edit (`info-tab.tsx › headerEditable`).
    mountTab({ isDirect: true, name: "dm-key" }, editing(), "Anthony");
    expect(screen.queryByLabelText("Edit Channel name")).toBeNull();
    expect(screen.queryByLabelText("Edit Channel description")).toBeNull();
    // ⚠ AND THE DERIVED NAME IS WHAT IS SHOWN — the stored column never surfaces.
    expect(screen.getByText("Anthony")).toBeTruthy();
    expect(screen.queryByText("dm-key")).toBeNull();
  });

  it("🔒 a reader who may not MANAGE the channel sees no editor", () => {
    // ⚠ The server gates both fields on manage (`service-writes-channel.ts ›
    // MANAGED_CHANNEL_FIELDS`); an affordance that always ends in a 403 is a
    // dead control (INVARIANTS §5). The LINES stay — they are the room's label.
    mountTab({ name: "Website" }, editing({ canEdit: false }));
    expect(screen.queryByLabelText("Edit Channel name")).toBeNull();
    expect(screen.queryByLabelText("Edit Channel description")).toBeNull();
    expect(screen.getByText("Website")).toBeTruthy();
    expect(screen.getByText("The redesign")).toBeTruthy();
  });

  it("a host that wires NOTHING gets the display face", () => {
    mountTab({ name: "Website" });
    expect(screen.queryByLabelText("Edit Channel name")).toBeNull();
    expect(screen.queryByLabelText("Edit Channel description")).toBeNull();
  });
});
