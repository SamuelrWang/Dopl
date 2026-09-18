/**
 * **THE CHANNEL SURFACE'S HOST CONTRACT** — what a host may hand the surface
 * (`ChannelSurfaceSlots`, `ChannelSurfaceCapabilities`) and what the surface
 * hands back (`ChannelInfoTabContext`).
 *
 * Split out of `channel-surface.tsx` at §1's 500-line cap (wave 1A,
 * 2026-09-17): this is what a HOST reads, that file is the composition.
 * Types only — a host reads the contract without pulling the surface's tree in
 * — and `channel-surface.tsx` re-exports all of it, so no import path moved.
 */

import type { ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { MentionsBundle } from "./mentions-disclosure";
import type { ChannelHeaderEdit } from "./info-inline-edit";
import type { AuthorIndex } from "./view-model";
import type { ActivityBin } from "./thread-activity";
import type { ChannelMember } from "../types";

/** Which of the two ruled mentions faces a surface draws — one declaration. */
export type MentionsLayout = "disclosure" | "category";

/**
 * What this surface has ALREADY PAID FOR, handed to a host's added regions.
 *
 * ⚠ Every field here was added after a host dropped it: `mentions`
 * (2026-09-15), `headerEdit` (2026-09-17), then `members` / `index` /
 * `activity` / `channelName` in wave 1A (2026-09-17, F-723). A region may not
 * re-read any of them — two hooks on one key are two sources of truth.
 */
export interface ChannelInfoTabContext {
  /**
   * THE surface's refetch gate — hand it to every write a region makes.
   * ⚠ This is why the slot is a FUNCTION (2026-08-25): §7/§8 allow exactly ONE
   * `useRefetchGate` per live surface, and a finished `ReactNode` could only
   * mint a second one, which coordinates with nothing.
   */
  gate: MutationGate;
  /**
   * This surface's tags inbox, already read.
   * ⚠ The handlers cannot be minted downstream: `onOpen` marks read, lands the
   * CENTRE pane on the right transcript and fires the nonced scroll signal —
   * only the surface holds that selection state.
   * ⚠ Scoped by the surface's `workspaceId`, which for a home channel IS the
   * container id, so tenancy is settled by construction.
   */
  mentions: MentionsBundle;
  /**
   * The header write and its permission, already resolved (Samuel, 2026-09-17)
   * — the click-to-edit Name and Description rows.
   * ⚠ The DERIVED-NAME half is still the tab's (`info-tab-card.tsx ›
   * headerEditable`): a fact about the ROW, not about the reader.
   */
  headerEdit: ChannelHeaderEdit;
  /** This surface's roster (`channel-surface-data.ts › members`). */
  members: ChannelMember[];
  /**
   * RE-READ THE ROSTER — for a region whose write CHANGES it (R-09's Remove).
   * ⚠ The surface's own refetch, never a second `useMembers` in the region:
   * two hooks on one key are two sources of truth, which is the rule every
   * other field here was added to keep.
   */
  refetchMembers: () => void;
  /**
   * The author index, which carries the viewer (`index.currentUserId`).
   * ⚠ F-723: a roster drawn without it reported the OPERATOR offline in their
   * own home channel — `view-model.ts › isPresentForViewer`'s desktop override
   * fires only when the viewer is known.
   */
  index: AuthorIndex;
  /**
   * The 31-day message series this surface already read.
   * ⚠ Two fields, because `loading` is not `bins.length === 0` — an empty well
   * is a MEASURED zero, so the strip must tell "nobody counted yet" apart from
   * "counted, and it was quiet".
   */
  activity: { bins: readonly ActivityBin[]; loading: boolean };
  /**
   * The derived display name, settled upstream by `peerNamedHeader`.
   * ⚠ One derivation: /home used to re-derive it off the ACCOUNT projection, so
   * the pane header and the card's Name row could disagree.
   */
  channelName: string;
}

/**
 * **NAMED REGIONS A HOST MAY ADD TO THE ONE INFO BODY.** Never a body.
 *
 * 🔒 The return type is the fence (wave 1A, 2026-09-17). A `ReactNode` is what
 * a body IS, so a slot typed as one can always be handed a replacement — which
 * is how this surface lost four things in three weeks. A record of NAMED
 * positions cannot be: the host says *where*, the body decides whether that
 * place exists. A second region is a one-line addition the day a host needs one.
 */
export interface ChannelInfoExtras {
  /**
   * Under the member roster, at the foot of the tab — /home's Add person /
   * Link out pair, which sits under the list it changes (Samuel, 2026-08-25).
   */
  belowRoster?: ReactNode;
  /**
   * AT THE END OF EACH ROSTER ROW — /home's Remove / Leave (Samuel's ruling
   * R-09, 2026-09-17). ⚠ **A FUNCTION, AND THAT DOES NOT REOPEN THE `infoTab`
   * HOLE THE RETURN TYPE ABOVE CLOSED:** the fence is that a host may not hand
   * back a BODY, and this hands back one row's trailing control. The body still
   * decides whether the roster exists at all.
   */
  rosterRowAction?: (member: ChannelMember) => ReactNode;
}

export interface ChannelSurfaceSlots {
  /**
   * What this host ADDS to the Info tab — see {@link ChannelInfoExtras}.
   * A render function, not a node, so the regions reach this surface's one gate.
   *
   * ⚠ `infoTab` stood here and is DELETED, not deprecated (wave 1A,
   * 2026-09-17): it replaced the Info body, and `08-slot-audit.md` walked all
   * 78 slots in the tree to establish it was the only capability-LOSING one.
   * ⚠ The tab ROW is still not a slot and never becomes one. ⚠ Thread view
   * ignores this — the column is already thread-scoped (Samuel, 2026-08-21).
   */
  infoExtras?: (ctx: ChannelInfoTabContext) => ChannelInfoExtras;
}

/** Each flag NARROWS the workspace page's behaviour, except `artifacts`, which adds. */
export interface ChannelSurfaceCapabilities {
  /**
   * Whether this container's membership can be CHANGED. Default `true`.
   * `false` hides the invite affordances and the Settings tab's delete row, for
   * a container where "add members" cannot happen (§4A `LINK_CONTAINER_CLOSED`)
   * and deleting the one channel would strand it.
   */
  memberManagement?: boolean;
  /**
   * Whether this surface's HEADER may name the channel after its counterpart.
   * Default `true` — `channel-display.ts › channelDisplayName`.
   *
   * 🔒 `false` pins the header to `channel.name`, and /home passes it (Samuel,
   * 2026-09-01): a home container is a CHANNEL, not a DM, but every one minted
   * before the 2026-08-24 channel-first inversion still carries `is_direct`.
   * ⚠ A flag rather than an edit to `channel-display.ts`, because real DMs are
   * unaffected — what changed is which surfaces ASK it.
   */
  peerNamedHeader?: boolean;
  /**
   * Whether the VIEWER'S OWN STAKE — their membership row and the agent they
   * run here — is theirs to manage HERE. Default `true`; `false` hides "Leave
   * channel" AND the whole `ChannelAgentSettings` block.
   *
   * ⚠ One flag, two controls, one story (Samuel, R2/R3, 2026-08-25): the guest
   * lane runs no agent, and leaving is a one-way exit from its only surface.
   * ⚠ About the VIEWER, where `memberManagement` is about the CONTAINER.
   */
  selfManagement?: boolean;
  /**
   * Draw the ARTIFACTS FACE toggle in the Threads tab — this channel's folded
   * runs as openable cards (Samuel, 2026-09-16; `artifacts-tab.tsx`).
   *
   * ⚠ Default `false`, which inverts the others: they REMOVE, this ADDS.
   * ⚠ /home and the workspace channels page pass it (R-16, 2026-09-17); the
   * guest lane does not. A host that passes nothing fetches nothing and renders
   * the Threads tab byte for byte.
   * ⚠ `knowledge` stood beside this and is deleted with its whole lane
   * (Samuel's ruling R-18, 2026-09-17) — re-adding the face needs his word.
   */
  artifacts?: boolean;
  /**
   * **WHICH OF THE TWO RULED MENTIONS FACES THIS SURFACE DRAWS.** Default
   * `"disclosure"` — the workspace channels page's.
   *
   * 🔒 The one presentational difference Samuel ruled for (2026-09-15, live
   * review of the /home pane; carried into the one body in wave 1A):
   *   - `"disclosure"` — a collapsed row inside the Channel-info card, with an
   *     unread badge and the 28px hang (`mentions-disclosure.tsx`).
   *   - `"category"` — a top-level heading BELOW the activity strip, list always
   *     open, no badge, rows flush (`mentions-list.tsx`, `inset="flush"`).
   *
   * ⚠ ONE FLAG, NOT TWO: the position is part of the face. Samuel moved
   * Mentions below the strip in the same review that made it a category —
   * *facts, then what has been happening, then what is addressed to YOU, then
   * people* — and two flags would allow a collapsed row floating under the
   * strip, which is neither ruled face.
   * ⚠ Not a fork: both faces are one body's branch over one `mentions-list.tsx`.
   */
  mentionsLayout?: MentionsLayout;
}
