/**
 * Main's `notifications` pair, played in memory for the PRODUCT `IncomingToasts`: `pushStagingToast`
 * sends a toast the way `main/notification-route.js` does while Dopl is in front, and a toast's
 * click goes to the opener the frame registers (`setStagingToastOpener`), standing in for main's
 * `openFromToast` route. Registered by `ui-staging/staging-app-bridge.ts`.
 */
import { toast } from "@/shared/ui/toast";

export interface StagingIncomingToast {
  eventId: string;
  title: string;
  body?: string;
  openId?: string;
  actionLabel?: string;
  sticky?: boolean;
}

type IncomingToast = StagingIncomingToast & { kind: "incoming" };

const listeners = new Set<(t: IncomingToast) => void>();

/** Answers false for an id it does not open; the fallback toast stands in. */
let toastOpener: ((openId: string) => boolean) | null = null;
export function setStagingToastOpener(opener: ((openId: string) => boolean) | null): void {
  toastOpener = opener;
}

export const stagingNotifications = {
  async refresh() {
    return { ok: true };
  },
  onToast(listener: (t: IncomingToast) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async openFromToast(openId: string) {
    if (openId !== "toast-ready" && !toastOpener?.(openId)) {
      toast({ title: `Staging: would open ${openId}`, variant: "invert" });
    }
    return { ok: true };
  },
};

/** Push one toast as main would. */
export function pushStagingToast(t: StagingIncomingToast): void {
  for (const listener of listeners) listener({ ...t, kind: "incoming" });
}
