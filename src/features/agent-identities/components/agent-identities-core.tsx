"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { PageShellSkeleton } from "@/shared/ui/skeleton";
import { useAttachableBases } from "../hooks/use-attachable-bases";
import { useTeams } from "@/features/members/hooks/use-teams";
import { useLaunchSelection } from "@/features/channels/hooks/use-launch-selection";
import { agentIdentityErrorMessage } from "../client/api";
import type { AgentIdentity, IdentityShelf } from "../client/types";
import { useAgentIdentities } from "../hooks/use-agent-identities";
import { useIdentitySave } from "../hooks/use-identity-save";
import { SECTIONS, groupByVisibility } from "../lib/visibility";
import { IdentitySection } from "./identity-section";
import { IdentityEditor } from "./identity-editor";

/**
 * THE AGENTS PAGE — persistent agent IDENTITIES, created and managed here.
 *
 * Next-free and ROUTER-FREE by construction (the rule every shared page core in
 * this tree follows), so the SPA seam at `apps/desktop-ui/src/pages/identities/`
 * resolves the workspace and hands over, and the web tree could mount the same
 * component unchanged.
 *
 * ⚠ THREE PANELS, ONE READ. `useAgentIdentities` returns everything the caller
 * may see and `../lib/visibility.ts` groups it; the panels never fetch per
 * scope — three requests are three chances for the sections to disagree about a
 * identity that moved between them mid-load.
 *
 * ⚠ ONE CREATE AFFORDANCE, AT PAGE LEVEL. Samuel left the choice open between a
 * header button and a per-section "+"; the header wins because an identity's
 * scope is a FIELD IN THE EDITOR — a per-section plus would pre-decide it from
 * the panel that was clicked, and then disagree with the control the operator
 * changes two seconds later.
 *
 * ⚠ NO LAUNCH UI. Selecting an identity AT LAUNCH is a later phase.
 */

export interface AgentIdentitiesCoreProps {
  workspaceId: string;
  /** Canonical `{slug}-{publicId}` segment — the teams read is keyed by it. */
  workspaceSlug: string;
  /**
   * THE HOST'S OWN LOADING SHAPE for the identity read, or the shared page
   * ghost when a host has none.
   *
   * ⚠ A SLOT, NOT AN IMPORT, AND IT HAS TO BE. This core is Next-free and
   * router-free so BOTH trees mount it, which means it cannot reach into
   * `apps/desktop-ui/` — the desktop's per-page skeleton lives there. Same
   * idiom as `channels-core.tsx`'s `Link` and `shared/ui/skeleton.tsx ›
   * TwoPaneListSkeleton`'s `detail`: the host supplies what only the host can
   * know.
   *
   * ⚠ WHY THE DESKTOP PASSES ONE. Its page gate already paints
   * `pages/identities/identities-skeleton.tsx › IdentitiesPageSkeleton` while the workspace
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
  identity: AgentIdentity | null;
  /** Bumped on every open so the editor reloads its draft. */
  session: number;
}

const CLOSED: EditorState = { open: false, identity: null, session: 0 };

/**
 * 🔒 WHICH SHELF THIS PAGE IS. ⚠ FORGETTING IT WIDENS: an omitted `shelf` means
 * BOTH shelves, which is the pre-ruling behaviour and looks exactly like working
 * code. There is no client-side fallback filter anywhere in this chain — the
 * shelf is a TENANCY the client is never handed on the row.
 */
const WORKSPACE_SHELF: IdentityShelf = "workspace";

export function AgentIdentitiesCore({
  workspaceId,
  workspaceSlug,
  loadingSkeleton,
}: AgentIdentitiesCoreProps) {
  // 🔒 THE WORKSPACE SHELF, AND THE EXCLUSION RUNS BOTH WAYS (Samuel's ruling
  // 2026-08-27; structural since 2026-09-02, when the shelf became a separate
  // CONTAINER rather than a boolean beside one). This page and
  // /home → Agents → Personal are two PLACES over one table: an identity created
  // from the /home pane does not appear here, and this page's creates do not
  // appear there. A shelf that is its own place in one direction only is just a
  // filter.
  // ⚠ THE SHELF ALSO KEYS THE CACHE ENTRY, so the WRITES hook must be handed
  // the same value — a read on `[path, ws, {shelf:"workspace"}]` patched by a
  // writer on `[path, ws, undefined]` is F-331 with a new axis.
  const list = useAgentIdentities(workspaceId, { shelf: WORKSPACE_SHELF });
  const { teams } = useTeams(workspaceSlug);
  const attachable = useAttachableBases(workspaceId);
  const { catalogs } = useLaunchSelection({ kind: "defaults" });

  const [editor, setEditor] = useState<EditorState>(CLOSED);
  const {
    save,
    remove,
    error: writeError,
    setError: setWriteError,
    saving,
    deleting,
  } = useIdentitySave({
    workspaceId,
    shelf: WORKSPACE_SHELF,
    noun: "identity",
    onDone: closeEditor,
  });

  const grouped = useMemo(() => groupByVisibility(list.identities), [list.identities]);

  function openEditor(identity: AgentIdentity | null) {
    setWriteError(null);
    setEditor((prev) => ({ open: true, identity, session: prev.session + 1 }));
  }

  function closeEditor() {
    setWriteError(null);
    setEditor((prev) => ({ ...prev, open: false }));
  }

  if (list.loading) {
    return loadingSkeleton ?? <PageShellSkeleton label="Loading identities" />;
  }

  return (
    <div className="page-float flex flex-col antialiased">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-default px-4">
        <h1 className="text-display font-semibold text-text-primary">Identities</h1>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="btn-light flex h-8 items-center gap-1.5 rounded-lg px-3 text-small font-medium text-text-primary"
        >
          <Plus size={14} />
          Agent Identity
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[960px] flex-col gap-3">
          {list.error != null && (
            <p role="alert" className="text-caption text-danger">
              {agentIdentityErrorMessage(list.error, "Couldn't load identities")}
            </p>
          )}
          {SECTIONS.map((section) => (
            <IdentitySection
              key={section.visibility}
              section={section}
              identities={grouped[section.visibility]}
              onOpen={openEditor}
              catalogs={catalogs}
            />
          ))}
        </div>
      </div>

      <IdentityEditor
        open={editor.open}
        workspaceId={workspaceId}
        session={editor.session}
        identity={editor.identity}
        teams={teams ?? []}
        knowledgeBases={attachable.bases}
        knowledgeState={attachable.state}
        onKnowledgeRetry={attachable.retry}
        saving={saving}
        deleting={deleting}
        error={writeError}
        onClose={closeEditor}
        onSave={(draft) => void save(draft, editor.identity)}
        onDelete={() => void remove(editor.identity)}
      />
    </div>
  );
}
