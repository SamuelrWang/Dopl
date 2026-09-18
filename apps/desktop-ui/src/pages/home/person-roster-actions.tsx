import { PanelHeading } from "@/features/channels/components/bits";
import { EMPTY_ROLE, type HomeChannel } from "@/features/home/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { AddPersonDialog } from "./add-person-dialog";
import { LinkOutPanel } from "./link-out-panel";

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
  homeChannel: HomeChannel;
}) {
  const { linkOut } = homeChannel;
  // ⚠ §8 STALE-CACHE, spelled inline: a payload cached by the previous bundle
  // carries no `role` key, and `EMPTY_ROLE` (rank 0) takes the button off for
  // one paint rather than offering a mint the server would refuse.
  const canAddPerson = meetsMinRole(homeChannel.role ?? EMPTY_ROLE, "member");

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
