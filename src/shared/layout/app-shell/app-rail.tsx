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
  userInitial: string;
}

/**
 * Far-left vertical rail of workspace tiles (new design language). Lists
 * the user's real workspaces — the active one is highlighted with the
 * light tile + edge bar — plus an add affordance and the account avatar.
 */
export function AppRail({ workspaces, activePublicId, userInitial }: Props) {
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

      <Link href="/workspaces" title="Add workspace" className={styles.wsAdd}>
        <Plus size={22} strokeWidth={2} />
      </Link>

      <div className={styles.railSpacer} />

      <Link href="/settings" title="You" className={styles.wsMe}>
        {userInitial}
      </Link>
    </nav>
  );
}
