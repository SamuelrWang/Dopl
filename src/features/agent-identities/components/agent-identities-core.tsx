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
 * The Identities page — Next-free and router-free, so the SPA route mounts it unchanged. One list read
 * grouped into the three scope panels; one page-level create (scope is a field in the editor).
 */

export interface AgentIdentitiesCoreProps {
  workspaceId: string;
  /** Canonical `{slug}-{publicId}` segment — the teams read is keyed by it. */
  workspaceSlug: string;
  /** The host's loading shape for the list read (a slot: this core cannot import `apps/desktop-ui`). */
  loadingSkeleton?: ReactNode;
}

interface EditorState {
  open: boolean;
  identity: AgentIdentity | null;
  /** Bumped on every open so the editor reloads its draft. */
  session: number;
}

const CLOSED: EditorState = { open: false, identity: null, session: 0 };

/** This page's shelf; omitting it would widen the list to both shelves. */
const WORKSPACE_SHELF: IdentityShelf = "workspace";

export function AgentIdentitiesCore({
  workspaceId,
  workspaceSlug,
  loadingSkeleton,
}: AgentIdentitiesCoreProps) {
  // The shelf keys the cache entry, so the writes hook gets the same value (F-331).
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
