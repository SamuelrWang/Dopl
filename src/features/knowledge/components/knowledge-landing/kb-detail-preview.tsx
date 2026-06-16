import { AppPanel } from "@/shared/layout/app-shell";
import type { Role } from "@/features/workspaces/types";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../../types";
import { KnowledgeBaseView } from "../knowledge-base-view";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  initialEntry: KnowledgeEntry | null;
  initialEntryId: string | null;
  currentUserId: string;
  role: Role;
}

/**
 * KB detail content: the existing KnowledgeBaseView (folder tree + opened
 * doc) as the white main panel, rendered light via the module's
 * lightScope token block. The surrounding shell + MyAccessProvider are
 * mounted once by the knowledge layout and persist across navigation.
 */
export function KbDetailPreview({
  workspaceSegment,
  workspaceId,
  base,
  folders,
  entries,
  initialEntry,
  initialEntryId,
  currentUserId,
  role,
}: Props) {
  return (
    <AppPanel scroll={false}>
      <KnowledgeBaseView
        workspaceSlug={workspaceSegment}
        workspaceId={workspaceId}
        base={base}
        folders={folders}
        entries={entries}
        initialEntry={initialEntry}
        initialEntryId={initialEntryId}
        currentUserId={currentUserId}
        role={role}
      />
    </AppPanel>
  );
}
