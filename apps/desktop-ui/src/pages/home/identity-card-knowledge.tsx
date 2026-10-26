import { IdentityKnowledgeDialog } from "@/features/agent-identities/components/identity-knowledge-dialog";
import { useAttachableBases } from "@/features/agent-identities/hooks/use-attachable-bases";
import { useIdentitySave } from "@/features/agent-identities/hooks/use-identity-save";
import { draftFromIdentity } from "@/features/agent-identities/lib/identity-draft";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { HOME_SHELF } from "./identity-editor";

/**
 * The personal card's knowledge popup, wired: the picker reads the home workspace's bases and the
 * set saves through the editor's own save (`use-identity-save.ts`, 412 copy included), closing only
 * on success under the version the row was opened on (INVARIANTS §5A, F-747). Keyed
 * `(homeWorkspaceId, HOME_SHELF)` to match the Personal read, or the optimistic patch lands on a
 * key nobody reads (F-331).
 */
export function HomeKnowledgeDialog({
  identity,
  workspaceId,
  onClose,
}: {
  identity: AgentIdentity;
  /** The home workspace the Personal list was read from. */
  workspaceId: string;
  onClose: () => void;
}) {
  const { save, error, saving } = useIdentitySave({
    workspaceId,
    shelf: HOME_SHELF,
    noun: "identity",
    onDone: onClose,
  });
  const attachable = useAttachableBases(workspaceId);
  return (
    <IdentityKnowledgeDialog
      identity={identity}
      workspaceId={workspaceId}
      attachable={attachable}
      saving={saving}
      error={error}
      // An unchanged set sends nothing.
      onSave={(refs) => void save({ ...draftFromIdentity(identity), knowledge: refs }, identity)}
      onClose={onClose}
    />
  );
}
