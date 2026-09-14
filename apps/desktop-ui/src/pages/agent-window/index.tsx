import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { ChannelsV2AgentWindow } from "@/features/channels/components/channels-v2/agent-window";
import { AgentWindowShell } from "@/features/channels/components/channels-v2/agent-window-shell";
import type { AgentTabView } from "@/features/channels/components/channels-v2/agent-window-chrome";
import {
  AgentEndedPill,
  AgentLiveness,
} from "@/features/channels/components/channels-v2/agent-bits";
import {
  agentDisplayName,
  agentLiveness,
} from "@/features/channels/components/channels-v2/agents-model";
import { useDesktopSessions } from "@/features/channels/components/channels-v2/use-desktop-sessions";
import {
  canLaunchAgents,
  openAgentWindow,
} from "@/features/channels/components/channels-v2/agents-controls";
import { useAgentLaunch } from "@/features/channels/components/channels-v2/use-agent-launch";
import { AgentWindowLaunch } from "@/features/channels/components/channels-v2/agent-window-launch";
import {
  closeOwnTab,
  onAgentWindowTabs,
  type AgentWindowTab,
} from "@/shared/lib/spa-bridge-window";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
// ⚠ `?inline` FOR THE SAME REASON `components/app-shell/account-rail.tsx` takes it: the packaged
// renderer is a `file://` document, so the mark travels as a data URI rather than a URL. It is
// handed DOWN to the window because `src/**` has no `#/` alias
// (`channels-v2/agent-window-shell.tsx › logoSrc` carries the argument; it was the agent VIEW's prop
// until the mark moved into the window's chrome on 2026-09-13).
import doplMark from "#/assets/dopl-mark.png?inline";
import {
  PageError,
  PageLoading,
  isUnauthorized,
} from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * `/:workspaceSegment/agent-window/:channelId?thread=` — THE AGENT WINDOW'S PAGE
 * (2026-08-20, F-212's closure).
 *
 * ⚠ THE SEAM IS `pages/thread-window/index.tsx`'s, deliberately verbatim: resolve the
 * workspace, hand over, and own nothing else. Both windows are the same KIND of surface —
 * a second app window on this bundle, outside `AppShellLayout` — and the day one of them
 * grows a different auth or error shape is the day two windows disagree about what a 401
 * looks like.
 *
 * ⚠ WHY IT IS OUTSIDE THE APP SHELL. This window shows ONE agent. It has no sidebar, no
 * channels tree and no info panel, and a layout route cannot be opted out of from inside
 * it — the same argument that gave the pop-out its own top-level row.
 *
 * ⚠ AND IT IS NOT DEEP-LINKABLE, ON PURPOSE. Absent from both `WORKSPACE_PAGES` and
 * `main/deep-link-target.js › ROOT_ROUTES`, so `dopl://open/{segment}/agent-window/{id}`
 * resolves as an unknown page inside a real workspace and opens that workspace's home
 * page. An agent window is created by MAIN, at a window it built and registered; a grammar
 * that could mint one from an arbitrary caller's URL would be a new surface, not a
 * shortcut.
 *
 * ⚠ `?thread=` IS THE AGENT'S OWN HALF OF ITS KEY. An agent is addressed as
 * (channel, thread) everywhere in this tree — never by `sessionId`, which a park+resume
 * re-mints — so the pair in this URL is the same pair `sessions.pause`, `sessions.end`,
 * `sessions.message` and the reopen path all take.
 */
export default function AgentWindowPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();
  // ⚠ THE SEGMENT IS READ NOW BECAUSE THE RAIL CAN OPEN A TAB (2026-09-13): every
  // `openAgentWindow` takes one, and this window's own URL is where it already is.
  const { channelId, workspaceSegment } = useParams<{
    channelId: string;
    workspaceSegment: string;
  }>();
  const [search] = useSearchParams();
  const taskId = search.get("thread");
  // ⚠ WHICH INSTANCE (2026-08-22). `(channel, thread)` names a GROUP of this
  // operator's agents since multiplayer, so the pair alone lands on whichever the
  // feed lists first. Read here NOW, ahead of main emitting it, so the window
  // becomes exact with no second change on this side; absent, it degrades to the
  // pair exactly as it did before.
  const agentId = search.get("agent");

  if (isUnauthorized(error))
    return (
      <Frame>
        <SignedOutScreen />
      </Frame>
    );
  if (error) {
    return (
      <Frame>
        <PageError error={error} onRetry={refetch} />
      </Frame>
    );
  }
  if (isPending || !access || !channelId) {
    return (
      <Frame>
        <PageLoading label="Loading agent" />
      </Frame>
    );
  }

  return (
    <Frame>
      <AgentWindowTabs
        workspaceId={access.workspaceId}
        currentUserId={access.currentUserId}
        segment={workspaceSegment ?? ""}
        route={{ channelId, taskId: taskId ?? "", agentId: agentId ?? "" }}
      />
    </Frame>
  );
}

/**
 * (channel, thread, agent) → the tab key, **the same rule `main/agent-window.js › agentWindowKey`
 * applies** — a HAND COPY, and the only one, for the reason main's own header gives about
 * `AGENT_WINDOW_PAGE`: main cannot import the SPA's TypeScript and this side cannot require main's
 * CommonJS. ⚠ The two-part degradation is part of the rule: an absent agent id must produce the
 * SAME key on both sides or a tab main pushed would never match the one this page seeded.
 */
export function agentTabKey(tab: {
  channelId: string;
  taskId: string;
  agentId?: string | null;
}): string {
  const agent = String(tab.agentId || "");
  return agent
    ? `${tab.channelId}|${tab.taskId}|${agent}`
    : `${tab.channelId}|${tab.taskId}`;
}

/**
 * THE TAB HOST (2026-09-13) — main owns the SET, this owns which one is SHOWN.
 *
 * ⚠ **THE ROUTE SEEDS THE FIRST TAB AND THE BRIDGE REPLACES THE LIST.** A build without the push
 * (a browser, an older main) therefore renders exactly what this window rendered before tabs
 * existed: one tab, its own route's (INVARIANTS §11 — the absence degrades, it does not error).
 *
 * ⚠ **ONE AGENT VIEW IS MOUNTED AT A TIME, and that is deliberate rather than lazy.** Each view
 * carries a narration subscription, a transcript read and a consent read; four live at once would
 * quadruple a window's server diet to show one of them. Switching tabs remounts — the streams are
 * pushed and re-arrive.
 */
function AgentWindowTabs({
  workspaceId,
  currentUserId,
  segment,
  route,
}: {
  workspaceId: string;
  currentUserId: string;
  segment: string;
  route: { channelId: string; taskId: string; agentId: string };
}) {
  const seed = useMemo<AgentWindowTab>(
    () => ({ key: agentTabKey(route), segment, ...route }),
    [route, segment],
  );
  const [tabs, setTabs] = useState<readonly AgentWindowTab[]>([seed]);
  const [activeKey, setActiveKey] = useState(seed.key);
  // ⚠ THE FEED IS READ HERE, ONCE, FOR TWO READERS — the rail's rows and the strip's names. The
  // agent VIEW subscribes separately because it is its own tree-shaped consumer; this is the same
  // hook, and `use-desktop-sessions.ts` is a shared subscription rather than a second wire.
  const { sessions } = useDesktopSessions();
  // 🔒 THE "+"'s OWN STATE, HELD HERE BECAUSE THE BUTTON AND THE FORM ARE IN DIFFERENT SUBTREES —
  // the `+` is in the chrome (inside the shell), the dialog is a sibling of the shell. ⚠ ABOVE
  // EVERY BRANCH, like every hook in this file: the tab host has no early return today and must not
  // acquire one above a hook.
  const launch = useAgentLaunch();

  useEffect(
    () =>
      onAgentWindowTabs(({ tabs: next, focusKey }) => {
        // ⚠ MAIN'S LIST WINS WHOLE — never merged with this one. It is the only half that knows
        // what is open, and a merge would resurrect a tab main had just closed.
        if (next.length > 0) setTabs(next);
        if (focusKey) setActiveKey(focusKey);
      }),
    [],
  );

  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0] ?? seed;
  const activeAgent = useMemo(
    () =>
      (sessions ?? []).find(
        (s) =>
          s.channelId === active.channelId &&
          s.taskId === active.taskId &&
          (!active.agentId || s.agentId === active.agentId),
      ) ?? null,
    [sessions, active],
  );

  // The strip's labels: the address from main, the NAME from this machine's feed — so a rename
  // shows on the tab immediately instead of waiting for a push (INVARIANTS §5: never a raw id).
  const views: AgentTabView[] = tabs.map((tab) => {
    const match = (sessions ?? []).find(
      (s) =>
        s.channelId === tab.channelId &&
        s.taskId === tab.taskId &&
        (!tab.agentId || s.agentId === tab.agentId),
    );
    return { key: tab.key, name: match ? agentDisplayName(match) : "Agent" };
  });

  return (
    <>
      <AgentWindowShell
        tabs={views}
        activeKey={active.key}
        onSelect={setActiveKey}
        // ⚠ MAIN CLOSES IT — and takes the window down with the last one. This side does not remove
        // the row itself: the push that follows is what re-renders the strip, so there is exactly one
        // account of which tabs exist.
        onCloseTab={(key) => void closeOwnTab(key)}
        // 🔒 THE "+" OPENS THE New agent FORM for the ACTIVE tab's channel (the strip's own ruling).
        // ⚠ IT WAS WIRED TO NOTHING UNTIL 2026-09-13's second pass — the prop was passed, the chrome
        // drew the control, and no host mounted a dialog, so the click reported into a void.
        // ⚠ **AND IT IS FEATURE-DETECTED, NOT ALWAYS DRAWN** — `agents-controls.ts ›
        // canLaunchAgents`, the SAME op the form itself gates its Launch button on
        // (`agent-window-launch.tsx`: *"ABSENT, NOT DISABLED, when the bridge cannot launch"*).
        // Without that gate a browser or an older main drew a "+" that opened a dialog with no
        // Launch in it — a control that cannot act, on screen, which INVARIANTS §11 refuses. The
        // chrome already hides the "+" when this prop is absent, so `undefined` is the whole fix.
        onNewAgent={canLaunchAgents() ? launch.toggle : undefined}
        status={
          activeAgent ? (
            activeAgent.state === "ended" ? (
              <AgentEndedPill />
            ) : (
              <AgentLiveness {...agentLiveness(activeAgent)} />
            )
          ) : null
        }
        logoSrc={doplMark}
        sessions={sessions}
        keyFor={(session) =>
          agentTabKey({
            channelId: session.channelId ?? "",
            taskId: session.taskId ?? "",
            agentId: session.agentId,
          })
        }
        // ⚠ A RAIL CLICK GOES THROUGH MAIN, NOT THROUGH THIS STATE. `openAgentWindow` adds the tab
        // (or fronts the one already open) and pushes the new set back, so opening from the rail and
        // opening from the Agents tab are the SAME path — and an agent the rail names but main has
        // not tabbed cannot be shown by a local selection that main knows nothing about.
        onOpenSession={(session) => {
          void openAgentWindow(
            {
              channelId: session.channelId ?? "",
              taskId: session.taskId ?? "",
              agentId: session.agentId ?? undefined,
            },
            segment,
          );
        }}
      >
        <ChannelsV2AgentWindow
          // ⚠ KEYED BY THE TAB: a switch must REMOUNT the view, or the previous agent's narration
          // ring and composer draft would be handed to the next one.
          key={active.key}
          workspaceId={workspaceId}
          channelId={active.channelId}
          taskId={active.taskId}
          agentId={active.agentId || null}
          currentUserId={currentUserId}
        />
      </AgentWindowShell>
      {/* ⚠ OUTSIDE THE SHELL, and it makes no difference to where it PAINTS — the dialog portals to
          `document.body` — but it keeps the shell's children exactly "the active tab's agent view".
          ⚠ KEYED BY THE TAB for the same reason the view is: a half-filled form must not survive
          into a different channel, where its Launch would land somewhere the operator did not type. */}
      <AgentWindowLaunch
        key={active.key}
        panel={launch}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        channelId={active.channelId}
        taskId={active.taskId}
        /* ⚠ **THE POPUP'S COLOUR ROW READS THIS AND NOTHING ELSE IN THIS WINDOW** (2026-09-13):
           the whole own feed, narrowed to the active tab's channel inside the component. This
           window reads no channel projection, so the operator's own live agents are the taken set
           it can know — `agent-window-launch.tsx › sessions` carries the trade. */
        sessions={sessions}
        agent={activeAgent}
      />
    </>
  );
}

/**
 * The window ground.
 *
 * ⚠ `shell.windowSurface`, NOT `shell.surface` (Samuel, 2026-08-27). `.surface` carries the main
 * window's 8px radius and its margin on all four sides, which inside a pop-out painted a rounded
 * panel floating on `.root`'s gray — a second background and a second set of corners inside an OS
 * window that already has its own. The pop-out's viewport IS the panel.
 *
 * ⚠ `shell.root` STAYS, and it is not the layer that was showing: it supplies the fixed inset,
 * the font stack, the box-sizing reset and the overflow clip. It paints the shell gray, which
 * `windowSurface` now covers edge to edge.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={shell.root}>
      <div className={shell.body}>
        <div className={shell.windowSurface}>{children}</div>
      </div>
    </div>
  );
}
