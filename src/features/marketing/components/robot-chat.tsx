"use client";

import "@/features/marketing/robot-chat.css";

import { Bot, Check, type LucideIcon } from "lucide-react";
import { AgentPill } from "@/features/channels/components/agent-bits";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { Face, agentColor } from "@/features/onboarding/components/paired-avatar";
import {
  ROBOT_AGENT,
  ROBOT_AGENT_DEVICE,
  ROBOT_CONNECT_MS,
  ROBOT_CONNECTION,
  ROBOT_FEED,
  ROBOT_LOOP_FADE_MS,
  ROBOT_USER,
  ROBOT_USER_DEVICE,
  ROBOT_VIA,
  ROBOT_WORD_MS,
  type RobotBeat,
} from "./robot-chat-content";
import { DeviceConnect } from "./device-connect";
import { useFeedPlayer } from "./use-feed-player";

/** Robots card overlay: the agent's run as Dopl chat rows laid straight over
 *  the photo — no panel. User and agent rows carry their avatars (the agent's
 *  is the robot with its runtime inset, PairedAvatar's recipe); every robot
 *  action is a Dopl tool call, drawn like onboarding's "Connect your agent"
 *  transcript (onboarding/components/connect-agent-transcript.tsx › ToolRow):
 *  the Dopl mark tile + label, shimmering while it runs, then ✓.
 *  Clock, pausing, reduced motion and the slide-up: ./use-feed-player.
 *  Copy: ./robot-chat-content.ts. Styles: ../robot-chat.css. */

/** Ticks a beat reveals: agent words, or one for a tool finishing. */
const ticks = (beat: RobotBeat) =>
  beat.kind === "agent"
    ? beat.text.split(" ").length
    : beat.kind === "connect"
      ? ROBOT_CONNECTION.functions.length
      : beat.kind === "user"
        ? 0
        : 1;
const cadence = (beat: RobotBeat) =>
  beat.kind === "tool" ? beat.run : beat.kind === "connect" ? ROBOT_CONNECT_MS : ROBOT_WORD_MS;

/** Consecutive beats from one side share one avatar + name, like a chat. */
interface Group {
  readonly side: "user" | "agent";
  readonly beats: { readonly beat: RobotBeat; readonly index: number }[];
}
function groupBeats(beats: readonly RobotBeat[]): Group[] {
  const out: { side: "user" | "agent"; beats: { beat: RobotBeat; index: number }[] }[] = [];
  beats.forEach((beat, index) => {
    if (beat.kind === "connect") return; // drawn as the pill, not a feed row
    const side = beat.kind === "user" ? "user" : "agent";
    const last = out[out.length - 1];
    if (last?.side === side) last.beats.push({ beat, index });
    else out.push({ side, beats: [{ beat, index }] });
  });
  return out;
}

export function RobotChat() {
  const { rootRef, feedRef, count, words, fading } = useFeedPlayer({
    beats: ROBOT_FEED,
    ticks,
    cadence,
    fadeMs: ROBOT_LOOP_FADE_MS,
  });
  const groups = groupBeats(ROBOT_FEED.slice(0, count));
  // The connect beat is beat 1: its chips tick in while it plays, then stay.
  const chips = count > 1 ? Number.POSITIVE_INFINITY : words;

  return (
    <div className="lp-dev-chat-anchor" ref={rootRef} aria-hidden="true">
      <DeviceConnect connection={ROBOT_CONNECTION} shown={chips} place="top" />
      <div className="lp-dev-chat-viewport">
        <div className="lp-dev-chat-feed" ref={feedRef} data-fading={fading || undefined}>
          {groups.map((group) => (
            <div key={`${group.side}-${group.beats[0].index}`} className="lp-dev-chat-group">
              {group.side === "user" ? <UserAvatar /> : <IdentityAvatar />}
              <div className="lp-dev-chat-body">
                <p className="lp-dev-chat-name">
                  {group.side === "user" ? ROBOT_USER.name : ROBOT_AGENT.name}
                </p>
                {group.beats.map(({ beat, index }) => (
                  <Beat key={beat.id} beat={beat} ticks={index === count - 1 ? words : Number.POSITIVE_INFINITY} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Beat({ beat, ticks: done }: { beat: RobotBeat; ticks: number }) {
  switch (beat.kind) {
    case "connect":
      return null;
    case "user":
      return (
        <div className="lp-dev-chat-item lp-dev-chat-said">
          <p className="lp-dev-chat-text">{beat.text}</p>
          <DevicePillFace label={ROBOT_USER_DEVICE.label} kind={ROBOT_USER_DEVICE.kind} />
        </div>
      );
    case "tool":
      return <ToolRow call={beat.call} running={done < 1} />;
    case "agent": {
      const all = beat.text.split(" ");
      // Untyped words stay in the flow, invisible, so the line never reflows;
      // the pill is there from the first frame, so nothing shifts under it.
      return (
        <div className="lp-dev-chat-item lp-dev-chat-said">
          <p className="lp-dev-chat-text">
            {all.slice(0, done).join(" ")}
            {done < all.length ? <span className="lp-dev-chat-ghost"> {all.slice(done).join(" ")}</span> : null}
          </p>
          <DevicePillFace label={ROBOT_AGENT_DEVICE.label} icon={AGENT_DEVICE_ICON} />
        </div>
      );
    }
  }
}

/** The Unitree G1's glyph: DeviceKind has no humanoid kind, so the landing
 *  passes one here rather than touching the shared device glyphs. */
const AGENT_DEVICE_ICON: LucideIcon = Bot;

/** The channels device pill — "which device a message came from" — composed
 *  exactly as `channels/components/device-pill.tsx › DevicePill` does
 *  (`AgentPill`'s black face + `DeviceKindIcon`), by import. Not DevicePill
 *  itself: its live-name lookup (`useDeviceName`) needs a react-query client
 *  the landing does not mount here, and there is no device id to look up.
 *  `icon` stands in for `kind` when DeviceKind has no fitting glyph. */
function DevicePillFace({ label, kind, icon: Icon }: { label: string; kind?: string; icon?: LucideIcon }) {
  return (
    <AgentPill className="lp-dev-chat-pill inline-flex w-fit max-w-[16rem] items-center gap-1">
      {Icon ? (
        <Icon size={11} strokeWidth={2} aria-hidden className="shrink-0" />
      ) : (
        <DeviceKindIcon kind={kind ?? ""} size={11} strokeWidth={2} className="shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </AgentPill>
  );
}

/** One Dopl tool call: the Dopl mark tile, "Dopl", the call; shimmer while
 *  running, ✓ when done. */
function ToolRow({ call, running }: { call: string; running: boolean }) {
  return (
    <div className="lp-dev-chat-item lp-dev-chat-tool" data-running={running || undefined}>
      <span className="lp-dev-chat-mark">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative mark */}
        <img src={ROBOT_VIA.mark} alt="" draggable={false} />
      </span>
      <span className="lp-dev-chat-tool-label">{ROBOT_VIA.name}</span>
      <code className="lp-dev-chat-call">{call}</code>
      {!running ? <Check className="lp-dev-chat-check" strokeWidth={2.4} /> : null}
    </div>
  );
}

function UserAvatar() {
  return (
    <span className="lp-dev-chat-avatar">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative avatar */}
      <img src={ROBOT_USER.photo} alt="" draggable={false} className="lp-dev-chat-photo" />
    </span>
  );
}

/** The identity's avatar: PairedAvatar's recipe
 *  (onboarding/components/paired-avatar.tsx), built from its own `Face` /
 *  `agentColor` as the Multiplayer cards do — the user's photo in a 2px agent
 *  colour ring, the runtime inset bottom-right. Not the component itself
 *  because it sizes in px and this card sizes in `cqw` (CSS); the badge rides
 *  the same 0.5 / 0.3 ratios. */
function IdentityAvatar() {
  const ring = agentColor(ROBOT_AGENT.color);
  return (
    <span className="lp-dev-chat-avatar lp-dev-chat-identity" style={{ borderColor: ring }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative avatar */}
      <img src={ROBOT_USER.photo} alt="" draggable={false} className="lp-dev-chat-photo" />
      <span className="lp-dev-chat-badge">
        <Face d={0} round ring={ring} style={{ width: "100%", height: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative mark */}
          <img src={ROBOT_AGENT.runtimeLogo} alt="" draggable={false} className="lp-dev-chat-badge-logo" />
        </Face>
      </span>
    </span>
  );
}
