import { useMemo, type ReactNode } from "react";
import { authorMarker } from "@/features/agent-templates/components/template-picker";
import {
  TemplateGrid,
  TemplatePanel,
} from "@/features/agent-templates/components/template-section";
import type { AgentTemplate } from "@/features/agent-templates/client/types";
import type { TemplateSectionDef } from "@/features/agent-templates/lib/visibility";
import type { HomeChannel } from "@/features/home/types";

/**
 * The /home Agents panels' SECTIONS — the two shapes `agent-panels.tsx` stacks,
 * and the authorship marker one of them carries.
 *
 * Split from `agent-panels.tsx` for the reason `knowledge-panel-cards.tsx` was
 * split from `knowledge-panels.tsx`: to keep both halves clear of the 500-line
 * cap (INVARIANTS §1) with room for the next entry, rather than at it. The
 * controller keeps the READS and the gating; this file keeps what a resolved
 * read looks like.
 *
 * ⚠ NOTHING HERE IS A NEW SURFACE RECIPE. Both sections are
 * `agent-templates/components/template-section.tsx`'s `TemplatePanel` +
 * `TemplateGrid` — flat `bg-card-surface-subtle`, `.bento` cards, **never
 * `SectionBox`** (Samuel's no-concave ruling, 2026-08-22; Q4 of
 * `docs/specs/home-agents-tab.plan.md`). The source sweep that pins it
 * (`agent-templates/components/template-editor.test.tsx › no concave surfaces`)
 * reaches these files too — see that suite's `HOME_FILES`.
 *
 * ⚠ NO LAUNCH CONTROL ON EITHER SECTION, and its absence is tested
 * (`agent-panels.test.tsx`). This is the AUTHORING face; the Chat face's
 * `TemplateLaunchPicker` is already wired to the same container list (plan
 * §0.2), and a second launch surface fights `resolve`'s singularity (§5A).
 */

/**
 * Section A — who else in this relationship can wear these identities.
 *
 * ⚠ ITS OWN SECTION BECAUSE IT IS ITS OWN QUESTION. B and C are the same shelf
 * seen at two ranges and share a dropdown; A asks "who else can run this", which
 * no scope pill can answer.
 */
export function SharedAgentSection({
  section,
  templates,
  markerFor,
  onOpen,
}: {
  section: TemplateSectionDef;
  templates: ReadonlyArray<AgentTemplate>;
  markerFor: (template: AgentTemplate) => string | null;
  /** Opens the editor against THIS CHANNEL'S CONTAINER — every row here is a
   *  container row, whatever the scope pill below is showing.
   *  ⚠ Openable even on a row the marker says the PEER wrote: the write floor
   *  is the server's (POST/PATCH are member+, §5A), and a client that hid the
   *  control would be a second, weaker copy of that rule — one that disagrees
   *  the day the floor moves. The marker is what tells the operator whose
   *  instructions they are reading. */
  onOpen: (template: AgentTemplate) => void;
}) {
  return (
    <TemplatePanel id="home-agents-shared" label={section.label}>
      <TemplateGrid
        templates={templates}
        emptyLine={section.emptyLine}
        markerFor={markerFor}
        onOpen={onOpen}
      />
    </TemplatePanel>
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
export function PrivateAgentSection({
  section,
  templates,
  caption,
  action,
  unavailable,
  failure,
  pending,
  onOpen,
  cardActionFor,
}: {
  section: TemplateSectionDef;
  templates: ReadonlyArray<AgentTemplate>;
  caption: string;
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
  onOpen: (template: AgentTemplate) => void;
  /** ONE second control per row. Scope C's rows carry "Use in this channel"
   *  (the COPY, plan §3); scope B's carry nothing, because a row already in this
   *  container has nothing to copy itself into. */
  cardActionFor?: (template: AgentTemplate) => ReactNode;
}) {
  return (
    <TemplatePanel
      id="home-agents-private"
      label={section.label}
      action={action}
      caption={caption}
    >
      {unavailable !== null ? (
        <p className="px-1 pb-1 text-caption text-text-muted">{unavailable}</p>
      ) : failure !== null ? (
        // ⚠ THE SERVER'S OWN WORDING, AND A WAY TO ASK AGAIN. Not `PageError`:
        // that is a whole-pane state, and this failure is one section of a pane
        // whose other section loaded fine.
        <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
          <p className="text-caption text-text-muted">{failure.message}</p>
          <button
            type="button"
            onClick={failure.onRetry}
            className="btn-light h-6 rounded-full px-2.5 text-caption font-medium"
          >
            Try again
          </button>
        </div>
      ) : pending ? (
        // Bare while the other workspace's list is in flight — the dimmed pill
        // above already says the scope has not landed, and a second sentence
        // here would be a third thing to read for one fact.
        <div className="h-10" />
      ) : (
        <TemplateGrid
          templates={templates}
          emptyLine={section.emptyLine}
          onOpen={onOpen}
          actionFor={cardActionFor}
        />
      )}
    </TemplatePanel>
  );
}

/**
 * `by <member>` for a section-A row this operator did not write, else `null`.
 *
 * ⚠ A SECURITY SIGNAL, NOT DECORATION (INVARIANTS §5A). A member-granted peer
 * can create a template in this container, and its instructions are what the
 * operator's own agent would follow; the desktop already wears a different ROLE
 * header for a foreign template, and this is the operator seeing the same fact
 * BEFORE anything runs. An author the roster cannot name still reads
 * `by another member` — dropping the marker would turn UNKNOWN into MINE.
 *
 * ⚠ THE ROSTER COSTS NO REQUEST, AND IT CANNOT: a link container holds ONE OR
 * TWO members (§4A), so `channel.peer` IS the roster minus the caller. A
 * `GET /api/channels/{id}/members` here would be a third read on a pane the
 * plan holds to two (§2), to learn a name this page was already handed.
 */
export function useContainerAuthorMarker(
  channel: HomeChannel | null,
  currentUserId: string
): (template: AgentTemplate) => string | null {
  const names = useMemo(() => {
    const map = new Map<string, string>();
    // ⚠ A NAMELESS PEER IS LEFT OUT OF THE MAP, NOT ENTERED BLANK.
    // `HomePeer.displayName` is nullable (a profile that never set one), and
    // `authorMarker` already has the right answer for an unresolvable author —
    // `by another member`. An empty-string entry would render `by ` instead.
    const peer = channel?.peer;
    if (peer?.displayName) map.set(peer.userId, peer.displayName);
    return map;
  }, [channel?.peer]);
  return useMemo(
    () => (template: AgentTemplate) =>
      authorMarker(template, currentUserId, names),
    [currentUserId, names]
  );
}
