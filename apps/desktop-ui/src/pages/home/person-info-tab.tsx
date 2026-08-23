import { CalendarDays, Clock3, Mail } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { formatChannelTimestamp, formatDate } from "@/shared/lib/format-time";
import {
  MetaRow,
  MetaRowDivider,
  PanelHeading,
} from "@/features/channels/components/channels-v2/bits";
import type { HomeRelationship } from "@/features/home/types";
import { peerLabel } from "./home-rows";

/**
 * The Info tab of a relationship's surface — THE PERSON, where a workspace
 * channel shows its metadata and roster (`channel-surface.tsx › infoTab`).
 *
 * ⚠ THE MOCK'S POSTURE SELECT, NOTES FIELD AND POLICY ROW ARE DELETED, not
 * disabled: none of the three has a backend, and a control that cannot be
 * saved is worse than an absent one.
 */
export function PersonInfoTab({
  relationship,
}: {
  relationship: HomeRelationship;
}) {
  const { peer } = relationship;
  const name = peerLabel(relationship);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <div className="flex items-center gap-3 px-3.5 pt-4">
        <Avatar person={peer} size="md" />
        <div className="min-w-0">
          <div className="truncate text-title font-semibold text-text-primary">
            {name}
          </div>
          <div className="truncate text-caption text-text-muted">
            {peer.email ?? "No email on file"}
          </div>
        </div>
      </div>

      <PanelHeading title="Main info" />
      <div className="px-2">
        <MetaRow icon={Mail} label="Email">
          <span className="truncate text-body text-text-primary">
            {peer.email ?? "—"}
          </span>
        </MetaRow>
        <MetaRowDivider />
        <MetaRow icon={CalendarDays} label="Connected">
          <span className="text-body text-text-primary">
            {formatDate(relationship.connectedAt)}
          </span>
        </MetaRow>
        <MetaRowDivider />
        <MetaRow icon={Clock3} label="Last activity">
          <span className="text-body text-text-primary">
            {relationship.lastMessageAt
              ? formatChannelTimestamp(relationship.lastMessageAt)
              : "No messages yet"}
          </span>
        </MetaRow>
      </div>
    </div>
  );
}
