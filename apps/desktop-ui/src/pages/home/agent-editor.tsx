import { useMemo, useState } from "react";
import { agentTemplateErrorMessage } from "@/features/agent-templates/client/api";
import type {
  AgentTemplate,
  TemplateShelf,
  TemplateVisibility,
} from "@/features/agent-templates/client/types";
import { TemplateEditor } from "@/features/agent-templates/components/template-editor";
import type { PickerOption } from "@/features/agent-templates/components/template-editor-rows";
import { useAgentTemplateWrites } from "@/features/agent-templates/hooks/use-agent-template-writes";
import {
  draftToCreateBody,
  draftToPatchBody,
  isEmptyPatch,
  optimisticTemplate,
  type TemplateDraft,
} from "@/features/agent-templates/lib/template-draft";
import {
  SECTIONS,
  SECTIONS_CONTAINER,
  type TemplateSectionDef,
} from "@/features/agent-templates/lib/visibility";
import { useKnowledgeBaseList } from "@/features/knowledge/client/hooks";
import { useTeams } from "@/features/members/hooks/use-teams";

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
 * 🔑 TWO MOUNTS, NOT ONE COMPONENT WITH A FLAG, and the reason is a HOOK:
 * {@link HomeWorkspaceTemplateEditor} reads the workspace's teams and
 * {@link ContainerTemplateEditor} must not — "don't fetch teams for a container"
 * is a rule you cannot express with a conditional `useTeams(…)` call. Split into
 * two components it is not a rule at all, it is the shape of the file, and
 * `agent-authoring.test.tsx › offers TWO visibility scopes in a container, and
 * asks for no teams` pins it from the wire.
 *
 * ⚠ WHY A CONTAINER HAS NO TEAMS TO ASK FOR: a `kind='link'` container holds ONE
 * OR MORE members and no team rows (INVARIANTS §4A), so `team` is a DEAD
 * visibility there — hence `SECTIONS_CONTAINER` and an empty team list. The home
 * workspace is an ordinary workspace where all three scopes are live, so it gets
 * `SECTIONS` and a real teams read.
 * 🔒 ⚠ `SECTIONS_CONTAINER` IS **ONE** OPTION SINCE 2026-08-27, NOT TWO. The
 * /home pane lost its per-channel private section, and a container is not
 * navigable, so a `private` CONTAINER template would be reachable from nowhere —
 * a write-only row. The array is the control, so trimming the array is what
 * closes that door; this mount also passes `defaultVisibility="workspace"`,
 * because `emptyDraft()` starts at `private` and a draft opening on a value the
 * control cannot show is a form with no visible selection.
 * ⚠ A home-workspace template saved as Team or Public LANDS OUTSIDE THE PERSONAL
 * SECTION, which lists `private` + mine + `home_scoped`. That is correct, not a
 * bug: the row is in the operator's own workspace and its home is that
 * workspace's Agents page (`/:workspaceSegment/agents`).
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
 * ⚠ NO `useTeams` CALL IN THIS COMPONENT, and that is the assertion. See the
 * module docblock.
 *
 * ⚠ NO `shelf` EITHER. Shelves live only in a standard workspace
 * (`resolveTemplateHomeScope` fences the marker to the caller's own default
 * one), so the container's list and its cache entry are the UNFILTERED ones —
 * and the writes below must address that same entry.
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
 * Writing into the caller's OWN workspace — scope C.
 *
 * ⚠ THE TEAMS READ IS WHAT MAKES THE THIRD OPTION HONEST. `Team` is offered
 * here, and `isDraftSavable` refuses a team template that names no team — so a
 * mount that offered the scope without the list would hand the operator a
 * control that can only disable Save.
 */
export function HomeWorkspaceTemplateEditor({
  workspaceId,
  workspaceSegment,
  template,
  onClose,
}: HomeTemplateEditorProps & { workspaceId: string; workspaceSegment: string }) {
  const { teams } = useTeams(workspaceSegment);
  return (
    <TemplateEditorMount
      workspaceId={workspaceId}
      template={template}
      teams={teams ?? NO_TEAMS}
      sections={SECTIONS}
      // 🔒 THE SHELF THE PERSONAL SECTION READS. It does two things and both
      // are silent when wrong: it sends `homeScoped: true` so the row lands on
      // the shelf this pane lists, and it keys the cache entry the optimistic
      // patch addresses (F-331, with the shelf as a second axis).
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
  defaultVisibility,
  shelf,
  namesSharedAudience,
  onClose,
}: HomeTemplateEditorProps & {
  workspaceId: string;
  teams: ReadonlyArray<PickerOption>;
  sections: ReadonlyArray<TemplateSectionDef>;
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
  const writes = useAgentTemplateWrites(workspaceId, shelf);
  const baseList = useKnowledgeBaseList(workspaceId);
  const [error, setError] = useState<string | null>(null);

  const knowledgeBases = useMemo(
    () => (baseList.data?.bases ?? []).map((b) => ({ id: b.id, name: b.name })),
    [baseList.data]
  );
  // ⚠ `id → name` for the optimistic patch: the wire sends ids and answers with
  // `{id, name}` pairs, so a chip attached one keystroke ago has no name until
  // the round trip lands unless the picker's own label is carried across.
  const baseName = useMemo(() => {
    const byId = new Map(knowledgeBases.map((b) => [b.id, b.name]));
    return (id: string) => byId.get(id);
  }, [knowledgeBases]);

  async function save(draft: TemplateDraft) {
    setError(null);
    // 🔒 G16 — sent ONLY when this mount named the audience AND the row is
    // landing at the shared visibility. ⚠ `undefined`, never `false`: the
    // server examines only an explicit `true` and a `false` on every private
    // save would suggest to a reader that the other value is examined too —
    // the same rule `homeScoped` states one line below.
    const acknowledgeShared =
      namesSharedAudience && draft.visibility === "workspace" ? true : undefined;
    try {
      if (!template) {
        await writes.create.mutateAsync({
          body: {
            ...draftToCreateBody(draft),
            // ⚠ ONLY EVER SENT for the home shelf — an unconditional
            // `homeScoped: shelf === "home"` would put an explicit `false` on
            // every container create, widening the contract the fence allows.
            ...(shelf === "home" ? { homeScoped: true } : {}),
            ...(acknowledgeShared ? { acknowledgeShared } : {}),
          },
        });
      } else {
        const body = draftToPatchBody(draft, template);
        // Nothing changed — a PATCH with an empty body is a round trip that can
        // only fail, and Save is the operator saying "I'm done".
        if (!isEmptyPatch(body)) {
          await writes.update.mutateAsync({
            templateId: template.id,
            // ⚠ SPREAD ONTO `body` AFTER the emptiness test, never into it: an
            // acknowledgement moves no column, and counting it as a change
            // would send a PATCH that alters nothing (the F-404 class).
            body: { ...body, ...(acknowledgeShared ? { acknowledgeShared } : {}) },
            optimistic: optimisticTemplate(template, draft, baseName),
          });
        }
      }
      onClose();
    } catch (err) {
      setError(agentTemplateErrorMessage(err, "Couldn't save the agent"));
    }
  }

  async function remove() {
    if (!template) return;
    setError(null);
    try {
      await writes.remove.mutateAsync({ templateId: template.id });
      onClose();
    } catch (err) {
      setError(agentTemplateErrorMessage(err, "Couldn't delete the agent"));
    }
  }

  return (
    <TemplateEditor
      open
      session={1}
      defaultVisibility={defaultVisibility}
      template={template}
      teams={teams}
      knowledgeBases={knowledgeBases}
      sections={sections}
      saving={writes.create.pending || writes.update.pending}
      deleting={writes.remove.pending}
      error={error}
      onClose={onClose}
      onSave={(draft) => void save(draft)}
      onDelete={() => void remove()}
    />
  );
}
