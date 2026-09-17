import { PanelHeading } from "@/features/channels/components/bits";
import { MemberRoster } from "@/features/channels/components/member-roster";
import { useChannelMembers } from "@/features/channels/hooks/use-channel-members";
import { EMPTY_ROLE, type HomeChannel } from "@/features/home/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { AddPersonDialog } from "./add-person-dialog";
import { LinkOutPanel } from "./link-out-panel";

/**
 * THE HOME CHANNEL'S ROSTER, AND THE ONE ACT THAT CHANGES IT (Samuel,
 * 2026-08-25).
 *
 * ⚠ THE ROWS ARE THE CHANNELS PAGE'S ROWS — literally, not approximately
 * (Samuel, same day: *"I don't know why you're making it different"*). The
 * first pass here drew a home-local row: `xs` avatar, name only, `h-9`. It
 * exists because `MemberRow` was module-private in `info-tab.tsx` and copying
 * looked cheaper than exporting. Both surfaces now render
 * `channels/components/member-roster.tsx › MemberRoster` — same `sm` avatar with its
 * presence ring, same `h-[46px]`, name over EMAIL, same role pill, same
 * online/offline partition. **Adapt data wiring here; never the row.**
 *
 * ⚠ IT READS THE ROSTER THE SURFACE ALREADY HAS. `useChannelMembers(channelId,
 * workspaceId)` is the exact call `channel-surface-data.ts` makes with the
 * exact same arguments, so this mounts on the SAME TanStack entry and costs no
 * request — that is what "reuse the existing read" buys, and it is why this
 * does not take `members` as a prop from a parent that has none.
 *
 * ⚠ THE HEADING CARRIES THE COUNT AND NOTHING ELSE. `info-tab.tsx`'s trailing
 * cluster also holds `Add member` and `Filter members` `IconButton`s — both of
 * which have NO `onClick` on that page. They are not reproduced here: a
 * container's roster cannot be added to that way at all (§4A — every
 * workspace-level add answers `LINK_CONTAINER_CLOSED`, and
 * `capabilities.memberManagement` is false on this surface), and copying a dead
 * control onto a second surface doubles it rather than matching it. **The link
 * claim is the only door, which is exactly why Add person is a link mint and
 * not a member picker.**
 *
 * ⚠ ADD PERSON LIVES *UNDER* THE ROSTER — it was the tab's foot, below Main
 * info, until this ruling. The act belongs beside the list it changes.
 *
 * ⚠ **ADD PERSON NEVER GOES AWAY (2026-08-26, Samuel's ruling: a home channel
 * takes MORE THAN TWO people).** It used to disappear the moment a peer
 * arrived, because the container held two members and the mint would 409; the
 * cap is gone, so a channel with three people in it still offers the act that
 * adds a fourth. **Do not reinstate a `peer`-shaped gate here** — the roster
 * length is not a capacity any more, and hiding the control would be this
 * surface asserting a limit the server no longer has.
 *
 * 🔒 **AND IT IS NOW ROLE-GATED, WHICH IS NOT A CAPACITY GATE (2026-09-17,
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
export function PersonMembers({ homeChannel }: { homeChannel: HomeChannel }) {
  const { linkOut } = homeChannel;
  const { members } = useChannelMembers(
    homeChannel.channelId,
    homeChannel.workspaceId
  );
  // ⚠ §8 STALE-CACHE, SPELLED INLINE: a payload cached by the previous bundle
  // carries no `role` key, and `EMPTY_ROLE` (rank 0) takes the button off for one
  // paint rather than offering a mint the server would refuse.
  const canAddPerson = meetsMinRole(homeChannel.role ?? EMPTY_ROLE, "member");

  return (
    <>
      <PanelHeading
        title="Members"
        trailing={
          <span className="text-caption text-text-muted">{members.length}</span>
        }
      />
      {/* ⚠ `emptyLine` is OFF. A home channel always has the caller in it, so
          "No members in this channel." could only ever appear during the
          roster read's first frame — a false sentence, briefly. */}
      <div data-testid="channel-members">
        <MemberRoster members={members} />
      </div>

      {linkOut ? (
        <>
          <PanelHeading title="Link out" />
          <div className="px-3.5">
            <LinkOutPanel link={linkOut} />
          </div>
        </>
      ) : canAddPerson ? (
        // ⚠ NO HEADING (Samuel, 2026-08-25). The control says what it does; a
        // label above it repeating the words is the explainer copy the
        // minimal-copy ruling deletes. The Link out state keeps its heading
        // because the panel under it is FACTS, not an action naming itself.
        <div className="px-3.5 pt-2.5">
          <AddPersonDialog workspaceId={homeChannel.workspaceId} />
        </div>
      ) : null}
    </>
  );
}
