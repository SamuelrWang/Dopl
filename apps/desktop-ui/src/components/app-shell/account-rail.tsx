import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { WorkspaceGlyph } from "@/shared/layout/app-shell/workspace-switcher-core";
import { workspaceSegment } from "@/features/workspaces/url";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
// Same `?inline` reason as app-shell.tsx: packaged renderer is `file://`.
import doplMark from "#/assets/dopl-mark.png?inline";
import styles from "./account-rail.module.css";

/** The account-home route. routes.tsx registers it off this constant (this
 *  file must not import routes.tsx — routes.tsx imports the pages that mount
 *  this rail, and that would be a cycle). */
export const HOME_PATH = "/home";

export interface AccountRailProps {
  workspaces: WorkspaceLike[];
  /** publicId of the open workspace; null when Home is the active surface. */
  activeWorkspacePublicId: string | null;
  onNavigate: (path: string) => void;
  onCreateWorkspace: () => void;
  /** Backdrop override only — /home repaints the rail its own frame ink so the
   *  rail and the shell around it read as ONE slab. Needs `!` (module class and
   *  utility are the same specificity). Layout stays in the module. */
  className?: string;
}

/**
 * The ACCOUNT rail (Samuel, 2026-08-21) — the level workspaces sit on top of.
 * Home = the personal, cross-org channels surface every account has; the tiles
 * under the divider are the workspaces (intra-org containers) this account is
 * in. Discord's home/servers split, deliberately: Home is the anchor, not a
 * sibling workspace, which is why it is pinned above the rule and carries the
 * Dopl mark instead of a workspace glyph.
 */
export function AccountRail({
  workspaces,
  activeWorkspacePublicId,
  onNavigate,
  onCreateWorkspace,
  className,
}: AccountRailProps) {
  const isHome = activeWorkspacePublicId === null;
  return (
    <nav className={cn(styles.rail, className)} aria-label="Account">
      <button
        type="button"
        title="Home"
        aria-label="Home"
        aria-current={isHome ? "page" : undefined}
        className={cn(styles.tile, isHome && "raised-tab")}
        onClick={() => onNavigate(HOME_PATH)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={doplMark} alt="" className={styles.homeMark} />
      </button>

      <div className={styles.divider} role="presentation" />

      <div className={styles.workspaces}>
        {workspaces.map((ws) => {
          const isActive = ws.publicId === activeWorkspacePublicId;
          return (
            <button
              key={ws.id}
              type="button"
              title={ws.name}
              aria-label={ws.name}
              aria-current={isActive ? "page" : undefined}
              className={cn(styles.tile, isActive && "raised-tab")}
              onClick={() => onNavigate(`/${workspaceSegment(ws)}`)}
            >
              <WorkspaceGlyph name={ws.name} iconUrl={ws.iconUrl} size="md" />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        title="Create workspace"
        aria-label="Create workspace"
        className={styles.tile}
        onClick={onCreateWorkspace}
      >
        <Plus size={18} strokeWidth={1.8} />
      </button>
    </nav>
  );
}
