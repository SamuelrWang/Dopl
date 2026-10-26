"use client";

import { toast } from "@/shared/ui/toast";

/**
 * STUBS of the desktop-only libs the settings binding imports:
 *   - `apps/desktop-ui/src/lib/dopl-bridge.ts › getBridge` (only `signOut` is read here);
 *   - `apps/desktop-ui/src/lib/open-in-browser.ts › openInBrowser / openUrlInBrowser / billingPath /
 *     accountPagePath`;
 *   - `@/shared/lib/open-external › openExternalUrl`.
 * Nothing opens: each hand-off shows the toast the operator would otherwise see a browser for.
 */

const STAGED_BRIDGE = {
  signOut: async () => {
    toast({ title: "Staging: would sign out" });
  },
};

export function getBridge(): { signOut?: () => Promise<void> } | null {
  return STAGED_BRIDGE;
}

export function billingPath(segment: string, plan?: string): string {
  return `/billing/${segment}${plan ? `?plan=${plan}` : ""}`;
}

export function accountPagePath(segment: string): string {
  return `/billing/${segment}#account`;
}

export function openInBrowser(path: string): void {
  toast({ title: `Staging: would open ${path} in your browser` });
}

export function openUrlInBrowser(url: string): void {
  toast({ title: `Staging: would open ${url}` });
}

export async function openExternalUrl(url: string): Promise<void> {
  toast({ title: `Staging: would open ${url}` });
}

/** STUB of `react-router › useNavigate`: the staged modal has no router. */
export function useNavigate(): (path: string) => void {
  return (path) => toast({ title: `Staging: would navigate to ${path}` });
}
