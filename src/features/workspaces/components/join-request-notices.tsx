"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/shared/layout/settings-modal";
import styles from "@/shared/layout/settings-modal/settings-modal.module.css";
import type { JoinRequestNotice } from "../server/join-links";

type Notice = Pick<
  JoinRequestNotice,
  | "id"
  | "workspaceName"
  | "workspaceSlug"
  | "workspacePublicId"
  | "status"
  | "kind"
>;

/**
 * One-time join-request popups, mounted once in the app layout:
 *   - "Awaiting admin approval" right after requesting via a join link
 *   - "You've joined X" (+ Go to workspace) once an admin approves
 *   - "Request declined" once an admin declines
 * Each dismissal acks the notice server-side so it never re-shows.
 * Notices show one at a time, oldest first.
 */
export function JoinRequestNotices() {
  const router = useRouter();
  const [queue, setQueue] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/join-requests", { credentials: "same-origin" })
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { notices: Notice[] };
        if (!cancelled) setQueue(body.notices ?? []);
      })
      .catch(() => {
        /* notices are best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = queue[0] ?? null;

  const dismiss = useCallback(
    async (notice: Notice, goToWorkspace: boolean) => {
      setBusy(true);
      try {
        await fetch(`/api/me/join-requests/${encodeURIComponent(notice.id)}/ack`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: notice.kind }),
        });
      } catch {
        /* ack is best-effort — worst case the popup shows again */
      }
      setQueue((q) => q.filter((n) => n.id !== notice.id));
      setBusy(false);
      if (goToWorkspace) {
        router.push(`/${notice.workspaceSlug}-${notice.workspacePublicId}`);
        router.refresh();
      }
    },
    [router]
  );

  if (!current) return null;

  const approved = current.kind === "resolved" && current.status === "approved";
  const declined = current.kind === "resolved" && current.status === "declined";

  const title = approved
    ? `You've joined ${current.workspaceName}!`
    : declined
      ? "Request declined"
      : "Awaiting admin approval";
  const description = approved
    ? `An admin approved your request — ${current.workspaceName} is now in your workspace list.`
    : declined
      ? `Your request to join ${current.workspaceName} was declined. You can ask for a new invite link if this was a mistake.`
      : `Your request to join ${current.workspaceName} was sent. An admin needs to approve it before you're in — we'll let you know.`;

  return (
    <ModalShell
      open
      onClose={() => void dismiss(current, false)}
      label={title}
      size="compact"
    >
      <div className={styles.confirmBody}>
        <h2 className={styles.confirmTitle}>{title}</h2>
        <p className={styles.confirmDesc}>{description}</p>
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.btnCancel}
            disabled={busy}
            onClick={() => void dismiss(current, false)}
          >
            {approved ? "Later" : "Got it"}
          </button>
          {approved && (
            <button
              type="button"
              className={styles.btnConfirm}
              disabled={busy}
              onClick={() => void dismiss(current, true)}
            >
              Go to workspace
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
