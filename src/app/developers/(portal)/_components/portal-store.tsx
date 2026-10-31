"use client";

/**
 * What the shell knows and every page reads: who, which project, which environment. The figures themselves
 * come to each page from the server. Switching project or environment writes a cookie and re-reads.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { canManageKeys, canManageMembers, type PortalProject } from "@/features/device-sdk/portal/scope";
import type { Environment } from "@/features/device-sdk/types";
import { ENV_COOKIE, PROJECT_COOKIE, setPortalClock, writePortalCookie } from "./format";

interface PortalShellData {
  email: string | null;
  projects: PortalProject[];
  project: PortalProject;
  env: Environment;
  now: string;
}

interface PortalApi extends PortalShellData {
  test: boolean;
  canManage: boolean;
  /** An internal org's people are managed by hand. */
  canInvite: boolean;
  setEnv: (env: Environment) => void;
  setProject: (id: string) => void;
}

const Ctx = createContext<PortalApi | null>(null);

export function PortalProvider({ data, children }: { data: PortalShellData; children: ReactNode }) {
  const router = useRouter();
  setPortalClock(data.now);
  const setEnv = useCallback(
    (env: Environment) => {
      writePortalCookie(ENV_COOKIE, env);
      router.refresh();
    },
    [router]
  );
  const setProject = useCallback(
    (id: string) => {
      writePortalCookie(PROJECT_COOKIE, id);
      document.cookie = `${ENV_COOKIE}=; path=/developers; max-age=0`;
      router.refresh();
    },
    [router]
  );
  const value = useMemo<PortalApi>(
    () => ({
      ...data,
      test: data.env === "test",
      canManage: canManageKeys(data.project.role) && (!data.project.org.internal || data.project.role === "owner"),
      canInvite: canManageMembers(data.project.role) && !data.project.org.internal,
      setEnv,
      setProject,
    }),
    [data, setEnv, setProject]
  );
  return <Ctx value={value}>{children}</Ctx>;
}

export function usePortal(): PortalApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("usePortal needs PortalProvider");
  return api;
}

/** Returning to a tab fires both focus and visibilitychange, and a page can hold two of these hooks; one re-read covers them. */
const REFRESH_GAP_MS = 2000;
let lastRefresh = 0;

/** Re-reads the page on return to the tab and, with `everyMs`, on a timer while it is visible. No realtime: `dev_*` is service role only. */
export function useLiveRefresh(everyMs?: number): void {
  const router = useRouter();
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < REFRESH_GAP_MS) return;
      lastRefresh = Date.now();
      router.refresh();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const timer = everyMs ? window.setInterval(refreshIfVisible, everyMs) : null;
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [router, everyMs]);
}
