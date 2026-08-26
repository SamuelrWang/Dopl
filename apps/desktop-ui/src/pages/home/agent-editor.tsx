import { useMemo, useState } from "react";
import { agentTemplateErrorMessage } from "@/features/agent-templates/client/api";
import type { AgentTemplate } from "@/features/agent-templates/client/types";
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
 * OR TWO members and no team rows (INVARIANTS §4A), so `team` is a DEAD
 * visibility there — hence `SECTIONS_CONTAINER` (two options) and an empty team
 * list. The home workspace is an ordinary workspace where all three scopes are
 * live, so it gets `SECTIONS` and a real teams read.
 * ⚠ A home-workspace template saved as Team or Public LANDS OUTSIDE THIS PANE's
 * scope C, which lists `private` + mine only. That is correct, not a bug: the
 * row is in the operator's own workspace and its home is that workspace's Agents
 * page (`/:workspaceSegment/agents`). This face never claimed to list the other
 * two scopes of a second workspace.
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
 * Writing into THIS CHANNEL's link container — scope A and scope B.
 *
 * ⚠ NO `useTeams` CALL IN THIS COMPONENT, and that is the assertion. See the
 * module docblock.
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
  onClose,
}: HomeTemplateEditorProps & {
  workspaceId: string;
  teams: ReadonlyArray<PickerOption>;
  sections: ReadonlyArray<TemplateSectionDef>;
}) {
  const writes = useAgentTemplateWrites(workspaceId);
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
    try {
      if (!template) {
        await writes.create.mutateAsync({ body: draftToCreateBody(draft) });
      } else {
        const body = draftToPatchBody(draft, template);
        // Nothing changed — a PATCH with an empty body is a round trip that can
        // only fail, and Save is the operator saying "I'm done".
        if (!isEmptyPatch(body)) {
          await writes.update.mutateAsync({
            templateId: template.id,
            body,
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
