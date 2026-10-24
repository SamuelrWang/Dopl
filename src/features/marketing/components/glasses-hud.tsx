"use client";

import "@/features/marketing/glasses-hud.css";

import {
  HUD_BAR_MS,
  HUD_CONNECT_MS,
  HUD_CONNECTION,
  HUD_FEED,
  HUD_HEADER,
  HUD_LOOP_FADE_MS,
  HUD_VOICE_WORD_MS,
  HUD_WORD_MS,
  type HudChart,
  type HudLine,
  type HudStep,
} from "./glasses-hud-content";
import type { CSSProperties } from "react";
import { DeviceConnect } from "./device-connect";
import { useFeedPlayer } from "./use-feed-player";

/** Live G2 lens over the glasses photo: a fixed-height outline box (+ the
 *  Dopl mark on its bottom edge) playing one conversation as a chat feed —
 *  header pinned at the top, a voice footer pinned at the bottom, and each
 *  new message appended at the bottom of the feed while the older lines slide
 *  UP and out of the top. Agent replies type in word by word in the feed; a
 *  user message is dictated first — the level bars go live and the words type in
 *  beside it in the footer — then posts as `You: … (Sent)`. At the end the
 *  feed fades and restarts. Clock, pausing (off screen / not the front card),
 *  reduced motion and the slide-up: ./use-feed-player.
 *
 *  Layers (glasses-hud.css): photo (grain baked in) → HUD. The HUD's own
 *  grain is a static CSS mask on `.lp-dev-hud`, so only the green light is
 *  grainy and it costs no JS. */
type FeedItem = Extract<HudStep, { kind: "message" | "chart" }>;

/** What the lens shows after the first `count` beats: messages and charts. */
const feedAt = (count: number): FeedItem[] =>
  HUD_FEED.slice(0, count).filter((step): step is FeedItem => step.kind === "message" || step.kind === "chart");

/** Units this beat reveals one at a time: connect chips, dictated words,
 *  chart bars, or the words of a typed line. */
const typedWords = (step: HudStep) => {
  if (step.kind === "connect") return HUD_CONNECTION.functions.length;
  if (step.kind === "voice") return step.text.split(" ").length;
  if (step.kind === "chart") return step.chart.bars.length;
  const typed = step.lines.find((line) => line.type);
  return typed ? typed.text.split(" ").length : 0;
};

const ticks = (step: HudStep) => typedWords(step);
const cadence = (step: HudStep) =>
  step.kind === "connect"
    ? HUD_CONNECT_MS
    : step.kind === "voice"
      ? HUD_VOICE_WORD_MS
      : step.kind === "chart"
        ? HUD_BAR_MS
        : HUD_WORD_MS;

export function GlassesHud() {
  const { rootRef, feedRef, count, words, fading, beat: step } = useFeedPlayer({
    beats: HUD_FEED,
    ticks,
    cadence,
    fadeMs: HUD_LOOP_FADE_MS,
  });

  const messages = feedAt(count);
  // The connect beat is beat 1: while it plays its chips tick in; after it,
  // every chip stays up for the rest of the run.
  const chips = count > 1 ? Number.POSITIVE_INFINITY : words;
  const current = step && (step.kind === "message" || step.kind === "chart") ? step.id : null;
  const dictation = step?.kind === "voice" && !fading ? step.text.split(" ").slice(0, words).join(" ") : null;

  return (
    <div className="lp-dev-hud-layers" ref={rootRef} aria-hidden="true">
      {/* Outside `.lp-dev-hud` on purpose: the pill is landing UI, not lens light. */}
      <DeviceConnect connection={HUD_CONNECTION} shown={chips} place="bottom" />
      <div className="lp-dev-hud">
        <div className="lp-dev-hud-box">
          <span className="lp-dev-hud-frame" />
          <p className="lp-dev-hud-line" data-tone="dim">
            {HUD_HEADER}
          </p>
          <div className="lp-dev-hud-viewport">
            <div className="lp-dev-hud-feed" ref={feedRef} data-fading={fading || undefined}>
              {messages.map((item) => {
                const shown = item.id === current ? words : Number.POSITIVE_INFINITY;
                return (
                  <div key={item.id} className="lp-dev-hud-msg">
                    {item.kind === "chart" ? (
                      <HudChartView chart={item.chart} bars={shown} />
                    ) : (
                      item.lines.map((line) => <HudRow key={line.text} line={line} words={shown} />)
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="lp-dev-hud-voice" data-live={dictation !== null || undefined}>
            <VoiceLevels />
            {dictation ? <p className="lp-dev-hud-line lp-dev-hud-dictation">{dictation}</p> : null}
          </div>
          <DoplMark />
        </div>
      </div>
    </div>
  );
}

function HudRow({ line, words }: { line: HudLine; words: number }) {
  const all = line.text.split(" ");
  const typing = line.type && words < all.length;
  // The untyped words stay in the flow, invisible, so the box never reflows
  // while a line types in.
  const shown = line.type ? all.slice(0, words).join(" ") : line.text;
  const rest = line.type ? all.slice(words).join(" ") : "";
  return (
    <p className="lp-dev-hud-line" data-tone={line.tone}>
      {shown}
      {typing ? <span className="lp-dev-hud-caret">▮</span> : null}
      {rest ? <span className="lp-dev-hud-ghost"> {rest}</span> : null}
    </p>
  );
}

/** A custom lens screen (what glasses_render draws): a headline over bars
 *  scaled to the largest value, with their labels. Every bar is laid out from
 *  the start and rises when revealed, so the screen never reflows. */
function HudChartView({ chart, bars }: { chart: HudChart; bars: number }) {
  const max = Math.max(...chart.bars.map((bar) => bar.value));
  return (
    <div className="lp-dev-hud-chart">
      <p className="lp-dev-hud-line">{chart.headline}</p>
      <div className="lp-dev-hud-bars">
        {chart.bars.map((bar, i) => (
          <span key={i} className="lp-dev-hud-bar">
            <i data-on={i < bars || undefined} style={{ "--h": bar.value / max } as CSSProperties} />
            <b>{bar.label}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Voice level bars. Still while idle; they bounce only while the user is
 *  "talking" (`.lp-dev-hud-voice[data-live]`, animated in CSS; still under
 *  reduced motion). */
function VoiceLevels() {
  return (
    <span className="lp-dev-hud-levels" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The 8-petal Dopl mark the G2 plugin draws on its Home title — same petal
 *  geometry as ~/Downloads/glasses-mcp/plugin/scripts/gen-dopl-mark.py (512px
 *  source, petals shrunk 0.88), as vectors so it takes the lens colour and the
 *  HUD's soft-focus + grain like everything else. */
const DOPL_PETALS = [
  "147,-121.3 231.5,-121.3 133,-22.7 48.5,-22.7",
  "121.3,-147 121.3,-231.5 22.7,-133 22.7,-48.5",
  "-147,-121.3 -231.5,-121.3 -133,-22.7 -48.5,-22.7",
  "-121.3,-147 -121.3,-231.5 -22.7,-133 -22.7,-48.5",
  "147,121.3 231.5,121.3 133,22.7 48.5,22.7",
  "121.3,147 121.3,231.5 22.7,133 22.7,48.5",
  "-147,121.3 -231.5,121.3 -133,22.7 -48.5,22.7",
  "-121.3,147 -121.3,231.5 -22.7,133 -22.7,48.5",
] as const;

function DoplMark() {
  return (
    <svg className="lp-dev-hud-mark" viewBox="-256 -256 512 512">
      {DOPL_PETALS.map((points) => (
        <polygon key={points} points={points} fill="currentColor" />
      ))}
    </svg>
  );
}
