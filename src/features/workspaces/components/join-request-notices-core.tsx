"use client";

import { useCallback, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
// ⚠ Deep import, never the `settings-modal` barrel: the barrel re-exports
// SettingsModal, whose account pane pulls `next/navigation` into the desktop
// renderer's import graph.
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
   * Navigate to the freshly-joined workspace. Core owns the path, caller owns
   * how to get there (`next/navigation` on web, SPA router in the renderer).
   */
  onNavigate: (path: string) => void;
}

/**
 * One-time join-request popups, mounted once in the app shell: awaiting
 * approval, joined (+ Go to workspace), declined. Each dismissal acks the
 * notice server-side so it never re-shows; one at a time, oldest first.
 *
 * ⚠ Router-free (core/binding pattern), and the ack goes through `apiRequest`,
 * never a relative `fetch`: the packaged renderer is a `file://` document under
 * `connect-src 'none'`, where `fetch("/api/…")` resolves to `file:///api/…`.
 * `./join-request-notices` is the `next/navigation` binding.
 */
export function JoinRequestNoticesCore({ onNavigate }: JoinRequestNoticesCoreProps) {
  // Best-effort — errors just render nothing.
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
