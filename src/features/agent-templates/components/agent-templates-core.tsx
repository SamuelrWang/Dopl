"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { PageShellSkeleton } from "@/shared/ui/skeleton";
import { useKnowledgeBaseList } from "@/features/knowledge/client/hooks";
import { useTeams } from "@/features/members/hooks/use-teams";
import { agentTemplateErrorMessage } from "../client/api";
import type { AgentTemplate, TemplateShelf } from "../client/types";
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
  /**
   * THE HOST'S OWN LOADING SHAPE for the template read, or the shared page
   * ghost when a host has none.
   *
   * ⚠ A SLOT, NOT AN IMPORT, AND IT HAS TO BE. This core is Next-free and
   * router-free so BOTH trees mount it, which means it cannot reach into
   * `apps/desktop-ui/` — the desktop's per-page skeleton lives there. Same
   * idiom as `channels-v2-core.tsx`'s `Link` and `shared/ui/skeleton.tsx ›
   * TwoPaneListSkeleton`'s `detail`: the host supplies what only the host can
   * know.
   *
   * ⚠ WHY THE DESKTOP PASSES ONE. Its page gate already paints
   * `pages/agents/agents-skeleton.tsx › AgentsPageSkeleton` while the workspace
   * resolves, and THIS read is the very next frame — so leaving the default
   * here swapped that shape for a different one mid-load, which is the "five
   * flickers in five positions" `apps/desktop-ui/src/components/page-states.tsx`
   * argues against, arriving inside one page. One shape across both gates reads
   * as a single surface resolving.
   */
  loadingSkeleton?: ReactNode;
}

interface EditorState {
  open: boolean;
  template: AgentTemplate | null;
  /** Bumped on every open so the editor reloads its draft. */
  session: number;
}

const CLOSED: EditorState = { open: false, template: null, session: 0 };

/**
 * 🔒 WHICH SHELF THIS PAGE IS. ⚠ FORGETTING IT WIDENS: an omitted `shelf` means
 * BOTH shelves, which is the pre-ruling behaviour and looks exactly like working
 * code. There is no client-side fallback filter anywhere in this chain —
 * `home_scoped` is deliberately never projected.
 */
const WORKSPACE_SHELF: TemplateShelf = "workspace";

export function AgentTemplatesCore({
  workspaceId,
  workspaceSlug,
  loadingSkeleton,
}: AgentTemplatesCoreProps) {
  // 🔒 THE WORKSPACE SHELF, AND THE EXCLUSION RUNS BOTH WAYS (Samuel's ruling
  // 2026-08-27, `20260901120000_agent_template_home_scoped.sql`). This page and
  // /home → Agents → Personal are two PLACES over one table: a template created
  // from the /home pane does not appear here, and this page's creates do not
  // appear there. A shelf that is its own place in one direction only is just a
  // filter.
  // ⚠ THE SHELF ALSO KEYS THE CACHE ENTRY, so the WRITES hook must be handed
  // the same value — a read on `[path, ws, {shelf:"workspace"}]` patched by a
  // writer on `[path, ws, undefined]` is F-331 with a new axis.
  const list = useAgentTemplates(workspaceId, { shelf: WORKSPACE_SHELF });
  const writes = useAgentTemplateWrites(workspaceId, WORKSPACE_SHELF);
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

  if (list.loading) {
    return loadingSkeleton ?? <PageShellSkeleton label="Loading agents" />;
  }

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
