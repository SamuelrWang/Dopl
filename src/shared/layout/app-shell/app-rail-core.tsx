"use client";

import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { LinkLike } from "@/shared/ui/link-like";
import type { WorkspaceLike } from "./workspace-types";
import { workspaceSegment } from "@/features/workspaces/url";
import styles from "./app-shell.module.css";

export interface AppRailCoreProps {
  workspaces: WorkspaceLike[];
  activePublicId: string;
  onAddWorkspace: () => void;
  /** Router-agnostic link — `next/link` in the web app, react-router in the SPA. */
  Link: LinkLike;
}

/**
 * The rail's Next-free core (see `./app-rail` for the web binding). Far-left
 * vertical rail of workspace tiles: the user's real workspaces — the active
 * one highlighted with the light tile + edge bar — plus an add affordance.
 */
export function AppRailCore({
  workspaces,
  activePublicId,
  onAddWorkspace,
  Link,
}: AppRailCoreProps) {
  return (
    <nav className={styles.rail}>
      {workspaces.map((ws) => {
        const active = ws.publicId === activePublicId;
        const letter = (ws.name.trim()[0] || "?").toUpperCase();
        return (
          <Link
            key={ws.id}
            href={`/${workspaceSegment(ws)}/knowledge`}
            title={ws.name}
            className={cn(styles.wsTile, active && styles.wsActive)}
          >
            {ws.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ws.iconUrl} alt="" />
            ) : (
              <span className={styles.wsLetter}>{letter}</span>
            )}
          </Link>
        );
      })}

      <button
        type="button"
        title="New workspace"
        aria-label="New workspace"
        onClick={onAddWorkspace}
        className={styles.wsAdd}
      >
        <Plus size={22} strokeWidth={2} />
      </button>
    </nav>
  );
}
