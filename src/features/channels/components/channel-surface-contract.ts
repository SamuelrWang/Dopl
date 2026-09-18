/**
 * **THE CHANNEL SURFACE'S HOST CONTRACT** — what a host may hand the surface
 * (`ChannelSurfaceSlots`, `ChannelSurfaceCapabilities`) and what the surface hands
 * back (`ChannelInfoTabContext`).
 *
 * ⚠ **ITS OWN FILE ON §1's CAP (wave 1A, 2026-09-17), AND THE SEAM IS THE HONEST
 * ONE.** `channel-surface.tsx` crossed 500 lines when the context took the four
 * facts F-723 and the slot audit found it was dropping. These three declarations
 * are the thing a HOST reads and the thing that changes when a host gains an
 * ability; the file next door is the composition, and it changes when a PANE
 * moves. They had already been diverging in edit rate for a month.
 *
 * ⚠ **TYPES ONLY, DELIBERATELY** — no component, no hook, nothing to import at
 * runtime, so a host may read the contract without pulling the surface's tree in.
 * `channel-surface.tsx` re-exports all three, so every existing import path is
 * unchanged (INVARIANTS §1: a split is a move, never a rename of a public name).
 */

import type { ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { MentionsBundle } from "./mentions-disclosure";
import type { ChannelHeaderEdit } from "./info-inline-edit";
import type { AuthorIndex } from "./view-model";
import type { ActivityBin } from "./thread-activity";
import type { ChannelMember } from "../types";

/**
 * What this surface hands an injected Info tab.
 *
 * ⚠ IT CARRIES THE GATE AND THAT IS WHY THE SLOT IS A FUNCTION (2026-08-25). The
 * person card is WRITE-BEARING, and INVARIANTS §7/§8 allow exactly ONE
 * `useRefetchGate` per live surface — a slot handed a finished `ReactNode` could
 * only mint a second one, which coordinates with nothing.
 */
export interface ChannelInfoTabContext {
  /** THE surface's refetch gate — hand it to every write the tab makes. */
  gate: MutationGate;
  /**
   * THIS SURFACE'S TAGS INBOX, ALREADY READ (2026-09-15).
   *
   * ⚠ **IT IS HANDED DOWN BECAUSE THE SLOT REPLACES THE BODY, AND THAT IS WHAT
   * LOST IT.** `surface-info-panel.tsx` fetches the mentions for EVERY mount,
   * home space included, and passes them to the default Info tab — so a surface
   * that injected its own tab paid for the read and then dropped the section on
   * the floor. The home space's Info tab had no Tags row for that reason alone,
   * not because the data was unavailable or wrongly scoped.
   *
   * ⚠ **THE HANDLERS CANNOT BE MINTED BY A TAB.** `onOpen` marks read, lands the
   * CENTRE PANE on the right transcript and then fires the nonced scroll signal;
   * only the surface holds the selection state that last step needs. A tab that
   * built its own would mark read and scroll nothing.
   *
   * ⚠ **THE QUERY IS SCOPED BY THE SURFACE'S `workspaceId`,** which for a home
   * channel IS the home CONTAINER id (`pages/home/relationship-record.tsx` passes
   * `homeChannel.workspaceId`). So the tenancy is the container's by
   * construction, and no caller may narrow or widen it here.
   */
  mentions: MentionsBundle;
  /**
   * THIS SURFACE'S HEADER WRITE AND ITS PERMISSION, ALREADY RESOLVED (Samuel,
   * 2026-09-17) — the click-to-edit Name and Description rows.
   *
   * ⚠ **IT RIDES WITH THE GATE FOR THE REASON `mentions` DOES.** Minted ONCE by
   * `surface-info-panel.tsx`, from this surface's single `useRefetchGate`
   * (§7/§8) and its mirror of `service-shared.ts › canManageChannel`, so ONE
   * object reaches the default Info tab and an injected one. Before this, a host
   * that replaced the body paid for the hook and dropped the edit — which is how
   * /home had a display-only card while the workspace page's edited in place.
   * ⚠ **A TAB MAY NOT MINT ITS OWN**: a second gate coordinates with nothing, and
   * the realtime doorbell repaints the old name mid-write.
   * ⚠ **THE DERIVED-NAME HALF IS STILL THE TAB'S** (`info-tab.tsx ›
   * headerEditable`) — a fact about the ROW, not about the reader.
   */
  headerEdit: ChannelHeaderEdit;
  /**
   * THIS SURFACE'S ROSTER, ALREADY READ (`channel-surface-data.ts › members`)
   * — wave 1A, 2026-09-17.
   *
   * ⚠ **A TAB OR AN EXTRA MAY NOT MOUNT ITS OWN.** Two `useChannelMembers` on
   * one key are two subscribers to one cache entry and two sources of truth for
   * one list; /home ran THREE of them (the surface's, `person-info-tab.tsx`'s
   * for the Creator row, and `person-members.tsx`'s for the roster) and the
   * second and third existed only because this field did not.
   */
  members: ChannelMember[];
  /**
   * THE AUTHOR INDEX, WHICH CARRIES THE VIEWER (`index.currentUserId`).
   *
   * 🔒 **IT IS NOT A CONVENIENCE, AND THE COST OF ITS ABSENCE WAS ON SCREEN**
   * (F-723). `member-roster.tsx › MemberRoster` feeds `viewerUserId` to
   * `view-model.ts › isPresentForViewer`, whose desktop override fires only when
   * the viewer is known — so a roster rendered without it reported the OPERATOR
   * OFFLINE in their own home channel while the workspace channels page, on the
   * same machine in the same second, showed them online.
   * ⚠ NEVER a second resolution and never a `useSession` mounted downstream: the
   * surface already holds this id.
   */
  index: AuthorIndex;
  /**
   * THE 31-DAY MESSAGE SERIES THIS SURFACE ALREADY READ
   * (`channel-surface-data.ts › activityBins` / `activityLoading`).
   *
   * ⚠ **A SECOND `useOverviewSeries` ON ONE KEY IS THE SAME DEFECT `members`
   * DESCRIBES**, and /home had one: `person-thread-activity.tsx` mounted the hook
   * the surface beside it had already mounted, with the identical arguments.
   * ⚠ **ONE OBJECT, TWO FIELDS, BECAUSE `loading` IS NOT `bins.length === 0`** —
   * an empty well means a MEASURED zero (`thread-activity.tsx`), so the strip has
   * to be able to tell "nobody counted yet" from "counted, and it was quiet".
   */
  activity: { bins: readonly ActivityBin[]; loading: boolean };
  /**
   * THE DERIVED DISPLAY NAME, SETTLED UPSTREAM by `peerNamedHeader`
   * (`channel-display.ts › channelDisplayName`, or `channel.name` when the
   * capability is off).
   *
   * ⚠ **ONE DERIVATION, NOT TWO.** /home re-derived it as
   * `pages/home/home-rows.ts › channelTitle` off the ACCOUNT projection, so the
   * pane header and the card's Name row read two different rows of one channel
   * and could disagree for exactly as long as the two caches disagreed.
   */
  channelName: string;
}

export interface ChannelSurfaceSlots {
  /**
   * REPLACES the Info tab's body in CHANNEL view — an account-level 1:1 shows a
   * person card where a workspace channel shows its metadata and roster.
   * ⚠ A RENDER FUNCTION, not a node — see {@link ChannelInfoTabContext}.
   *
   * ⚠ THE TAB ROW IS NOT A SLOT and never becomes one: a host that could delete a
   * tab could ship a surface missing one with nothing saying so. ⚠ THREAD VIEW
   * IGNORES IT — the column is already thread-scoped (Samuel, 2026-08-21;
   * `info-panel.tsx` owns the rule).
   */
  infoTab?: (ctx: ChannelInfoTabContext) => ReactNode;
}

export interface ChannelSurfaceCapabilities {
  /**
   * Whether this container's membership can be CHANGED. Default `true` — the
   * workspace page's behaviour. `false` hides the invite affordance and the
   * Settings tab's delete row, for a fixed two-person container where "add
   * members" cannot happen and deleting the one channel would strand it.
   */
  memberManagement?: boolean;
  /**
   * Whether this surface's HEADER may name the channel after its counterpart.
   * Default `true` — `channel-display.ts › channelDisplayName`.
   *
   * 🔒 **`false` PINS THE HEADER TO `channel.name`, AND /home PASSES IT (Samuel,
   * 2026-09-01).** A home container is a CHANNEL, not a DM. Its row and Info tab
   * were fixed at their own derivation (`pages/home/home-rows.ts › channelTitle`),
   * but this header reads a DIFFERENT one — so a container carrying
   * `is_direct = true` (every one minted before the 2026-08-24 channel-first
   * inversion) still showed the peer's name over a row that said the channel's.
   *
   * ⚠ **REAL DMs ARE UNAFFECTED, WHICH IS WHY THIS IS A FLAG AND NOT AN EDIT TO
   * `channel-display.ts`** — that module is the ONE counterpart derivation for the
   * workspace surfaces. What changed is which surfaces ASK it.
   */
  peerNamedHeader?: boolean;
  /**
   * Whether the VIEWER'S OWN STAKE — their membership row and the agent they run
   * here — is theirs to manage HERE. Default `true`; `false` hides "Leave channel"
   * AND the whole `ChannelAgentSettings` block.
   *
   * ⚠ ONE FLAG, TWO CONTROLS, BECAUSE THERE IS ONE STORY (Samuel, ruling R2/R3,
   * 2026-08-25): the GUEST LANE (`src/app/c/[workspaceId]`) runs no agent, so a
   * tool profile governs a session that does not exist, and leaving is a one-way
   * exit from their only surface. Two flags would let a host ship the other half's
   * dead control. ⚠ IT IS ABOUT THE VIEWER, WHERE `memberManagement` IS ABOUT THE
   * CONTAINER: /home passes `memberManagement: false` and leaves this one alone.
   */
  selfManagement?: boolean;
  /**
   * ⚠ **`knowledge` IS DELETED (Samuel's ruling R-18, 2026-09-17).** It drew a
   * fifth tab over bases granted into the channel. No host had passed it since
   * 2026-09-04 (the guest lane was the last, F-666), so the tab, its hook, its
   * client lane, its four API routes and this flag were unreachable product —
   * deleted, not parked (INVARIANTS §15). /home's Knowledge SHELF
   * (`pages/home/knowledge-panels.tsx`) is untouched and is the surface that
   * reads a granted base today. ⚠ Re-adding the FACE still needs Samuel's word.
   *
   * Draw the ARTIFACTS FACE toggle in the Threads tab — this channel's folded runs
   * as openable cards (Samuel, 2026-09-16; `artifacts-tab.tsx`).
   *
   * ⚠ DEFAULT `false`, WHICH INVERTS THE OTHER TWO: they REMOVE something, this
   * ADDS a control.
   *
   * ⚠ **EXACTLY ONE HOST PASSES IT — /home**, under Samuel's standing home-space
   * ruling for a new surface (2026-09-16). The workspace channel page and the guest
   * lane are LEFT ALONE rather than forgotten: this is not a tab (the row's width
   * budget is measured for four) and the reads mount with the face, so a host that
   * passes nothing fetches nothing and renders the Threads tab byte for byte.
   *
   * ⚠ SAFE ON ANY HOST REGARDLESS — the face reads the channel's own artifact route
   * at the same visibility gate the transcript already passed.
   */
  artifacts?: boolean;
}

