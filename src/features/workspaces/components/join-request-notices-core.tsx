"use client";

import { useCallback, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
// Deep import, never the `settings-modal` barrel: the barrel re-exports
// SettingsModal, whose account pane pulls `next/navigation` in and would drag
// Next into the desktop renderer's import graph.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
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

export interface JoinRequestNoticesCoreProps {
  /**
   * Navigate to the freshly-joined workspace. The core owns the path; the
   * caller owns how to get there — `next/navigation` on the web, the SPA
   * router in the desktop renderer.
   */
  onNavigate: (path: string) => void;
}

/**
 * One-time join-request popups, mounted once in the app shell:
 *   - "Awaiting admin approval" right after requesting via a join link
 *   - "You've joined X" (+ Go to workspace) once an admin approves
 *   - "Request declined" once an admin declines
 * Each dismissal acks the notice server-side so it never re-shows.
 * Notices show one at a time, oldest first.
 *
 * Router-free by construction (the wave-1 core/binding pattern), and the ack
 * goes through `apiRequest` rather than a raw relative `fetch`: the packaged
 * desktop renderer is a `file://` document under `connect-src 'none'`, where a
 * bare `fetch("/api/…")` resolves to `file:///api/…` and never leaves.
 * `./join-request-notices` is the `next/navigation` binding.
 */
export function JoinRequestNoticesCore({ onNavigate }: JoinRequestNoticesCoreProps) {
  // Notices are best-effort — errors just render nothing.
  const query = useApiQuery<{ notices: Notice[] }>("/api/me/join-requests");
  const [ackedIds, setAckedIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const queue = (query.data?.notices ?? []).filter((n) => !ackedIds.has(n.id));
  const current = queue[0] ?? null;

  const dismiss = useCallback(
    async (notice: Notice, goToWorkspace: boolean) => {
      setBusy(true);
      try {
        await apiRequest(
          `/api/me/join-requests/${encodeURIComponent(notice.id)}/ack`,
          { method: "POST", body: { kind: notice.kind } }
        );
      } catch {
        /* ack is best-effort — worst case the popup shows again */
      }
      setAckedIds((prev) => new Set(prev).add(notice.id));
      setBusy(false);
      if (goToWorkspace) {
        onNavigate(`/${notice.workspaceSlug}-${notice.workspacePublicId}`);
      }
    },
    [onNavigate]
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
