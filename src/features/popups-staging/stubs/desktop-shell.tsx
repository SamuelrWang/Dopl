"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "@/features/workspaces/types";
import { ApiError } from "@/shared/api/api-client";
import {
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_USER_ID,
} from "@/features/ui-staging/staging-stubs";
import { MY_SESSIONS } from "@/features/channels-staging/data/demo-imports";

/**
 * STUBS of the desktop-only modules the two staged window pages import (`react-router`,
 * `#/hooks/use-workspace-access`, the signed-out screen). Each names what it stands in for.
 */

/* ─── window pages: `react-router`, `#/hooks/use-workspace-access`, and the channel bodies ─── */

/** STAGING ONLY — which state the staged window pages are in. */
export type StagingWindowState = "ready" | "loading" | "error";
const WindowStateContext = createContext<StagingWindowState>("ready");
export function StagingWindowStateProvider({ value, children }: { value: StagingWindowState; children: ReactNode }) {
  return <WindowStateContext.Provider value={value}>{children}</WindowStateContext.Provider>;
}

/** `#/hooks/use-workspace-access › useWorkspaceAccess`. */
export function useWorkspaceAccess() {
  const state = useContext(WindowStateContext);
  return {
    access:
      state === "ready"
        ? { workspaceId: STAGING_HOME_WORKSPACE_ID, currentUserId: STAGING_USER_ID, role: "owner" as Role }
        : null,
    isPending: state === "loading",
    error: state === "error" ? new ApiError(503, "UNAVAILABLE", "Couldn’t reach Dopl.") : null,
    refetch: () => {},
  };
}

/**
 * STAGING ONLY — the (channel, thread, agent) the two window pages are "opened at": the landing
 * demo's own agent inside its open thread (`/channels` staging's `tech-debt` channel), so the
 * window bodies (`channel-windows.tsx`) find it in the channels staging store.
 */
const WINDOW_SESSION = MY_SESSIONS.find((s) => s.threadId) ?? MY_SESSIONS[0];
export const STAGING_WINDOW_ROUTE = {
  channelId: WINDOW_SESSION?.channelId ?? "",
  threadId: WINDOW_SESSION?.threadId ?? "",
  agentId: WINDOW_SESSION?.agentId ?? "",
};

/** `react-router › useParams / useSearchParams / useRouteError`. */
export function useParams<T extends Record<string, string>>(): Partial<T> {
  return { channelId: STAGING_WINDOW_ROUTE.channelId, workspaceSegment: STAGING_HOME_SEGMENT } as unknown as Partial<T>;
}
export function useSearchParams(): [URLSearchParams] {
  return [new URLSearchParams({ thread: STAGING_WINDOW_ROUTE.threadId, agent: STAGING_WINDOW_ROUTE.agentId })];
}
export function useRouteError(): unknown {
  return new Error("Staging route error");
}

/** `apps/desktop-ui/src/pages/boot/signed-out-screen.tsx › SignedOutScreen` — NOT STAGED (it
 *  bundles the login journey and a dozen packaged images). */
export function SignedOutScreen() {
  return <NotStagedBody label="Signed-out screen" />;
}

/** One line in place of a window body that is not staged (today: the signed-out screen only). */
export function NotStagedBody({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="text-caption text-text-muted">{label} — not staged.</p>
    </div>
  );
}
