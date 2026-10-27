import { useState } from "react";
import { PanelHeading } from "@/features/channels/components/bits";
import {
  EMPTY_WORKSPACE_ROLE,
  type Channel,
  type ChannelMember,
} from "@/features/channels/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { canShowMemberControls } from "@/features/workspaces/member-policy";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { AddPersonDialog } from "./add-person-dialog";
import { LinkOutPanel } from "./link-out-panel";
import { useRemoveContainerMember } from "./home-writes";

/**
 * **THE ONE ACT THAT CHANGES A HOME CONTAINER'S ROSTER** — Add person, or the
 * Link out panel when an invitation is already open (Samuel, 2026-08-25). It is
 * the shared Info body's `belowRoster` region and nothing else since wave 1A
 * (2026-09-17): the heading, the count and the roster are `info-tab.tsx`'s, and
 * drawing a second roster here is how this file came to pass no `viewerUserId`
 * and report the operator OFFLINE in their own channel (F-723).
 *
 * ⚠ A REGION, NOT A CAPABILITY, because the act is different in KIND: a link
 * container's roster cannot be added to the way a workspace channel's can (§4A
 * — every workspace-level add answers `LINK_CONTAINER_CLOSED`), so the link
 * claim is the only door and Add person is a link MINT, not a member picker.
 * It sits UNDER the list it changes, which is what the region is named for.
 *
 * ⚠ ADD PERSON NEVER GOES AWAY ON HEADCOUNT (Samuel, 2026-08-26: a home channel
 * takes MORE THAN TWO people). Do not reinstate a `peer`-shaped gate — the
 * roster length is not a capacity any more.
 *
 * 🔒 BUT IT IS ROLE-GATED, WHICH IS NOT A CAPACITY GATE (2026-09-17, F-343).
 * Minting a bound link is `member`+ on the server (`service-writes.ts ›
 * mintContainerLink`, `LINK_MINT_FORBIDDEN`); without that floor a guest
 * somebody else let in could hand strangers links into the operator's
 * transcript. Hidden, not disabled — a picture of the server's fence, not a
 * second one (INVARIANTS §5).
 *
 * ⚠ ONE SECTION, TWO STATES, NEVER BOTH: a container may hold at most one OPEN
 * link (`channel_links_one_open_per_workspace`), so offering the act beside a
 * live invitation would mint over a URL the operator has already sent.
 */
export function PersonRosterActions({
  homeChannel,
}: {
  homeChannel: Channel;
}) {
  // ⚠ `?? null` INLINE (§8): `linkOut` is one of the projection's new keys, and
  // `undefined` must read as "no invitation out", never as one.
  const linkOut = homeChannel.linkOut ?? null;
  // ⚠ **THE WORKSPACE ROLE, NOT `Channel.role`** — minting is floored on
  // `workspace_members.role`, which is the only ladder that has a `guest` rung.
  // ⚠ §8 STALE-CACHE, spelled inline: `EMPTY_WORKSPACE_ROLE` (rank 0) takes the
  // button off for one paint rather than offering a mint the server would refuse.
  const canAddPerson = meetsMinRole(
    homeChannel.myWorkspaceRole ?? EMPTY_WORKSPACE_ROLE,
    "member"
  );

  if (linkOut) {
    return (
      <>
        <PanelHeading title="Link out" />
        <div className="px-3.5">
          <LinkOutPanel link={linkOut} />
        </div>
      </>
    );
  }
  if (!canAddPerson) return null;
  // ⚠ NO HEADING (Samuel, 2026-08-25): the control says what it does. The Link
  // out state keeps its heading because the panel under it is FACTS.
  return (
    <div className="px-3.5 pt-2.5">
      <AddPersonDialog workspaceId={homeChannel.workspaceId} />
    </div>
  );
}


/**
 * **THE ROSTER ROW'S ONE ACT — Remove somebody, or Leave** (Samuel's ruling
 * R-09, 2026-09-17: *"add remove + leave"*). It renders into the shared Info
 * body's per-row slot (`channel-surface-contract.ts › rosterRowAction`), so
 * /home adds a control to the one roster rather than growing a second.
 *
 * 🔒 **THE TWO GATES ARE PICTURES OF THE SERVER'S, NOT FENCES** (INVARIANTS §5),
 * and each clause below is one of the server's refusals rather than a judgement:
 *  - **Remove** — `admin`+ (`removeMember`'s first line) narrowed per row by
 *    `member-policy.ts › canShowMemberControls`, the one policy the members
 *    console reads too: never self, never an owner.
 *  - **Leave** — the viewer's OWN row, `viewer`+ and not the owner.
 *    `leaveWorkspace` has NO floor of its own; the `viewer` one is the DELETE
 *    route's resolver default, which 404s a guest, and the owner is a link
 *    container's LAST owner (`WORKSPACE_LAST_OWNER`). ⚠ **AN `admin` AND A
 *    `viewer` BOTH GET IT** — a legacy unbound claim seats its claimer at
 *    `admin` and a bound link may grant `viewer` (`home/schema.ts`), and the
 *    server lets both walk out.
 *
 * ⚠ **A HOME SPACE FALLS OUT OF THOSE TWO AND NEEDS NO THIRD RULE**: its
 * one member is its owner, so the row is self (no Remove) and the owner (no
 * Leave). The server refuses it besides — `leaveWorkspace` runs
 * `assertWorkspacePermanentById` (R-35).
 *
 * ⚠ **CONFIRMED, NOT ONE-CLICK.** Both are membership DELETEs, and leaving a
 * link container is one-way: the claim link that let the viewer in was spent.
 * ⚠ **AND THE CONFIRM IS `ConfirmDialog`, NOT `FormDialog`** (2026-09-17) —
 * `shared/ui/form-dialog.tsx`'s own rule. It was a fieldless `FormDialog`, which
 * gave a destructive act the affirmative black CTA and no way to retry a refusal.
 */
export function PersonRosterRowAction({
  member,
  homeChannel,
  viewerUserId,
  onRosterChanged,
  onLeft,
}: {
  member: ChannelMember;
  homeChannel: Channel;
  /** `AuthorIndex.currentUserId` — the surface's viewer, never a second read. */
  viewerUserId: string | null;
  onRosterChanged: () => void;
  /** The viewer left: the container is gone from their /home. */
  onLeft: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // ⚠ **THE WORKSPACE ROLE, NOT `Channel.role`** — membership is what both
  // writes are floored on, and it is the only ladder with a `guest` rung.
  // ⚠ §8 STALE-CACHE, spelled inline: `EMPTY_WORKSPACE_ROLE` (rank 0) shows
  // neither control for one paint rather than offering a DELETE the server
  // would refuse.
  const role = homeChannel.myWorkspaceRole ?? EMPTY_WORKSPACE_ROLE;
  const isSelf = member.userId === viewerUserId;
  const targetRole = member.workspaceRole ?? EMPTY_WORKSPACE_ROLE;

  const canLeave = isSelf && meetsMinRole(role, "viewer") && role !== "owner";
  const canRemove = !isSelf && canShowMemberControls(role, targetRole, false);

  // ⚠ NO `setConfirming(false)` HERE — `ConfirmDialog` owns the close (it closes
  // on resolve and STAYS OPEN on a throw, which is the retry this dialog used to
  // have no way of offering).
  const write = useRemoveContainerMember(homeChannel.container?.segment ?? "", () => {
    if (canLeave) onLeft();
    else onRosterChanged();
  });

  if (!canLeave && !canRemove) return null;

  const name = member.displayName ?? member.email ?? "this person";
  const verb = canLeave ? "Leave" : "Remove";

  return (
    <>
      <button
        type="button"
        className={SMALL_TEXT_BUTTON}
        onClick={() => setConfirming(true)}
      >
        {verb}
      </button>
      {/* ⚠ `ConfirmDialog`, NOT `FormDialog` — the rule is `form-dialog.tsx`'s
          own: a fieldless yes/no is a confirm, and a DESTRUCTIVE one wears
          `.btnDanger` rather than the composer's black CTA (2026-09-17). Copy
          matches `members-v2/tab-settings.tsx`: departure costs the whole
          scoped container, not one channel. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={canLeave ? `Leave ${homeChannel.name}?` : `Remove ${name}?`}
        description={
          canLeave
            ? "You lose access to every knowledge base, skill and chat this container scoped to you, and are removed from its channels."
            : "They lose access to every knowledge base, skill and chat this container scoped to them, and are removed from its channels."
        }
        confirmLabel={verb}
        destructive
        // ⚠ `mutateAsync`, so a refusal REJECTS and the dialog stays open.
        onConfirm={() => write.mutateAsync(member.userId)}
      />
    </>
  );
}
