"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageShellSkeleton } from "@/shared/ui/skeleton";
import { useKnowledgeBaseList } from "@/features/knowledge/client/hooks";
import { useTeams } from "@/features/members/hooks/use-teams";
import { agentTemplateErrorMessage } from "../client/api";
import type { AgentTemplate } from "../client/types";
import { useAgentTemplates } from "../hooks/use-agent-templates";
import { useAgentTemplateWrites } from "../hooks/use-agent-template-writes";
import {
  draftToCreateBody,
  draftToPatchBody,
  isEmptyPatch,
  optimisticTemplate,
  type TemplateDraft,
} from "../lib/template-draft";
import { SECTIONS, groupByVisibility } from "../lib/visibility";
import { TemplateSection } from "./template-section";
import { TemplateEditor } from "./template-editor";

/**
 * THE AGENTS PAGE — persistent agent TEMPLATES, created and managed here.
 *
 * Next-free and ROUTER-FREE by construction (the rule every shared page core in
 * this tree follows), so the SPA seam at `apps/desktop-ui/src/pages/agents/`
 * resolves the workspace and hands over, and the web tree could mount the same
 * component unchanged.
 *
 * ⚠ THREE PANELS, ONE READ. `useAgentTemplates` returns everything the caller
 * may see and `../lib/visibility.ts` groups it; the panels never fetch per
 * scope — three requests are three chances for the sections to disagree about a
 * template that moved between them mid-load.
 *
 * ⚠ ONE CREATE AFFORDANCE, AT PAGE LEVEL. Samuel left the choice open between a
 * header button and a per-section "+"; the header wins because a template's
 * scope is a FIELD IN THE EDITOR — a per-section plus would pre-decide it from
 * the panel that was clicked, and then disagree with the control the operator
 * changes two seconds later.
 *
 * ⚠ NO LAUNCH UI. Selecting a template AT LAUNCH is a later phase.
 */

export interface AgentTemplatesCoreProps {
  workspaceId: string;
  /** Canonical `{slug}-{publicId}` segment — the teams read is keyed by it. */
  workspaceSlug: string;
}

interface EditorState {
  open: boolean;
  template: AgentTemplate | null;
  /** Bumped on every open so the editor reloads its draft. */
  session: number;
}

const CLOSED: EditorState = { open: false, template: null, session: 0 };

export function AgentTemplatesCore({
  workspaceId,
  workspaceSlug,
}: AgentTemplatesCoreProps) {
  const list = useAgentTemplates(workspaceId);
  const writes = useAgentTemplateWrites(workspaceId);
  const { teams } = useTeams(workspaceSlug);
  const baseList = useKnowledgeBaseList(workspaceId);

  const [editor, setEditor] = useState<EditorState>(CLOSED);
  const [writeError, setWriteError] = useState<string | null>(null);

  const grouped = useMemo(() => groupByVisibility(list.templates), [list.templates]);

  // ⚠ `id → name` for the optimistic patch: the wire sends ids and answers with
  // `{id, name}` pairs, so a chip attached one keystroke ago has no name until
  // the round trip lands unless the picker's own label is carried across.
  const knowledgeBases = useMemo(
    () => (baseList.data?.bases ?? []).map((b) => ({ id: b.id, name: b.name })),
    [baseList.data]
  );
  const baseName = useMemo(() => {
    const byId = new Map(knowledgeBases.map((b) => [b.id, b.name]));
    return (id: string) => byId.get(id);
  }, [knowledgeBases]);

  function openEditor(template: AgentTemplate | null) {
    setWriteError(null);
    setEditor((prev) => ({ open: true, template, session: prev.session + 1 }));
  }

  function closeEditor() {
    setWriteError(null);
    setEditor((prev) => ({ ...prev, open: false }));
  }

  /**
   * ⚠ THE EDITOR STAYS OPEN UNTIL THE WRITE SETTLES, and closes only on success
   * — the dialog idiom this repo already runs (`create-channel-dialog.tsx`,
   * `base-settings-form.tsx`). A modal that closed on the click would leave a
   * failed save with nowhere to report: the optimistic row has already rolled
   * back, so the card silently returns to its old values and the operator's edit
   * is gone with no sentence anywhere saying why.
   */
  async function save(draft: TemplateDraft) {
    setWriteError(null);
    const editing = editor.template;
    try {
      if (!editing) {
        await writes.create.mutateAsync({ body: draftToCreateBody(draft) });
      } else {
        const body = draftToPatchBody(draft, editing);
        // Nothing changed — a PATCH with an empty body is a round trip that can
        // only fail, and Save is the operator saying "I'm done", not "write
        // something".
        if (!isEmptyPatch(body)) {
          await writes.update.mutateAsync({
            templateId: editing.id,
            body,
            optimistic: optimisticTemplate(editing, draft, baseName),
          });
        }
      }
      closeEditor();
    } catch (err) {
      setWriteError(agentTemplateErrorMessage(err, "Couldn't save the template"));
    }
  }

  async function remove() {
    const editing = editor.template;
    if (!editing) return;
    setWriteError(null);
    try {
      await writes.remove.mutateAsync({ templateId: editing.id });
      closeEditor();
    } catch (err) {
      setWriteError(agentTemplateErrorMessage(err, "Couldn't delete the template"));
    }
  }

  if (list.loading) return <PageShellSkeleton label="Loading agents" />;

  return (
    <div className="page-float flex flex-col antialiased">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-default px-4">
        <h1 className="text-display font-semibold text-text-primary">Agents</h1>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="btn-light flex h-8 items-center gap-1.5 rounded-lg px-3 text-small font-medium text-text-primary"
        >
          <Plus size={14} />
          New template
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[960px] flex-col gap-3">
          {list.error != null && (
            <p role="alert" className="text-caption text-danger">
              {agentTemplateErrorMessage(list.error, "Couldn't load templates")}
            </p>
          )}
          {SECTIONS.map((section) => (
            <TemplateSection
              key={section.visibility}
              section={section}
              templates={grouped[section.visibility]}
              onOpen={openEditor}
            />
          ))}
        </div>
      </div>

      <TemplateEditor
        open={editor.open}
        session={editor.session}
        template={editor.template}
        teams={teams ?? []}
        knowledgeBases={knowledgeBases}
        saving={writes.create.pending || writes.update.pending}
        deleting={writes.remove.pending}
        error={writeError}
        onClose={closeEditor}
        onSave={(draft) => void save(draft)}
        onDelete={() => void remove()}
      />
    </div>
  );
}
