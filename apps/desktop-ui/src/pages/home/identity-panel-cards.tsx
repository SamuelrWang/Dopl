import { useMemo, type ReactNode } from "react";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { authorMarker } from "@/features/agent-identities/components/identity-picker";
import {
  IdentityGrid,
  IdentityPanel,
} from "@/features/agent-identities/components/identity-section";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import type { IdentitySectionDef } from "@/features/agent-identities/lib/visibility";
import { EMPTY_PEERS } from "@/features/channels/types";
import type { Channel } from "@/features/channels/types";
import { channelPeople } from "./home-rows";

/**
 * The /home Agents panels' SECTIONS — the two shapes `identity-panels.tsx` stacks,
 * and the authorship marker one of them carries.
 *
 * Split from `identity-panels.tsx` for the reason `knowledge-panel-cards.tsx` was
 * split from `knowledge-panels.tsx`: to keep both halves clear of the 500-line
 * cap (INVARIANTS §1) with room for the next entry, rather than at it. The
 * controller keeps the READS and the gating; this file keeps what a resolved
 * read looks like.
 *
 * ⚠ NOTHING HERE IS A NEW SURFACE RECIPE. Both sections are
 * `agent-identities/components/identity-section.tsx`'s `IdentityPanel` +
 * `IdentityGrid` — flat `bg-card-surface-subtle`, `.bento` cards, **never
 * `SectionBox`** (Samuel's no-concave ruling, 2026-08-22; Q4 of
 * `docs/specs/home-agents-tab.plan.md`). The source sweep that pins it
 * (`agent-identities/components/identity-editor.test.tsx › no concave surfaces`)
 * reaches these files too — see that suite's `HOME_FILES`.
 *
 * ⚠ NO LAUNCH CONTROL ON EITHER SECTION, and its absence is tested
 * (`identity-panels.test.tsx`). This is the AUTHORING face; the Channels face's
 * `IdentityLaunchPicker` is already wired to the same container list (plan
 * §0.2), and a second launch surface fights `resolve`'s singularity (§5A).
 */

/**
 * Section A — who else in this relationship can wear these identities.
 *
 * ⚠ ITS OWN SECTION BECAUSE IT IS ITS OWN QUESTION. B and C are the same shelf
 * seen at two ranges and share a dropdown; A asks "who else can run this", which
 * no scope pill can answer.
 */
export function SharedIdentitySection({
  section,
  identities,
  markerFor,
  onOpen,
  action,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  markerFor: (identity: AgentIdentity) => string | null;
  /** Header-right control — the "New shared agent" button (2026-08-27). This
   *  section gained one when the pane became two sections, each owning its own
   *  create. */
  action?: ReactNode;
  /** Opens the editor against THIS CHANNEL'S CONTAINER — every row here is a
   *  container row, whatever the scope pill below is showing.
   *  ⚠ Openable even on a row the marker says the PEER wrote: the write floor
   *  is the server's (POST/PATCH are member+, §5A), and a client that hid the
   *  control would be a second, weaker copy of that rule — one that disagrees
   *  the day the floor moves. The marker is what tells the operator whose
   *  instructions they are reading. */
  onOpen: (identity: AgentIdentity) => void;
}) {
  return (
    <IdentityPanel id="home-agents-shared" label={section.label} action={action}>
      <IdentityGrid
        identities={identities}
        emptyLine={section.emptyLine}
        markerFor={markerFor}
        onOpen={onOpen}
      />
    </IdentityPanel>
  );
}

/**
 * Sections B and C — the caller's own private identities, at whichever range
 * the pill names.
 *
 * ⚠ THE BODY HAS FIVE STATES AND ONLY ONE OF THEM MAY STATE AN EMPTINESS.
 * `unavailable` (there is no home workspace to look in), `failure` (the scope
 * the pill named ANSWERED, and the answer was an error), `pending` (it has not
 * answered yet), the empty LINE, and the grid. Rendered against an unresolved
 * read, `section.emptyLine` is an assertion about a list nobody has seen — the
 * same false-sentence trap `knowledge-panels.tsx` gates each of its sections
 * against separately, because the home read moves independently of the
 * container one.
 *
 * ⚠ `failure` IS A SETTLED STATE AND MUST OUTRANK `pending` (F-339). The read
 * hook's `resolved` is `data !== undefined`, so a failed read is unresolved
 * FOREVER; a body that only knew `pending` painted a blank spacer with no
 * sentence while the caller held the scope pill inert, and the operator could
 * not get back to the scope that works. A failed read SAYS SO and offers the
 * retry — it never silently occupies the section.
 */
export function PrivateIdentitySection({
  section,
  identities,
  action,
  unavailable,
  failure,
  pending,
  onOpen,
  cardActionFor,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  /** The create button and the scope pill; the pill wears `pendingRow` while
   *  its scope is in flight. */
  action: ReactNode;
  /** The named scope has nowhere to look — a SENTENCE, not an empty list. */
  unavailable: string | null;
  /** The named scope ANSWERED WITH AN ERROR — the server's own wording plus the
   *  way to ask again. `null` when the read did not fail. */
  failure: { message: string; onRetry: () => void } | null;
  pending: boolean;
  /** Opens the editor against the workspace the CURRENT SCOPE names — the
   *  container on "in this channel", the caller's own workspace on "across all
   *  channels". A row is always edited where it lives (plan §4.5). */
  onOpen: (identity: AgentIdentity) => void;
  /** ONE second control per row — the PERSONAL card's knowledge box and its
   *  Launch button since 2026-09-22 (Samuel), where it was "Share into this
   *  channel" and, before that, the copy. ⚠ ONE SLOT, so the two travel
   *  together: `identity-section.tsx › IdentityCard` carries exactly one. */
  cardActionFor?: (identity: AgentIdentity) => ReactNode;
}) {
  return (
    <IdentityPanel
      id="home-agents-private"
      label={section.label}
      action={action}
    >
      {unavailable !== null ? (
        <p className="px-1 pb-1 text-caption text-text-muted">{unavailable}</p>
      ) : failure !== null ? (
        // ⚠ THE SERVER'S OWN WORDING, AND A WAY TO ASK AGAIN. Not `PageError`:
        // that is a whole-pane state, and this failure is one section of a pane
        // whose other section loaded fine.
        <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
          <p className="text-caption text-text-muted">{failure.message}</p>
          <OpenScaleButton onClick={failure.onRetry}>
            Try again
          </OpenScaleButton>
        </div>
      ) : pending ? (
        // Bare while the other workspace's list is in flight — the dimmed pill
        // above already says the scope has not landed, and a second sentence
        // here would be a third thing to read for one fact.
        <div className="h-10" />
      ) : (
        <IdentityGrid
          identities={identities}
          emptyLine={section.emptyLine}
          onOpen={onOpen}
          actionFor={cardActionFor}
        />
      )}
    </IdentityPanel>
  );
}

/**
 * `by <member>` for a section-A row this operator did not write, else `null`.
 *
 * ⚠ A SECURITY SIGNAL, NOT DECORATION (INVARIANTS §5A). A member-granted peer
 * can create an identity in this container, and its instructions are what the
 * operator's own agent would follow; the desktop already wears a different ROLE
 * header for a foreign identity, and this is the operator seeing the same fact
 * BEFORE anything runs. An author the roster cannot name still reads
 * `by another member` — dropping the marker would turn UNKNOWN into MINE.
 *
 * ⚠ THE ROSTER COSTS NO REQUEST, AND IT CANNOT: `channel.peers` IS the roster
 * minus the caller, already on the home payload. A `GET /api/channels/{id}/members`
 * here would be a third read on a pane the plan holds to two (§2), to learn
 * names this page was already handed.
 *   ✅ **IT IS EVERY MEMBER SINCE 2026-08-26, not the first one (F-307).** This
 *   read `channel.peer` on the grounds that a container held one or two members,
 *   and the cap came off — so in a four-person channel three of the four
 *   possible authors would have degraded to `by another member` while the
 *   fourth got a name. **The marker fails SAFE either way** (an unresolvable
 *   author is never rendered as MINE), so this was a legibility bug rather than
 *   a security one; it is fixed because a security signal nobody can read is
 *   one nobody acts on.
 */
export function useContainerAuthorMarker(
  channel: Channel | null,
  currentUserId: string
): (identity: AgentIdentity) => string | null {
  // ⚠ THE DEPENDENCY IS `channel`, NOT THE PEER LIST. `channelPeople` can hand
  // back the frozen `EMPTY_PEERS` or the cached array, and reading `.peers` here
  // would be a second read of the field §8's enforcement pins to one place; the
  // channel object itself is the stable thing the query cache hands back.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    // ⚠ A NAMELESS PEER IS LEFT OUT OF THE MAP, NOT ENTERED BLANK.
    // `ChannelPeer.displayName` is nullable (a profile that never set one), and
    // `authorMarker` already has the right answer for an unresolvable author —
    // `by another member`. An empty-string entry would render `by ` instead.
    for (const peer of channel ? channelPeople(channel) : EMPTY_PEERS) {
      if (peer.displayName) map.set(peer.userId, peer.displayName);
    }
    return map;
  }, [channel]);
  return useMemo(
    () => (identity: AgentIdentity) =>
      authorMarker(identity, currentUserId, names),
    [currentUserId, names]
  );
}
