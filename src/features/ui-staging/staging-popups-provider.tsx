"use client";

/**
 * **THE FRAME'S POPUP PROVIDER** — every staged popup a frame-level trigger opens, mounted once by
 * `staging-frame.tsx`, so every staging page gets the same wiring for free:
 *
 * | Trigger (frame) | Opens |
 * |---|---|
 * | top bar "New channel" pill | `popups-staging › StagingNewChannelDialog` (a page's `onNew` overrides) |
 * | top bar search pill | the product popup (`search/components/header-search.tsx`, owned by the top bar) |
 * | top bar profile pill | `settings-staging › StagingSettingsModal` (Account; every row switches inside) |
 * | rail dashed "+" | `popups-staging › StagingRequestWorkspaceAccess` |
 * | an incoming toast's click | thread / agent pop-out windows (`thread:*` / `consent:*`, `resume`) |
 *
 * Also mounted here, app-level as desktop `app.tsx` does: `RuntimeSignInPrompt` (raise it with
 * `raiseStagingSignInPrompt`) and `IncomingToasts`. Anything inside the frame can open the same
 * popups through `useStagingPopups()`.
 *
 * ⚠ The overlays render OUTSIDE the scaled `.lp-demo-canvas` (the frame puts `overlays` beside the
 * window), because a `position: fixed` box under a `transform` is placed against that transform.
 * Staging only; nothing here ports back.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  StagingSettingsModal,
  type SettingsSection,
  type StagingPlan,
} from "@/features/settings-staging/staging-settings-modal";
import {
  StagingAgentWindow,
  StagingNewChannelDialog,
  StagingRequestWorkspaceAccess,
  StagingThreadWindow,
} from "@/features/popups-staging/staging-popups";
import { RuntimeSignInPrompt } from "@/features/popups-staging/components/runtime-sign-in-prompt";
import { IncomingToasts } from "@/features/popups-staging/features/notifications/components/incoming-toasts";
import { setStagingToastOpener } from "@/features/popups-staging/stubs/spa-bridge";

export type StagingPopupKey = "new-channel" | "new-workspace" | "thread-window" | "agent-window";

export interface StagingPopups {
  open: (key: StagingPopupKey) => void;
  /** Opens the Settings modal on `section` (default Account), optionally on another plan. */
  openSettings: (section?: SettingsSection, plan?: StagingPlan) => void;
  /** Focuses the top bar's search field, which opens its popup. */
  openSearch: () => void;
}

const NOOP_POPUPS: StagingPopups = {
  open: () => {},
  openSettings: () => {},
  openSearch: () => {},
};

const PopupsContext = createContext<StagingPopups>(NOOP_POPUPS);

/** The frame's popups, from anywhere inside a `StagingFrame`. A no-op outside one. */
export function useStagingPopups(): StagingPopups {
  return useContext(PopupsContext);
}

/** Toast click → window. Mirrors which surface main's `openFromToast` lands each id on. */
function windowForToast(openId: string): StagingPopupKey | null {
  if (openId.startsWith("thread:")) return "thread-window";
  if (openId.startsWith("consent:") || openId === "resume") return "agent-window";
  return null;
}

export function useStagingPopupsState() {
  const [popup, setPopup] = useState<StagingPopupKey | null>(null);
  const [settings, setSettings] = useState<{ open: boolean; section: SettingsSection; plan: StagingPlan }>({
    open: false,
    section: "account",
    plan: "pro",
  });
  const api = useMemo<StagingPopups>(
    () => ({
      open: setPopup,
      openSettings: (section = "account", plan = "pro") => setSettings({ open: true, section, plan }),
      openSearch: () => document.getElementById("home-search-field")?.focus(),
    }),
    []
  );

  useEffect(() => {
    setStagingToastOpener((openId) => {
      const key = windowForToast(openId);
      if (key) setPopup(key);
      return key !== null;
    });
    return () => setStagingToastOpener(null);
  }, []);

  const close = () => setPopup(null);
  const overlays = (
    <>
      <StagingNewChannelDialog open={popup === "new-channel"} onClose={close} />
      <StagingRequestWorkspaceAccess open={popup === "new-workspace"} onClose={close} />
      <StagingThreadWindow open={popup === "thread-window"} onClose={close} />
      <StagingAgentWindow open={popup === "agent-window"} onClose={close} />
      <StagingSettingsModal
        open={settings.open}
        onClose={() => setSettings((s) => ({ ...s, open: false }))}
        section={settings.section}
        onSectionChange={(section) => setSettings((s) => ({ ...s, section }))}
        plan={settings.plan}
      />
      <RuntimeSignInPrompt />
      <IncomingToasts />
    </>
  );

  return { api, overlays };
}

export function StagingPopupsContext({ value, children }: { value: StagingPopups; children: ReactNode }) {
  return <PopupsContext.Provider value={value}>{children}</PopupsContext.Provider>;
}
