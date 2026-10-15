import { useState } from "react";
import { Plus } from "lucide-react";
import { RequestWorkspaceAccessDialog } from "@/features/workspaces/components/request-workspace-access-dialog";
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
  // ⚠ No `onCreateWorkspace` since 2026-10-15: the create tile is GATED and opens
  // the request-access popup this rail owns (see the tile below).
  // ⚠ No `className`/backdrop prop: `.rail` paints `--home-frame` at the source, so
  // both mounts get one slab. A backdrop prop is how the rail and the shell drifted.
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
}: AccountRailProps) {
  const isHome = activeWorkspacePublicId === null;
  const [gateOpen, setGateOpen] = useState(false);
  return (
    <>
    <nav className={styles.rail} aria-label="Account">
      <button
        type="button"
        title="Home"
        aria-label="Home"
        // ⚠ ALSO THE SELECTED FACE'S HOOK since 2026-09-09 — the CSS reads
        // `[aria-current="page"]`, so there is no second selected class to keep
        // in step with it. See `account-rail.module.css`.
        aria-current={isHome ? "page" : undefined}
        className={styles.tile}
        onClick={() => onNavigate(HOME_PATH)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={doplMark} alt="" className={styles.homeMark} />
      </button>

      {/* ⚠ No divider element: the account/container boundary is the 11px break
          `.workspaces` opens with (`account-rail.module.css`); the selected tile
          owns the only line. */}
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
              className={styles.tile}
              onClick={() => onNavigate(`/${workspaceSegment(ws)}`)}
            >
              <WorkspaceGlyph name={ws.name} iconUrl={ws.iconUrl} size="md" />
            </button>
          );
        })}
      </div>

      {/* 🔒 GATED (Samuel, 2026-10-15): team workspaces are invite-only for now, so
          this tile opens the request-access popup, not the create form. The DASHED
          rounded square is the "not yet yours" face: same ink and stroke as the +. */}
      <button
        type="button"
        title="New workspace"
        aria-label="New workspace"
        className={styles.tile}
        onClick={() => setGateOpen(true)}
      >
        <span className={styles.createOutline}>
          <Plus size={18} strokeWidth={1.8} />
        </span>
      </button>
    </nav>
    <RequestWorkspaceAccessDialog open={gateOpen} onOpenChange={setGateOpen} />
    </>
  );
}
