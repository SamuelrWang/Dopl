"use client";

import "./popups-staging.css";

import { useState, type ReactNode } from "react";
import type { Channel, ChannelMember } from "@/features/channels/types";
import type { ChannelPendingLink } from "@/features/channels/types-list";
import { toast } from "@/shared/ui/toast";
import {
  STAGING_HOME_WORKSPACE_ID,
  STAGING_PEOPLE,
  STAGING_USER_ID,
  daysAgoIso,
  minsAgoIso,
} from "@/features/ui-staging/staging-stubs";
import { STAGING_WORKSPACES } from "@/features/settings-staging/settings-mock-data";
import { NewChannelDialog } from "./pages/home/new-channel-dialog";
import { PersonRosterActions, PersonRosterRowAction } from "./pages/home/person-roster-actions";
import { LinkOutPanel } from "./pages/home/link-out-panel";
import { RequestWorkspaceAccessDialog } from "./features/workspaces/components/request-workspace-access-dialog";
import { AccountRail } from "./components/app-shell/account-rail";
import ThreadWindowPage from "./pages/thread-window";
import AgentWindowPage from "./pages/agent-window";
import { StagingWindowStateProvider, type StagingWindowState } from "./stubs/desktop-shell";
import { pushStagingToast } from "./stubs/spa-bridge";
import { StagingChannelWindowsProvider } from "./stubs/channel-windows";

/**
 * STAGING ONLY — every staged popup behind the one contract the wiring pass hooks into real
 * triggers: `{ open, onClose }`. Each wraps the staged COPY (the file that ports back); nothing in
 * this file ports back.
 *
 * Components that own their own trigger on desktop (`AddPersonDialog`'s "Add person" pill,
 * `HomeSettingsControl`'s "Profile" pill, `AccountRail`'s "+" tile) are exported as-is from their
 * copies as well — `StagingChannelPeople` and `StagingAccountRail` below mount them in context.
 */

export interface PopupProps {
  open: boolean;
  onClose: () => void;
}

/* ─────────────────────────── /home header ─────────────────────────── */

/** "New channel" (`pages/home/new-channel-dialog.tsx`). */
export function StagingNewChannelDialog({ open, onClose }: PopupProps) {
  return (
    <NewChannelDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onCreated={() => onClose()}
    />
  );
}

/* ─────────────────────────── account rail ─────────────────────────── */

/** The rail's gated "+ New workspace" popup (`request-workspace-access-dialog.tsx`). */
export function StagingRequestWorkspaceAccess({ open, onClose }: PopupProps) {
  return (
    <RequestWorkspaceAccessDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    />
  );
}

/** The staged account rail itself (Home, workspace tiles, the dashed "+" that opens the gate). */
export function StagingAccountRail() {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div className="pps-rail-strip">
      <AccountRail
        workspaces={STAGING_WORKSPACES}
        activeWorkspacePublicId={active}
        onNavigate={(path) => {
          const ws = STAGING_WORKSPACES.find((w) => path.endsWith(w.publicId));
          setActive(ws ? ws.publicId : null);
        }}
      />
    </div>
  );
}

/* ─────────────────────────── app-level ─────────────────────────── */

/* The app-level runtime sign-in prompt (`components/runtime-sign-in-prompt.tsx`) and
   `IncomingToasts` are mounted ONCE, app-level, by `ui-staging/staging-popups-provider.tsx` (as
   desktop `app.tsx` mounts them). Raise the prompt with `raiseStagingSignInPrompt(runtime)`. */

/** The four toast faces `IncomingToasts` (staged copy, mounted by the catalog) raises from main. */
export const STAGING_TOASTS: ReadonlyArray<{ label: string; fire: () => void }> = [
  {
    label: "Toast: mention (card clickable)",
    fire: () =>
      pushStagingToast({
        eventId: "mention",
        title: "Grace Kim mentioned you in #launch",
        body: "@Daniel can you sanity-check the hero copy before 5?",
        openId: "thread:staging-thread-1",
      }),
  },
  {
    label: "Toast: actionable (button)",
    fire: () =>
      pushStagingToast({
        eventId: "consent",
        title: "Landing Coder wants to message Anthony",
        body: "Outbound message waiting for your review.",
        openId: "consent:1",
        actionLabel: "Review",
      }),
  },
  {
    label: "Toast: sticky (resume offer)",
    fire: () =>
      pushStagingToast({
        eventId: "resume",
        title: "3 agents were running when Dopl quit",
        body: "Resume them where they left off?",
        openId: "resume",
        actionLabel: "Resume",
        sticky: true,
      }),
  },
  {
    label: "Toast: plain (black line)",
    fire: () => pushStagingToast({ eventId: "done", title: "Release Runner finished" }),
  },
  {
    label: "Toast: row action result",
    fire: () => toast({ title: "Cursor disconnected" }),
  },
];

/* ─────────────────────────── channel Info → People ─────────────────────────── */

const STAGING_CHANNEL = {
  id: "staging-ch-launch",
  workspaceId: STAGING_HOME_WORKSPACE_ID,
  name: "launch",
  myWorkspaceRole: "owner",
  container: { segment: "launch-ab12cd" },
  linkOut: null,
} as unknown as Channel;

const STAGING_PENDING_LINK: ChannelPendingLink = {
  id: "staging-link-1",
  url: "https://www.usedopl.com/link/stg7hq2kd9x",
  label: null,
  createdAt: minsAgoIso(90),
  expiresAt: daysAgoIso(-6),
  maxUses: 1,
  useCount: 0,
  revokedAt: null,
  grantedRole: "guest",
} as ChannelPendingLink;

const STAGING_MEMBERS = STAGING_PEOPLE.map(
  (p, i) =>
    ({
      channelId: STAGING_CHANNEL.id,
      userId: p.userId,
      role: i === 0 ? "owner" : "member",
      workspaceRole: i === 0 ? "owner" : i === 1 ? "member" : "guest",
      displayName: p.displayName,
      email: p.email,
    }) as unknown as ChannelMember
);

/**
 * The People section of a channel's Info tab with the popups it raises: "Add person"
 * (`add-person-dialog.tsx`, its own trigger), each row's Remove / Leave confirm
 * (`person-roster-actions.tsx`), and the open-invitation panel with Revoke (`link-out-panel.tsx`).
 */
export function StagingChannelPeople() {
  return (
    <div className="bento flex w-95 flex-col gap-2 py-3">
      <PersonRosterActions homeChannel={STAGING_CHANNEL} />
      <ul className="divide-y divide-border-subtle px-3.5">
        {STAGING_MEMBERS.map((m) => (
          <li key={m.userId} className="flex items-center justify-between py-2">
            <span className="text-body text-text-primary">{m.displayName}</span>
            <PersonRosterRowAction
              member={m}
              homeChannel={STAGING_CHANNEL}
              viewerUserId={STAGING_USER_ID}
              onRosterChanged={() => toast({ title: "Staging: roster refetched" })}
              onLeft={() => toast({ title: "Staging: left the channel" })}
            />
          </li>
        ))}
      </ul>
      <div className="px-3.5 pt-1">
        <LinkOutPanel link={STAGING_PENDING_LINK} />
      </div>
    </div>
  );
}

/* ─────────────────────────── windows ─────────────────────────── */

/** A desktop BrowserWindow stand-in for the two pop-out windows. Staging chrome only. */
function StagingWindow({
  open,
  onClose,
  width,
  children,
}: PopupProps & { width: number; children: (state: StagingWindowState) => ReactNode }) {
  const [state, setState] = useState<StagingWindowState>("ready");
  if (!open) return null;
  return (
    <div className="pps-window-scrim" onMouseDown={onClose}>
      <div className="pps-window-wrap" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pps-window-bar">
          {(["ready", "loading", "error"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={state === s}
              onClick={() => setState(s)}
              className="btn-light rounded-full px-2.5 py-0.5 text-small"
            >
              {s === "ready" ? "Data" : s === "loading" ? "Loading" : "Error"}
            </button>
          ))}
          <button type="button" onClick={onClose} className="btn-light rounded-full px-2.5 py-0.5 text-small">
            Close window
          </button>
        </div>
        <div className="pps-window" style={{ width }}>
          <StagingWindowStateProvider value={state}>
            <StagingChannelWindowsProvider>{children(state)}</StagingChannelWindowsProvider>
          </StagingWindowStateProvider>
        </div>
      </div>
    </div>
  );
}

/** The thread pop-out window (`pages/thread-window/index.tsx`): frame + states, and the /channels
 *  staging transcript held on the demo's open thread (`stubs/channel-windows.tsx`). */
export function StagingThreadWindow({ open, onClose }: PopupProps) {
  return (
    <StagingWindow open={open} onClose={onClose} width={640}>
      {() => <ThreadWindowPage />}
    </StagingWindow>
  );
}

/** The agent pop-out window (`pages/agent-window/index.tsx`): real tabs + rail chrome over the
 *  /channels staging sessions, /channels' agent view as the body, and the "+" New agent dialog
 *  launching into the same in-memory store (`stubs/channel-windows.tsx`). */
export function StagingAgentWindow({ open, onClose }: PopupProps) {
  return (
    <StagingWindow open={open} onClose={onClose} width={510}>
      {() => <AgentWindowPage />}
    </StagingWindow>
  );
}
