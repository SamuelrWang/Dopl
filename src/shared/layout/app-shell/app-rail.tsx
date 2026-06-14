"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { WorkspaceLike } from "./workspace-types";
import { workspaceSegment } from "@/features/workspaces/url";
import styles from "./app-shell.module.css";

interface Props {
  workspaces: WorkspaceLike[];
  activePublicId: string;
  onAddWorkspace: () => void;
}

/**
 * Far-left vertical rail of workspace tiles (new design language). Lists
 * the user's real workspaces — the active one is highlighted with the
 * light tile + edge bar — plus an add affordance (opens the create-
 * workspace dialog in place). Account/profile lives in the top-right.
 */
export function AppRail({
  workspaces,
  activePublicId,
  onAddWorkspace,
}: Props) {
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
