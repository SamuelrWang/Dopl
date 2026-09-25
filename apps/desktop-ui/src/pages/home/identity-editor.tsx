import type { WorkspaceKind } from "@dopl/contracts";
import type {
  AgentIdentity,
  IdentityShelf,
  IdentityVisibility,
} from "@/features/agent-identities/client/types";
import { IdentityEditor } from "@/features/agent-identities/components/identity-editor";
import { useAttachableBases } from "@/features/agent-identities/hooks/use-attachable-bases";
import { useIdentitySave } from "@/features/agent-identities/hooks/use-identity-save";
import {
  SECTIONS,
  SECTIONS_CONTAINER,
  type IdentitySectionDef,
} from "@/features/agent-identities/lib/visibility";

/**
 * /home → Identities' authoring half: the workspace page's `IdentityEditor`, reused, mounted
 * against the workspace the operator writes INTO. Two mounts because four facts travel together
 * per surface: the section array, the default visibility, the shelf, and whether the mount names
 * the audience. Neither surface offers `team` (the editor drops it by `containerKind`).
 * Mounted only while open, so `session` is the constant `1` and the mount loads the draft.
 */

/** The home shelf. `?shelf=home` is a server WHERE: a forgotten argument widens silently, and
 *  the write's shelf must equal the read's or the optimistic patch lands on an unread key (F-331). */
export const HOME_SHELF: IdentityShelf = "home";

export interface HomeIdentityEditorProps {
  /** `null` = create. Anything else edits that row IN ITS OWN WORKSPACE. */
  identity: AgentIdentity | null;
  onClose: () => void;
}

/** Writing into this channel's link container (the shared section). No `shelf`: the container's
 *  list and cache entry are the unfiltered ones. */
export function ContainerIdentityEditor({
  workspaceId,
  identity,
  onClose,
}: HomeIdentityEditorProps & { workspaceId: string }) {
  return (
    <IdentityEditorMount
      workspaceId={workspaceId}
      identity={identity}
      sections={SECTIONS_CONTAINER}
      containerKind="link"
      defaultVisibility="workspace"
      // The one option is labelled "Shared in this channel", so this mount names the audience;
      // without it the server 400s `CONTAINER_PUBLISH_UNACKNOWLEDGED`. `defaultVisibility` is
      // `workspace` because `emptyDraft()` starts `private`, which the one option cannot show.
      namesSharedAudience
      onClose={onClose}
    />
  );
}

/** Writing onto the caller's home shelf. `containerKind` is where the row LANDS: the home
 *  shelf routes it into the caller's `kind='home'` container. */
export function HomeWorkspaceIdentityEditor({
  workspaceId,
  identity,
  onClose,
}: HomeIdentityEditorProps & { workspaceId: string }) {
  return (
    <IdentityEditorMount
      workspaceId={workspaceId}
      identity={identity}
      sections={SECTIONS}
      containerKind="home"
      // Sends `homeScoped: true` (routes the row) and keys the patched cache entry (F-331).
      shelf={HOME_SHELF}
      onClose={onClose}
    />
  );
}

/**
 * The half both mounts share. The base list is the PLAIN workspace key, never the channel-scoped
 * (grant-bearing) entry. The modal closes only on success: the writes are optimistic.
 */
function IdentityEditorMount({
  workspaceId,
  identity,
  sections,
  containerKind,
  defaultVisibility,
  shelf,
  namesSharedAudience,
  onClose,
}: HomeIdentityEditorProps & {
  workspaceId: string;
  sections: ReadonlyArray<IdentitySectionDef>;
  /** Where the row lands, so the editor can drop a scope that container cannot hold. */
  containerKind: WorkspaceKind;
  defaultVisibility?: IdentityVisibility;
  /** This surface's control states who will see a shared row, so a save at that visibility may
   *  send `acknowledgeShared`. A property of the mount, never of the draft. */
  namesSharedAudience?: boolean;
  /** Must match the `shelf` the list read was mounted with. */
  shelf?: IdentityShelf;
}) {
  const attachable = useAttachableBases(workspaceId);
  const { save, remove, error, saving, deleting } = useIdentitySave({
    workspaceId,
    shelf,
    noun: "identity",
    onDone: onClose,
    // `acknowledgeShared` / `homeScoped` are only ever sent as an explicit `true`, never `false`.
    extras: (draft) => {
      const acknowledgeShared =
        namesSharedAudience && draft.visibility === "workspace"
          ? { acknowledgeShared: true }
          : {};
      return {
        create: { ...(shelf === HOME_SHELF ? { homeScoped: true } : {}), ...acknowledgeShared },
        patch: acknowledgeShared,
      };
    },
  });


  return (
    <IdentityEditor
      open
      workspaceId={workspaceId}
      session={1}
      defaultVisibility={defaultVisibility}
      identity={identity}
      teams={[]}
      knowledgeBases={attachable.bases}
      knowledgeState={attachable.state}
      onKnowledgeRetry={attachable.retry}
      sections={sections}
      containerKind={containerKind}
      saving={saving}
      deleting={deleting}
      error={error}
      onClose={onClose}
      onSave={(draft) => void save(draft, identity)}
      onDelete={() => void remove(identity)}
    />
  );
}
