"use client";

/**
 * **THE FRAME'S POPUPS** — the app-level popups desktop mounts outside any one face, mounted once
 * by `staging-frame.tsx` from the PRODUCT components:
 *
 * | Trigger | Opens |
 * |---|---|
 * | header "New channel" pill | `home/components/channels/new-channel-dialog.tsx` (a page's `onNew` overrides) |
 * | header search / Profile pills, rail "+" | owned by the product header and rail themselves |
 * | an incoming toast's click | the thread / agent pop-out windows (`thread:*` / `consent:*`, `resume`) |
 *
 * Also app-level, as desktop `app.tsx` mounts them: `RuntimeSignInPrompt` and `IncomingToasts`.
 * Anything inside the frame opens the same popups through `useStagingPopups()`;
 * `openStagingSettings` opens the header's Settings modal on a section and a billing plan.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { NewChannelDialog } from "@/features/home/components/channels/new-channel-dialog";
import { openHomeSettings } from "@/features/home/components/shell/home-settings-control";
import { RequestWorkspaceAccessDialog } from "@/features/workspaces/components/request-workspace-access-dialog";
import { RuntimeSignInPrompt } from "@/features/channels/components/runtime-sign-in-prompt";
import { IncomingToasts } from "@/features/notifications/components/incoming-toasts";
import { BILLING_STATUS_PATH } from "@/features/billing/components/use-workspace-entitlements";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";
import { StagingAgentWindow, StagingThreadWindow } from "@/features/popups-staging/staging-popups";
import { setStagingToastOpener } from "@/features/popups-staging/toast-ops";
import { setStagingBillingPlan } from "@/features/settings-staging/settings-server";
import type { StagingPlan } from "@/features/settings-staging/settings-mock-data";

export type StagingPopupKey = "new-channel" | "new-workspace" | "thread-window" | "agent-window";

export interface StagingPopups {
  open: (key: StagingPopupKey) => void;
  /** Focuses the header's search field, which opens its popup. */
  openSearch: () => void;
}

const NOOP_POPUPS: StagingPopups = { open: () => {}, openSearch: () => {} };

const PopupsContext = createContext<StagingPopups>(NOOP_POPUPS);

/** The frame's popups, from anywhere inside a `StagingFrame`. A no-op outside one. */
export function useStagingPopups(): StagingPopups {
  return useContext(PopupsContext);
}

/** The shell's own cache (header, Settings, the overlays); a face keeps its page's client. */
let shellClient: QueryClient | null = null;

/** Opens the header's Settings modal on `section`, with billing answering for `plan`. */
export function openStagingSettings(section: SettingsSection = "account", plan: StagingPlan = "pro"): void {
  setStagingBillingPlan(plan);
  void shellClient?.invalidateQueries({ queryKey: [BILLING_STATUS_PATH] });
  openHomeSettings(section);
}

/** Toast click → window. Mirrors which surface main's `openFromToast` lands each id on. */
function windowForToast(openId: string): StagingPopupKey | null {
  if (openId.startsWith("thread:")) return "thread-window";
  if (openId.startsWith("consent:") || openId === "resume") return "agent-window";
  return null;
}

export function useStagingPopupsState() {
  const [popup, setPopup] = useState<StagingPopupKey | null>(null);
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  );
  const api = useMemo<StagingPopups>(
    () => ({
      open: setPopup,
      openSearch: () => document.getElementById("home-search-field")?.focus(),
    }),
    []
  );

  useEffect(() => {
    shellClient = client;
    setStagingToastOpener((openId) => {
      const key = windowForToast(openId);
      if (key) setPopup(key);
      return key !== null;
    });
    return () => {
      shellClient = null;
      setStagingToastOpener(null);
    };
  }, [client]);

  const close = (open: boolean) => {
    if (!open) setPopup(null);
  };
  const overlays = (
    <>
      <NewChannelDialog open={popup === "new-channel"} onOpenChange={close} onCreated={() => setPopup(null)} />
      <RequestWorkspaceAccessDialog open={popup === "new-workspace"} onOpenChange={close} />
      <StagingThreadWindow open={popup === "thread-window"} onClose={() => setPopup(null)} />
      <StagingAgentWindow open={popup === "agent-window"} onClose={() => setPopup(null)} />
      <RuntimeSignInPrompt />
      <IncomingToasts />
    </>
  );

  return { api, client, overlays };
}

export function StagingPopupsContext({ value, children }: { value: StagingPopups; children: ReactNode }) {
  return <PopupsContext.Provider value={value}>{children}</PopupsContext.Provider>;
}
