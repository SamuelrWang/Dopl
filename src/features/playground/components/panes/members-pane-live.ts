"use client";

import { useMemo } from "react";
import type { AvatarPerson } from "@/shared/ui/avatar";
import { formatLastActive } from "@/shared/lib/format-time";
import { composeSegment } from "@/shared/lib/url/parse-segment";
import type { WorkspaceMemberView } from "@/features/members/types";
import { usePlaygroundPoll, usePlaygroundSession } from "../../session";

/**
 * Live half of the playground members pane. The pane renders `PaneMember`
 * rows; this module supplies them from the guest workspace when a session is
 * running, and the pane falls back to its static demo roster otherwise.
 *
 * Two chained GETs (both slow-polled by `usePlaygroundPoll`):
 *   1. `GET /api/workspaces/me` — the guest bearer plus `X-Workspace-Id`
 *      resolve to the playground workspace; we need its `slug` + `publicId`
 *      (the canonical URL segment) and the guest's own `userId`.
 *   2. `GET /api/workspaces/{slug}-{publicId}/members` — the real roster,
 *      hydrated with profile + team refs (`WorkspaceMemberView`).
 */

/** Style key for the role pill — real roles collapse onto the two recipes. */
export type PaneRole = "owner" | "member";

export interface PaneAccessRow {
  name: string;
  typeLabel: string;
  level: "edit" | "read";
}

export interface PaneMember {
  person: AvatarPerson;
  /** Pill/style bucket. */
  role: PaneRole;
  /** Verbatim role text (owner/admin/member/viewer). Never restyled per role. */
  roleLabel: string;
  isSelf: boolean;
  online: boolean;
  /** What `formatLastActive` says for this member. */
  activityLabel: string;
  joinedLabel: string;
  /** Team names for the detail pane's Teams box. */
  teams: string[];
  /** Effective-access rows; empty renders the pane's no-grants copy. */
  access: PaneAccessRow[];
}

interface MeWire {
  workspace: { slug: string; publicId: string };
  userId: string;
}

interface MembersWire {
  members: WorkspaceMemberView[];
}

function toPaneMember(
  m: WorkspaceMemberView,
  selfId: string | null
): PaneMember {
  const isSelf = selfId !== null && m.userId === selfId;
  // The guest auth row has no profile and a synthetic undeliverable email —
  // "Guest" (the demo's own name for the visitor) beats showing either.
  const displayName =
    m.displayName ?? (isSelf ? "Guest" : m.email ?? "Member");
  const activity = formatLastActive(m.lastSeenAt, m.status, m.invitedAt);
  return {
    person: {
      userId: m.userId,
      email: m.email,
      displayName,
      avatarUrl: m.avatarUrl,
    },
    role: m.role === "owner" ? "owner" : "member",
    roleLabel: m.role,
    isSelf,
    online: activity.dot === "active",
    activityLabel: activity.label,
    joinedLabel: m.joinedAt ? `joined ${m.joinedAt.slice(0, 10)}` : "",
    teams: m.teams.map((t) => t.name),
    access: [],
  };
}

/**
 * The guest workspace's roster, or null while there is no session / no data
 * yet (the pane keeps its static demo content in that case).
 */
export function useLiveMembers(): PaneMember[] | null {
  const { session } = usePlaygroundSession();
  const me = usePlaygroundPoll<MeWire>(session ? "/api/workspaces/me" : null);

  const workspace = me.data?.workspace;
  const segment =
    workspace?.slug && workspace?.publicId
      ? composeSegment(workspace.slug, workspace.publicId)
      : null;
  const roster = usePlaygroundPoll<MembersWire>(
    segment
      ? `/api/workspaces/${encodeURIComponent(segment)}/members`
      : null
  );

  const rows = roster.data?.members;
  const selfId = me.data?.userId ?? null;
  return useMemo(() => {
    if (!rows || rows.length === 0) return null;
    return rows.map((m) => toPaneMember(m, selfId));
  }, [rows, selfId]);
}
