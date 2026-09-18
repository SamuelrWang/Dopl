import { PanelHeading } from "@/features/channels/components/bits";
import { EMPTY_ROLE, type HomeChannel } from "@/features/home/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { AddPersonDialog } from "./add-person-dialog";
import { LinkOutPanel } from "./link-out-panel";

/**
 * **THE ONE ACT THAT CHANGES A HOME CONTAINER'S ROSTER** — Add person, or the
 * Link out panel when an invitation is already open (Samuel, 2026-08-25).
 *
 * 🔒 **IT IS THE `belowRoster` REGION AND NOTHING ELSE (wave 1A, 2026-09-17).**
 * This file was `person-members.tsx › PersonMembers` and drew the Members
 * heading, the count and `MemberRoster` itself — a second composition of a list
 * the shared Info body already draws — which is how it came to pass no
 * `viewerUserId` and report the operator OFFLINE in their own channel (**F-723**).
 * The heading, the count and the roster are `info-tab.tsx`'s now; what is left
 * here is the part that is genuinely different in kind, and it is an ACTION
 * rather than a face.
 *
 * ⚠ **THE ACT IS DIFFERENT IN KIND, WHICH IS WHY IT IS A REGION AND NOT A
 * CAPABILITY.** A link container's roster cannot be added to the way a
 * workspace channel's can — §4A: every workspace-level add answers
 * `LINK_CONTAINER_CLOSED`, and `capabilities.memberManagement` is false on this
 * surface. **The link claim is the only door, which is exactly why Add person is
 * a link MINT and not a member picker.** There is no shared control to narrow
 * into this; there is a home-only act, under the list it changes.
 *
 * ⚠ ADD PERSON LIVES *UNDER* THE ROSTER — it was the tab's foot, below Main
 * info, until this ruling. The act belongs beside the list it changes, which is
 * the position the region is NAMED for.
 *
 * ⚠ **ADD PERSON NEVER GOES AWAY (2026-08-26, Samuel's ruling: a home channel
 * takes MORE THAN TWO people).** It used to disappear the moment a peer
 * arrived, because the container held two members and the mint would 409; the
 * cap is gone, so a channel with three people in it still offers the act that
 * adds a fourth. **Do not reinstate a `peer`-shaped gate here** — the roster
 * length is not a capacity any more, and hiding the control would be this
 * surface asserting a limit the server no longer has.
 *
 * 🔒 **AND IT IS ROLE-GATED, WHICH IS NOT A CAPACITY GATE (2026-09-17,
 * F-343).** Minting a bound link is `member`+ on the server — `service-writes.ts
 * › mintContainerLink` refuses below it with `LINK_MINT_FORBIDDEN`, and that
 * floor is *"the only thing standing here"* since the two-member cap came off:
 * without it a guest somebody else let in could hand strangers links into the
 * operator's transcript. Until this field existed the pane could not tell a
 * guest from a member, so the button was shown to both and a guest's click
 * 403'd (INVARIANTS §5: an affordance that always 403s is a dead control).
 * ⚠ **HIDDEN, NOT DISABLED**: there is no refusal to explain to somebody who was
 * never offered the act, and a disabled pill under an empty roster reads as a
 * bug. ⚠ **AND IT IS A PICTURE, NOT A FENCE** — the 403 above is still the fence.
 * ⚠ **THIS IS NOT THE `peer`-SHAPED GATE THE PARAGRAPH ABOVE FORBIDS.** That one
 * asserted a CAPACITY the server does not have; this one mirrors a PERMISSION the
 * server does.
 *
 * ⚠ THE TWO-STATE RULE SURVIVES THAT, AND IS NOT THIS FILE'S TO RELAX. One
 * section, two states, NEVER BOTH: an invitation already out IS the answer to
 * "add a person", because a container may hold at most one OPEN link at a time
 * (`channel_links_one_open_per_workspace`) and offering the act beside a live
 * invitation would mint over a URL the operator has already sent. Pending link
 * → the Link out panel; otherwise → the button.
 */
export function PersonRosterActions({
  homeChannel,
}: {
  homeChannel: HomeChannel;
}) {
  const { linkOut } = homeChannel;
  // ⚠ §8 STALE-CACHE, SPELLED INLINE: a payload cached by the previous bundle
  // carries no `role` key, and `EMPTY_ROLE` (rank 0) takes the button off for one
  // paint rather than offering a mint the server would refuse.
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
  // ⚠ NO HEADING (Samuel, 2026-08-25). The control says what it does; a label
  // above it repeating the words is the explainer copy the minimal-copy ruling
  // deletes. The Link out state keeps its heading because the panel under it is
  // FACTS, not an action naming itself.
  return (
    <div className="px-3.5 pt-2.5">
      <AddPersonDialog workspaceId={homeChannel.workspaceId} />
    </div>
  );
}
