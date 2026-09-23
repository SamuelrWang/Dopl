import { useMemo } from "react";
import type { WorkspaceKind } from "@dopl/contracts";
import type {
  AgentTemplate,
  TemplateShelf,
  TemplateVisibility,
} from "@/features/agent-templates/client/types";
import { TemplateEditor } from "@/features/agent-templates/components/template-editor";
import type { PickerOption } from "@/features/agent-templates/components/template-editor-rows";
import { useTemplateSave } from "@/features/agent-templates/hooks/use-template-save";
import {
  SECTIONS,
  SECTIONS_CONTAINER,
  type TemplateSectionDef,
} from "@/features/agent-templates/lib/visibility";
import { useKnowledgeBaseList } from "@/features/knowledge/client/hooks";

/**
 * /home → Agents → THE AUTHORING HALF. The workspace page's editor, mounted
 * against whichever workspace the operator is writing INTO
 * (`docs/specs/home-agents-tab.plan.md` §4.5, M3).
 *
 * ⚠ THE EDITOR ITSELF IS REUSED, NOT FORKED. `agent-templates/components/
 * template-editor.tsx` is the one statement of what a template IS — six fields
 * and their two bodies — and a second modal on this face would be that list
 * written twice. What differs per surface is only what the mount HANDS it, which
 * is the whole reason this file exists.
 *
 * 🔑 TWO MOUNTS, NOT ONE COMPONENT WITH A FLAG. ⚠ **THE REASON USED TO BE A
 * HOOK — `HomeWorkspaceTemplateEditor` read the workspace's teams and
 * `ContainerTemplateEditor` must not — AND THAT REASON IS GONE (2026-09-08,
 * Samuel: *"we should remove the team option, if it's in the home space, because
 * the team thing is for workspaces"*).** NEITHER mount asks for teams now, so
 * what is left is four facts that differ per surface: the section array, the
 * default visibility, the SHELF a create lands on, and whether the mount named
 * the audience (G16). They are still two components because those four travel
 * together — one component with four flags is the same file with the reader's
 * job made harder — and `agent-authoring.test.tsx` pins the pair from the wire.
 *
 * 🔒 ⚠ **NEITHER OF THESE SURFACES HAS TEAMS, AND THE SECOND HALF WAS THE BUG.**
 * A `kind='link'` container holds members and no team rows (INVARIANTS §4A), so
 * `team` was always dead there. The PERSONAL mount looked different and was not:
 * `shelf="home"` routes the row into the caller's `kind='personal'` container,
 * where `server/service-write-gates.ts` has refused `team` since the container
 * migration — so the third pill was a control whose only outcome was a 403. Both
 * mounts now declare their `containerKind` and the editor drops the pill
 * (`agent-templates/lib/visibility.ts › visibilityOptions`).
 * 🔒 ⚠ `SECTIONS_CONTAINER` IS **ONE** OPTION SINCE 2026-08-27, NOT TWO. The
 * /home pane lost its per-channel private section, and a container is not
 * navigable, so a `private` CONTAINER template would be reachable from nowhere —
 * a write-only row. The array is the control, so trimming the array is what
 * closes that door; this mount also passes `defaultVisibility="workspace"`,
 * because `emptyDraft()` starts at `private` and a draft opening on a value the
 * control cannot show is a form with no visible selection.
 * ⚠ **A PERSONAL-SHELF TEMPLATE SAVED AS PUBLIC LANDS OUTSIDE THE PERSONAL
 * SECTION**, which lists `private` + mine. ⚠ **THIS BULLET ALSO SAID "Team" AND
 * NO LONGER CAN** (2026-09-08) — that value is not offered here and the server
 * refuses it on this shelf. **The `workspace` half is a REAL open question and
 * is deliberately left alone rather than quietly closed**: inside a
 * `kind='personal'` container that value reaches an audience of one (the
 * operator), and no surface lists such a row — the same write-only shape that
 * trimmed `SECTIONS_CONTAINER` on 2026-08-27. Samuel ruled on the TEAM option;
 * dropping a second pill he did not name is his call, not this file's.
 *
 * ⚠ MOUNTED ONLY WHILE OPEN, so `session` is the constant `1`. That prop exists
 * because the workspace page keeps ONE editor mounted and bumps it to reload the
 * draft; here the caller renders this component when the operator opens an
 * editor and drops it when they close one, so the draft is loaded by the MOUNT.
 * The trade is the exit animation, which a mounted-per-open editor cannot play —
 * cheaper than a second copy of the draft-reset rule.
 */

/** Shared frozen empty list — a container has no teams to offer, ever. */
const NO_TEAMS: ReadonlyArray<PickerOption> = Object.freeze([]);

export interface HomeTemplateEditorProps {
  /** `null` = create. Anything else edits that row IN ITS OWN WORKSPACE. */
  template: AgentTemplate | null;
  onClose: () => void;
}

/**
 * Writing into THIS CHANNEL's link container — the SHARED section.
 *
 * ⚠ NO `useTeams` CALL IN THIS COMPONENT — and since 2026-09-08 none in its
 * sibling either. See the module docblock.
 *
 * ⚠ NO `shelf` EITHER. A shelf is a TENANCY and this container is not the
 * caller's personal one, so `?shelf=` here would be a question with one possible
 * answer: the container's list and its cache entry are the UNFILTERED ones, and
 * the writes below must address that same entry.
 */
export function ContainerTemplateEditor({
  workspaceId,
  template,
  onClose,
}: HomeTemplateEditorProps & { workspaceId: string }) {
  return (
    <TemplateEditorMount
      workspaceId={workspaceId}
      template={template}
      teams={NO_TEAMS}
      sections={SECTIONS_CONTAINER}
      containerKind="link"
      defaultVisibility="workspace"
      // 🔒 G16 — THIS MOUNT NAMES THE AUDIENCE, SO IT MAY ACKNOWLEDGE IT (A11).
      // `SECTIONS_CONTAINER`'s single option is labelled "Shared in this
      // channel", and it is the control the operator chose from — that label IS
      // the audience statement, which is why this needs no dialog of its own
      // (INVARIANTS §5, minimal UI copy). Without the flag the server 400s
      // `CONTAINER_PUBLISH_UNACKNOWLEDGED` and "New shared agent" cannot save.
      // ⚠ NOT SET ON THE HOME-WORKSPACE MOUNT BELOW: its "Public" option is
      // about a standard workspace, which the server's predicate excludes — a
      // flag there would be a claim about a room that mount never shows.
      namesSharedAudience
      onClose={onClose}
    />
  );
}

/**
 * Writing onto the caller's OWN PERSONAL SHELF — scope C.
 *
 * 🔒 ⚠ **NO TEAMS READ, AND NO TEAM SCOPE (2026-09-08, Samuel's ruling — quoted
 * in the module docblock).** The old note here said *"the teams read is what
 * makes the third option honest"*; the third option is gone, so the read that
 * fed it is dead weight and a control that could only 403 is not honest at any
 * price. ⚠ **THE SHELF IS WHY, NOT THE WORKSPACE'S OWN KIND**: `shelf="home"`
 * sends `homeScoped: true`, which routes the row into the caller's
 * `kind='personal'` container — so `containerKind` names where the row LANDS,
 * which is the only container whose rules apply to it.
 * ⚠ `workspaceSegment` STAYS ON THE PROPS. It is the pane's own contract with
 * `HomeAgentPanels` (boot's `segment`, threaded down beside the id), and taking
 * it off would be a second change to a second file for a value the caller
 * already holds.
 */
export function HomeWorkspaceTemplateEditor({
  workspaceId,
  template,
  onClose,
}: HomeTemplateEditorProps & { workspaceId: string; workspaceSegment: string }) {
  return (
    <TemplateEditorMount
      workspaceId={workspaceId}
      template={template}
      teams={NO_TEAMS}
      sections={SECTIONS}
      containerKind="personal"
      // 🔒 THE SHELF THE PERSONAL SECTION READS. It does two things and both
      // are silent when wrong: it sends `homeScoped: true`, which ROUTES the row
      // into the caller's personal container (the shelf this pane lists), and it
      // keys the cache entry the optimistic patch addresses (F-331, with the
      // shelf as a second axis).
      shelf="home"
      onClose={onClose}
    />
  );
}

/**
 * The half both mounts share: the writes, the attachable knowledge bases, and
 * the one place a failed write gets a sentence.
 *
 * ⚠ THE BASE LIST IS THE **PLAIN** WORKSPACE KEY, NOT THE CHANNEL-SCOPED ONE.
 * `GET /api/knowledge/bases?channelId=` folds in `channelGrants` and lives in its
 * own cache entry on purpose (`knowledge-panels.tsx`); what the ATTACH picker
 * needs is just "which bases can this caller read in this workspace", which is
 * the plain read `useKnowledgeBaseList(workspaceId)` — the same entry the
 * workspace Agents page and `HomeKnowledgeBaseView`'s controller mount, so this
 * modal usually opens on a warm cache and never pulls the grant-bearing entry
 * out from under the Knowledge pane.
 *
 * ⚠ THE MODAL STAYS OPEN UNTIL THE WRITE SETTLES and closes only on success —
 * this tree's dialog idiom (INVARIANTS §5A). The writes are optimistic, so a
 * modal that closed on the click would leave a failed save with nowhere to
 * report: the row rolls back and the operator's edit is gone with no sentence
 * saying why.
 */
function TemplateEditorMount({
  workspaceId,
  template,
  teams,
  sections,
  containerKind,
  defaultVisibility,
  shelf,
  namesSharedAudience,
  onClose,
}: HomeTemplateEditorProps & {
  workspaceId: string;
  teams: ReadonlyArray<PickerOption>;
  sections: ReadonlyArray<TemplateSectionDef>;
  /** 🔒 WHERE THE ROW LANDS, so the editor can drop a scope that container
   *  cannot hold — never the room the call happens to stand in. */
  containerKind: WorkspaceKind;
  defaultVisibility?: TemplateVisibility;
  /** 🔒 G16 — this surface's own visibility control states who will see a
   *  shared row, so a save at that visibility may send `acknowledgeShared`.
   *  ⚠ A PROPERTY OF THE MOUNT, never of the draft: only the caller knows
   *  whether the operator was shown the room. */
  namesSharedAudience?: boolean;
  /** ⚠ Must match the `shelf` the surface's list read was mounted with, or
   *  every optimistic patch below lands on a key nobody is subscribed to. */
  shelf?: TemplateShelf;
}) {
  const baseList = useKnowledgeBaseList(workspaceId);
  const { save, remove, error, saving, deleting } = useTemplateSave({
    workspaceId,
    shelf,
    noun: "agent",
    onDone: onClose,
    // 🔒 G16 — `acknowledgeShared` is sent ONLY when this mount named the
    // audience AND the row is landing at the shared visibility. ⚠ `undefined`,
    // never `false`: the server examines only an explicit `true`, and a `false`
    // on every private save would suggest to a reader that the other value is
    // examined too — the same rule `homeScoped` states beside it.
    // ⚠ `homeScoped` IS ONLY EVER SENT for the home shelf: an unconditional
    // `homeScoped: shelf === "home"` would put an explicit `false` on every
    // container create, widening the contract the fence allows.
    extras: (draft) => {
      const acknowledgeShared =
        namesSharedAudience && draft.visibility === "workspace"
          ? { acknowledgeShared: true }
          : {};
      return {
        create: { ...(shelf === "home" ? { homeScoped: true } : {}), ...acknowledgeShared },
        patch: acknowledgeShared,
      };
    },
  });

  const knowledgeBases = useMemo(
    () => (baseList.data?.bases ?? []).map((b) => ({ id: b.id, name: b.name })),
    [baseList.data]
  );

  return (
    <TemplateEditor
      open
      workspaceId={workspaceId}
      session={1}
      defaultVisibility={defaultVisibility}
      template={template}
      teams={teams}
      knowledgeBases={knowledgeBases}
      sections={sections}
      containerKind={containerKind}
      saving={saving}
      deleting={deleting}
      error={error}
      onClose={onClose}
      onSave={(draft) => void save(draft, template)}
      onDelete={() => void remove(template)}
    />
  );
}
