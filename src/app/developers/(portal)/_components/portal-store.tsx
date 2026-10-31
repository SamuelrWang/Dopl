"use client";

/**
 * What the shell knows and every page reads: who, which project, which environment. The figures themselves
 * come to each page from the server. Switching project or environment writes a cookie and re-reads.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { canManageKeys, canManageMembers, type PortalProject } from "@/features/device-sdk/portal/scope";
import type { Environment } from "@/features/device-sdk/types";
import { setPortalClock } from "./format";

export interface PortalShellData {
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

const YEAR_S = 365 * 86_400;
const writeCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/developers; max-age=${YEAR_S}; samesite=lax`;
};

export function PortalProvider({ data, children }: { data: PortalShellData; children: ReactNode }) {
  const router = useRouter();
  setPortalClock(data.now);
  const setEnv = useCallback(
    (env: Environment) => {
      writeCookie("dopl_dev_env", env);
      router.refresh();
    },
    [router]
  );
  const setProject = useCallback(
    (id: string) => {
      writeCookie("dopl_dev_project", id);
      document.cookie = "dopl_dev_env=; path=/developers; max-age=0";
      router.refresh();
    },
    [router]
  );
  const value = useMemo<PortalApi>(
    () => ({
      ...data,
      test: data.env === "test",
      canManage: canManageKeys(data.project.role),
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

/** Re-reads the page on return to the tab and, with `everyMs`, on a timer while it is visible. No realtime: `dev_*` is service role only. */
export function useLiveRefresh(everyMs?: number): void {
  const router = useRouter();
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
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
