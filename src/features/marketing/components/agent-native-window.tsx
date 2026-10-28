"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  buildTimeline,
  finalFrame,
  type ChatFrame,
} from "@/features/onboarding/components/connect-agent-script";
import { ChatTranscript, TRANSCRIPT_KEYFRAMES } from "@/features/onboarding/components/connect-agent-transcript";
import { AGENT_APP, AGENT_SCRIPT } from "./agent-native-content";
import type { OntologyPlay } from "./use-ontology-play";

/**
 * The window on the Agent native glass: the user inside an AGENT'S OWN desktop
 * app (Claude, then Gemini), not Dopl's UI, while that agent does Dopl's work
 * over MCP. The transcript is onboarding step 2's, by import: its
 * `ChatTranscript` (bottom-anchored, word by word, shimmering Dopl tool rows)
 * and its `buildTimeline` / `finalFrame`, fed this section's script
 * (./agent-native-content.ts › AGENT_SCRIPT). Onboarding is unchanged.
 *
 * Play: the clock walks the timeline only while `play` is `in` (on screen,
 * panel showing; ./use-ontology-play), restarts from frame zero each time it
 * returns, and loops. `static` (SSR, no JS, reduced motion) renders Claude's
 * finished frame. ⚠ The window's height is pinned in ../agent-native.css, so
 * the glass never resizes; the transcript scrolls inside it.
 */

const TIMELINE = buildTimeline(AGENT_SCRIPT);
const STILL = finalFrame(0, AGENT_SCRIPT);

/** One timer live at a time, the onboarding clock's contract. */
function useChatClock(active: boolean, still: boolean): ChatFrame {
  const [frame, setFrame] = useState<ChatFrame>(TIMELINE.frames[0]);
  useEffect(() => {
    if (!active || still) return;
    const { frames, cycle } = TIMELINE;
    let timer: ReturnType<typeof setTimeout>;
    const step = (i: number) => {
      setFrame(frames[i]);
      const next = i + 1;
      timer =
        next < frames.length
          ? setTimeout(() => step(next), frames[next].at - frames[i].at)
          : setTimeout(() => step(0), cycle - frames[i].at);
    };
    timer = setTimeout(() => step(0), 0);
    return () => clearTimeout(timer);
  }, [active, still]);
  return still ? STILL : frame;
}

/** The chat box's size; ChatTranscript positions in px. */
function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function AgentAppWindow({ play }: { play: OntologyPlay }) {
  const still = play === "static";
  const frame = useChatClock(play === "in", still);
  const segment = AGENT_SCRIPT[frame.seg];
  const [chatRef, size] = useBoxSize();
  const fs = Math.min(13, Math.max(11.5, size.w / 40));

  return (
    <div className="lp-agn-app" aria-hidden="true">
      <style>{TRANSCRIPT_KEYFRAMES}</style>
      <div className="lp-connect-term-bar lp-agn-app-bar">
        <span className="lp-connect-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lp-agn-app-title">
          <span className="lp-agn-app-icon">
            {AGENT_SCRIPT.map((s) => (
              // eslint-disable-next-line @next/next/no-img-element -- local asset
              <img
                key={s.logo}
                src={AGENT_APP.logos[s.logo]}
                alt=""
                draggable={false}
                data-on={s.logo === segment.logo || undefined}
              />
            ))}
          </span>
          {segment.name}
        </span>
        <span className="lp-ont-live lp-agn-app-mcp">
          <i />
          {AGENT_APP.connected}
        </span>
      </div>

      <div className="lp-agn-app-chat" ref={chatRef}>
        <ChatTranscript
          rect={{ x: 0, y: 0, w: size.w, h: size.h }}
          msgs={segment.msgs}
          frame={frame}
          fs={fs}
          doplSrc={AGENT_APP.doplMark}
          still={still}
        />
      </div>

      <div className="lp-ont-composer lp-agn-app-composer">
        <span className="lp-ont-composer-text lp-ont-composer-hint">
          {AGENT_APP.replyTo} {segment.name}
        </span>
        <span className="lp-ont-send">
          <ArrowUp size={12} strokeWidth={2.5} />
        </span>
      </div>
    </div>
  );
}
