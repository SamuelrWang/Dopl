/**
 * Who is looking, and what that lets them see.
 *
 * Every visibility decision on the members console derives from one call here;
 * no component decides for itself whether to render a control. The matrix and
 * its reasoning live in `docs/MEMBERS-AUTHORIZATION.md`.
 *
 * ⚠ CLIENT-SIDE RENDERING ONLY. Each rule needs a server counterpart, and the
 * doc names which route owns which. Hiding a control is not authorization.
 */

import { meetsMinRole } from "@/features/workspaces/types";
import {
  canGrantRole,
  canShowMemberControls,
} from "@/features/workspaces/member-policy";
import type { MemberRole, WorkspaceMemberView } from "../../types";

export interface Viewer {
  userId: string;
  role: MemberRole;
}

export interface MemberVisibility {
  isSelf: boolean;
  showAccessTab: boolean;
  /** Resources the member cannot reach. Admins only — never for self. */
  showNoAccessGroup: boolean;
  showSettingsTab: boolean;
  showRolePicker: boolean;
  showDangerZone: boolean;
  editableProfile: boolean;
  showPresence: boolean;
  canEditTeamMembership: boolean;
}

export interface WorkspaceVisibility {
  showRowActions: boolean;
  canInvite: boolean;
  canManageTeams: boolean;
}

/** Invitations and every team write are `requireWorkspaceRole(…, "admin")`
 *  server-side; team reads take `"viewer"`. */
export function workspaceVisibility(viewer: Viewer): WorkspaceVisibility {
  const isAdmin = meetsMinRole(viewer.role, "admin");
  return { showRowActions: isAdmin, canInvite: isAdmin, canManageTeams: isAdmin };
}

export function visibilityFor(
  viewer: Viewer,
  target: WorkspaceMemberView
): MemberVisibility {
  const isSelf = viewer.userId === target.userId;
  const isAdmin = meetsMinRole(viewer.role, "admin");
  const canManageTarget = canShowMemberControls(viewer.role, target.role, isSelf);

  return {
    isSelf,
    showAccessTab: isAdmin || isSelf,

    // ⚠ Naming the resources somebody was deliberately not given leaks the
    // shape of the workspace to the one person the boundary was drawn against.
    // The route drops these rows for self; this is the second gate, not the
    // only one.
    showNoAccessGroup: isAdmin && !isSelf,

    showSettingsTab: isAdmin || isSelf,
    showRolePicker: canManageTarget && canGrantRole(viewer.role, target.role),
    showDangerZone: canManageTarget,
    editableProfile: isSelf,
    showPresence: isAdmin || isSelf,
    canEditTeamMembership: isAdmin,
  };
}

export type DetailTabKey = "about" | "access" | "activity" | "settings";

export const DETAIL_TAB_LABEL: Record<DetailTabKey, string> = {
  about: "About",
  access: "Access",
  activity: "Activity",
  settings: "Settings",
};

export function visibleTabs(v: MemberVisibility): DetailTabKey[] {
  const tabs: DetailTabKey[] = ["about"];
  if (v.showAccessTab) tabs.push("access");
  tabs.push("activity");
  if (v.showSettingsTab) tabs.push("settings");
  return tabs;
}
