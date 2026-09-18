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
import type { ChannelInfoCardEdit } from "./info-card-rows";
import { channel, member, ME } from "./test-fixtures";
import type { Channel } from "../types";

afterEach(cleanup);

const MEMBERS = [member({ userId: ME, displayName: "Sam Wang" })];

function mountTab(
  over: Partial<Channel>,
  headerEdit?: ChannelHeaderEdit,
  channelName = "Website",
  infoCardEdit?: ChannelInfoCardEdit
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
      infoCardEdit={infoCardEdit}
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
    // — and since wave 1A (2026-09-17) that is the SAME body on both hosts.
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

/**
 * 🔒 **THE CURATED `channels.info_card` ROWS, ON THE SHARED BODY (Samuel's ruling
 * R-19, 2026-09-17).**
 *
 * ⚠ **WHAT THIS PINS IS A DATA TRAP CLOSING, NOT A FEATURE ARRIVING.** The column
 * is on `channels`, validated and PATCH-writable on EVERY channel, and until this
 * ruling only /home's card rendered it — so a workspace channel could carry
 * curated rows that no workspace surface showed. `grep -c infoCard info-tab.tsx`
 * was **0**.
 *
 * ⚠ **THE RENDERER IS `info-card-rows.tsx › InfoCardCustomRow`, THE ONE /home HAS
 * USED SINCE 2026-08-25** — pinned by asserting the row's own affordances (the
 * hover × and the value-as-edit-target), which a second, re-typed renderer would
 * not have.
 *
 * ⚠ **AND ABSENT `infoCardEdit` DRAWS NOTHING.** Every row carries a × and an
 * editable value; a body whose host has not wired the write would ship two dead
 * controls per row, and a × that does not remove reads as data loss. That case is
 * the last one here.
 *
 * MUTATION-VERIFY: drop the `infoCardEdit !== undefined` guard and the last case
 * fails; hand `onRemove` the wrong card and the removal case fails on the surviving
 * row's id.
 */
describe("the curated info-card rows", () => {
  const CARD = {
    hidden: [],
    rows: [
      { id: "r1", label: "Launch", value: "March" },
      { id: "r2", label: "Repo", value: "dopl/web" },
    ],
  };

  function saving() {
    const onSave = vi.fn();
    return { onSave, edit: { onSave } satisfies ChannelInfoCardEdit };
  }

  it("renders every stored row, label and value", () => {
    mountTab({ infoCard: CARD }, undefined, "Website", saving().edit);
    expect(screen.getByText("Launch")).toBeTruthy();
    expect(screen.getByText("March")).toBeTruthy();
    expect(screen.getByText("Repo")).toBeTruthy();
    expect(screen.getByText("dopl/web")).toBeTruthy();
  });

  it("carries the shared renderer's own affordances — the × and the edit target", () => {
    mountTab({ infoCard: CARD }, undefined, "Website", saving().edit);
    expect(screen.getByLabelText("Remove Launch from this card")).toBeTruthy();
    expect(screen.getByLabelText("Edit Launch")).toBeTruthy();
  });

  it("removes a row by handing the host the WHOLE next card", () => {
    // ⚠ The server REPLACES rather than merges (`service-writes.ts ›
    // updateChannel`), which is why the editors in `info-card.ts` return a whole
    // card and this body never assembles one itself.
    const { onSave, edit } = saving();
    mountTab({ infoCard: CARD }, undefined, "Website", edit);
    fireEvent.click(screen.getByLabelText("Remove Launch from this card"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].rows.map((r: { id: string }) => r.id)).toEqual([
      "r2",
    ]);
  });

  it("an EMPTY card draws no rows and no heading of its own", () => {
    mountTab({ infoCard: { hidden: [], rows: [] } }, undefined, "Website", saving().edit);
    expect(screen.queryByText("Launch")).toBeNull();
  });

  it("🔒 a host that wires NO card write draws no curated row at all", () => {
    // Not "draws them inert": a × that does not remove reads as data loss.
    mountTab({ infoCard: CARD });
    expect(screen.queryByText("Launch")).toBeNull();
    expect(screen.queryByLabelText("Remove Launch from this card")).toBeNull();
  });
});
