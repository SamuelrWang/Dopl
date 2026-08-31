"use client";

/**
 * Scripted product demo for the hero banner's slot (hero-banner.tsx).
 * Decorative and non-interactive — the slot keeps `pointer-events: none`.
 *
 * ⚠ THE SCENE IS /home, NOT THE WORKSPACE CHANNELS PAGE (Samuel, 2026-08-30,
 * over a screenshot of the old scene: *"the /home channel view instead — that
 * UI, not this one"*). What was here was `ChannelsV2Sidebar` — the workspace
 * tree, with Assistant / Drafts / Saved items over DIRECT MESSAGES and
 * CHANNELS. It is gone. The frame is now the ACCOUNT surface: the dark
 * `--home-frame` slab with the account rail, ONE gray `--home-panel` float
 * carrying the Chat/Knowledge/Agents header and the 290px channel list, and
 * the conversation inside a white `--home-card` record pane.
 *
 * ⚠ THE RECORD PANE IS STILL THE PRODUCT'S OWN SURFACE, and that is not a
 * leftover — it is what /home actually mounts. `relationship-record.tsx` puts
 * `StandaloneChannelSurface` in that pane, i.e. exactly the message pane, info
 * column and agent view composed below. Only the CHROME around it is mock
 * markup (`demo-home-chrome.tsx`), because /home's own chrome lives in
 * `apps/desktop-ui/`, which the Next tree cannot import at all.
 *
 * The scripted cursor still presses the REAL buttons — the thread card's "Open
 * thread", the info column's Agents tab, an agent card's "Open" — via
 * programmatic `.click()`, so every transition runs the product's own handlers
 * and state.
 *
 * ⚠ THE CANVAS FILLS THE SLOT EDGE TO EDGE (Samuel, same review: the white
 * gutters at the left and right had to go). CANVAS_W is fixed and the scale is
 * `slotWidth / CANVAS_W` — never a `min()` contain-fit, which is what left the
 * gutters: the slot is ~1.93:1 and the canvas was 1.85:1, so height won and
 * ~27px of white showed down each side. The canvas HEIGHT is derived from that
 * scale instead, so the design box is exactly the slot in design units and the
 * scene is a normal flex column inside it. See `fit()`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { ChannelsV2MessagePane } from "@/features/channels/components/channels-v2/message-pane";
import { ChannelsV2InfoPanel } from "@/features/channels/components/channels-v2/info-panel";
import { indexMembers } from "@/features/channels/components/channels-v2/view-model";
import {
  channelRows,
  threadRows,
} from "@/features/channels/components/channels-v2/view-model-rows";
import { agentKey } from "@/features/channels/components/channels-v2/agents-model";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { CANVAS_H, CANVAS_W, at, reached } from "./demo-steps";
import {
  AGENT_INDEX,
  CHANNEL_ID,
  CURRENT_USER_ID,
  MEMBERS,
  MY_SESSION,
  PEER_ANALYST,
  PEER_ENRICHER,
  SALES_CHANNEL,
  THREAD,
  THREAD_ID,
  WORKSPACE_ID,
  messagesAt,
  narrationAt,
} from "./demo-data";
import { HOME_ROW_ID, VIEWER, homeRowsAt } from "./demo-home-rows";
import {
  DemoAccountRail,
  DemoChannelList,
  DemoHomeHeader,
} from "./demo-home-chrome";
import { DemoAgentView } from "./demo-agent-view";
import { useDemoTimeline } from "./use-demo-timeline";

/** The composer's writes never fire (the slot is inert), so the gate is a stub. */
const DEMO_GATE: MutationGate = { begin() {}, end() {} };

const NOOP = () => {};

type Cursor = { x: number; y: number; shown: boolean; instant: boolean };

/** First button under `root` whose visible label matches. */
function findButton(
  root: HTMLElement | null,
  match: (label: string) => boolean,
): HTMLButtonElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll("button")) {
    if (match((el.textContent ?? "").trim())) return el;
  }
  return null;
}

export function BannerDemo() {
  const { step, run, rootRef } = useDemoTimeline();
  const canvasRef = useRef<HTMLDivElement>(null);
  /** ⚠ The record pane, and the cursor's search root — NOT the canvas. The
   *  /home header now carries a button labelled "Agents" (the surface selector)
   *  and `findButton` takes the first match in DOM order, which would hand the
   *  cursor the header instead of the info column's Agents TAB. Scoping the
   *  search to the pane is what keeps the two apart. */
  const paneRef = useRef<HTMLDivElement>(null);
  /** Design box + its scale, as one write: `w` is fixed, `h` is derived so the
   *  scaled canvas is EXACTLY the slot (see the file docblock). */
  const [box, setBox] = useState({ scale: 1, h: CANVAS_H });
  const [qc] = useState(() => new QueryClient());

  // Set by the REAL components' own callbacks when the cursor clicks them;
  // gated on the step so a loop reset closes everything without an effect.
  const [threadClicked, setThreadClicked] = useState(false);
  const [agentClicked, setAgentClicked] = useState(false);
  const threadOpen = threadClicked && reached(step, "click-thread");
  const agentOpen = agentClicked && reached(step, "click-agent");

  const [cursor, setCursor] = useState<Cursor>({
    x: CANVAS_W + 40,
    y: 60,
    shown: false,
    instant: true,
  });
  const cursorPos = useRef(cursor);
  useEffect(() => {
    cursorPos.current = cursor;
  }, [cursor]);
  const [ripple, setRipple] = useState({ x: 0, y: 0, n: 0 });

  // FILL the slot — never contain-fit it (the file docblock has the gutters
  // this replaced). Width sets the scale; height follows in design units, so
  // `CANVAS_W × h` scaled by `scale` is the slot to the pixel on both axes and
  // the scene is a plain flex column that grows into whatever `h` comes out as.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fit = () => {
      const r = root.getBoundingClientRect();
      // A slot with no box yet (first paint, a hidden tab) would divide by zero
      // and park the canvas at Infinity; keep the last good box instead.
      if (r.width <= 0 || r.height <= 0) return;
      const scale = r.width / CANVAS_W;
      setBox({ scale, h: r.height / scale });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  }, [rootRef]);

  /* ── The scene's data at this step — real shapes, real derivations ── */

  const messages = useMemo(() => messagesAt(step), [step]);
  const index = useMemo(
    () => indexMembers(MEMBERS, CURRENT_USER_ID, AGENT_INDEX),
    [],
  );
  const threads = useMemo(
    () => (reached(step, "thread-card") ? [THREAD] : []),
    [step],
  );
  const thread = threadOpen ? THREAD : null;
  const rows = useMemo(
    () =>
      thread
        ? threadRows(messages, THREAD_ID, index, formatChannelTimestamp)
        : channelRows(messages, threads, index, formatChannelTimestamp),
    [messages, thread, threads, index],
  );
  const sessions = useMemo(
    () => (reached(step, "launch-2") ? [MY_SESSION] : []),
    [step],
  );
  const peers = useMemo(() => {
    const out = [];
    if (reached(step, "launch-1")) out.push(PEER_ENRICHER);
    if (reached(step, "launch-3")) out.push(PEER_ANALYST);
    return out;
  }, [step]);
  const homeRows = useMemo(() => homeRowsAt(step), [step]);

  /* ── Cursor choreography — glide to and press the REAL controls ──── */

  useEffect(() => {
    const canvas = canvasRef.current;
    // ⚠ SEARCHED IN THE PANE, MEASURED AGAINST THE CANVAS — see `paneRef`.
    const pane = paneRef.current;
    const target = (): HTMLElement | null => {
      if (at(step, "cursor-to-thread") || at(step, "click-thread"))
        return findButton(pane, (l) => l === "Open thread");
      if (at(step, "cursor-to-tab") || at(step, "click-tab"))
        // ⚠ The count badge concatenates into textContent ("Agents3").
        return findButton(pane, (l) => l.startsWith("Agents"));
      if (at(step, "cursor-to-agent") || at(step, "click-agent"))
        return findButton(pane, (l) => l === "Open");
      return null;
    };
    const locate = (el: HTMLElement) => {
      if (!canvas) return null;
      const cr = canvas.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const s = cr.width / CANVAS_W;
      return {
        x: (er.left - cr.left + er.width * 0.55) / s,
        y: (er.top - cr.top + er.height * 0.55) / s,
      };
    };

    // ⚠ Everything runs from a 0ms timer, never the effect body — the lint's
    // set-state-in-effect rule (error tier) rejects synchronous setState here,
    // and the choreography needs the step's DOM committed anyway.
    let raf = 0;
    const t = window.setTimeout(() => {
      if (
        at(step, "cursor-to-thread") ||
        at(step, "cursor-to-tab") ||
        at(step, "cursor-to-agent")
      ) {
        const el = target();
        const to = el && locate(el);
        if (!to) return;
        // Fresh entry spawns offscreen, then glides (CSS transition); a cursor
        // already on stage just glides to the next control.
        setCursor((c) =>
          c.shown
            ? { ...to, shown: true, instant: false }
            : { x: CANVAS_W + 40, y: 60, shown: true, instant: true },
        );
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() =>
            setCursor({ ...to, shown: true, instant: false }),
          );
        });
        return;
      }

      if (
        at(step, "click-thread") ||
        at(step, "click-tab") ||
        at(step, "click-agent")
      ) {
        const { x, y } = cursorPos.current;
        setRipple((r) => ({ x, y, n: r.n + 1 }));
        const el = target();
        // The REAL control's own handler runs — this is the product reacting,
        // not the demo repainting.
        el?.click();
        if (at(step, "click-thread")) setThreadClicked(true);
        if (at(step, "click-agent")) setAgentClicked(true);
        return;
      }

      if (
        at(step, "thread-open") ||
        at(step, "tab-open") ||
        at(step, "agent-open")
      ) {
        setCursor((c) => (c.shown ? { ...c, shown: false } : c));
      }
    }, 0);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [step]);

  const resetting = at(step, "reset-fade");

  return (
    <div className="lp-demo" ref={rootRef} aria-hidden="true">
      <div
        className={`lp-demo-canvas${resetting ? " is-resetting" : ""}`}
        ref={canvasRef}
        style={{
          height: box.h,
          transform: `translate(-50%, -50%) scale(${box.scale})`,
        }}
      >
        <QueryClientProvider client={qc}>
          {/* /home's frame: the dark slab, the rail, and ONE gray panel butting
              flush-left against the rail — `pages/home/index.tsx`'s `!ml-0`,
              here as `.lp-demo-panel`'s own zeroed left margin. */}
          <div className="lp-demo-home antialiased">
            <DemoAccountRail />
            <main className="page-float lp-demo-panel">
              <DemoHomeHeader viewer={VIEWER} />
              <div className="flex min-h-0 flex-1">
                <DemoChannelList rows={homeRows} selectedId={HOME_ROW_ID} />
                {/* THE RECORD PANE — a white card bounded by the account
                    palette's 2px line, NOT an elevation (`index.tsx`: no
                    `.bento`, the drop had nowhere to fall). `.lp-demo-record`
                    also carries `home.module.css › .frame`'s overrides, which
                    are what put the account palette on the shared surface's own
                    dividers, sender pills and composer panel. `relative` is the
                    agent view's containing block, exactly as
                    `channel-surface-standalone.tsx` states. */}
                <div className="lp-demo-record" ref={paneRef}>
                  <ChannelsV2MessagePane
                    key={`pane-${run}`}
                    channelId={CHANNEL_ID}
                    workspaceId={WORKSPACE_ID}
                    channelName="q4-outbound"
                    thread={thread}
                    rows={rows}
                    index={index}
                    members={MEMBERS}
                    loading={false}
                    scrollTarget={null}
                    infoOpen
                    favorited
                    gate={DEMO_GATE}
                    onToggleInfo={NOOP}
                    onToggleFavorite={NOOP}
                    onExitThread={NOOP}
                    onOpenAgent={() => setAgentClicked(true)}
                    onOpenThread={() => setThreadClicked(true)}
                  />
                  <div className="channel-info-slide" data-open="true">
                    <ChannelsV2InfoPanel
                      key={`info-${run}`}
                      channel={SALES_CHANNEL}
                      channelName="q4-outbound"
                      members={MEMBERS}
                      threads={threads}
                      threadsTruncated={false}
                      threadsLoading={false}
                      index={index}
                      openThread={thread}
                      onOpenThread={() => setThreadClicked(true)}
                      agentSessions={sessions}
                      peerSessions={peers}
                      openAgent={agentOpen ? agentKey(MY_SESSION) : null}
                      onOpenAgent={() => setAgentClicked(true)}
                      mentions={[]}
                      mentionsTruncated={false}
                      mentionsLoading={false}
                      onOpenMention={NOOP}
                      onMarkAllMentionsRead={NOOP}
                    />
                  </div>
                  <DemoAgentView
                    open={agentOpen}
                    agent={MY_SESSION}
                    entries={narrationAt(step)}
                    messages={messages}
                    currentUserId={CURRENT_USER_ID}
                    viewer={VIEWER}
                    onClose={NOOP}
                  />
                </div>
              </div>
            </main>
          </div>
        </QueryClientProvider>

        <div
          className={`lp-demo-cursor${cursor.shown ? " is-shown" : ""}`}
          style={{
            transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`,
            transition: cursor.instant ? "none" : undefined,
          }}
        >
          <svg viewBox="0 0 13 19" width="17" height="25" fill="none">
            <path
              d="M0.75 0.9 L0.75 15.2 L4.3 11.9 L6.4 16.8 L8.3 15.9 L6.3 11.1 L10.6 10.8 Z"
              fill="#0b0b0c"
              stroke="#ffffff"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {ripple.n > 0 && (
          <span
            key={ripple.n}
            className="lp-demo-ripple"
            style={{ left: ripple.x, top: ripple.y }}
          />
        )}
      </div>
    </div>
  );
}
