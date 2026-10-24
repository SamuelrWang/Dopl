"use client";

import { Bot, Pause } from "lucide-react";
import { Face, Img, PairedAvatar, agentColor } from "@/features/onboarding/components/paired-avatar";
import { LOG_COPY, LOG_ROWS, type LogIdentity, type LogRow } from "./control-content";
import { AGENT } from "./multiplayer-content";
import { AgentFace, Sequence, at } from "./ontology-bits";
import { ROBOT_AGENT } from "./robot-chat-content";
import { useVisualPlay } from "./use-visual-play";

/**
 * Monitoring's activity log: what each identity did, where, and under which
 * permission, landing one row at a time, NEWEST ON TOP (each row grows in at
 * the top and pushes the older ones down). Plays once when 60% in view and
 * HOLDS on the final frame; leaving the viewport re-arms it, so scrolling
 * back replays it (./use-visual-play.ts).
 *
 * Motion is the Orchestration windows' PLAY CONTRACT (ontology-bits.tsx,
 * marketing.css › "Play contract"): `data-play` on the card, `--d` per
 * element, and the BASE rules are the final frame, so SSR, no JS and reduced
 * motion render the finished log, static. Copy: ./control-content.ts.
 */

const FACE = 30;
const PAUSED_AT = LOG_ROWS.find((row) => row.permission.kind === "paused")?.at ?? 0;
const CHIPS = Object.keys(LOG_COPY.names) as LogIdentity[];

export function ActivityLog() {
  const ref = useVisualPlay<HTMLDivElement>();
  return (
    <div className="lp-ctl-card lp-ctl-log" ref={ref}>
      <div className="lp-ctl-log-head">
        <span className="lp-ctl-log-title">{LOG_COPY.title}</span>
        <span className="lp-ctl-log-live">
          <i />
          {LOG_COPY.live}
        </span>
      </div>

      <div className="lp-ctl-log-chips">
        <span className="lp-ctl-log-chip" data-on>
          {LOG_COPY.all}
        </span>
        {CHIPS.map((who) =>
          who === LOG_COPY.pausedWho ? (
            <span key={who} className="lp-ctl-log-chip lp-ctl-log-chip--paused" style={at(PAUSED_AT)}>
              <Pause size={11} strokeWidth={2.4} />
              {LOG_COPY.names[who]}
            </span>
          ) : (
            <span key={who} className="lp-ctl-log-chip">
              {LOG_COPY.names[who]}
            </span>
          ),
        )}
      </div>

      <ul className="lp-ctl-log-list">
        {[...LOG_ROWS].reverse().map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function Row({ row }: { row: LogRow }) {
  return (
    <li className="lp-ont-grow" style={at(row.at)}>
      <div>
        <div className="lp-ctl-log-row">
          <IdentityFace who={row.who} />
          <div className="lp-ctl-log-body">
            <p className="lp-ctl-log-name">
              {LOG_COPY.names[row.who]}
              <span className="lp-ctl-log-time">{row.time}</span>
            </p>
            <p className="lp-ctl-log-did">
              {row.did}
              {row.where ? <span className="lp-ctl-log-where"> · {row.where}</span> : null}
            </p>
          </div>
          <PermissionPill row={row} />
        </div>
      </div>
    </li>
  );
}

function PermissionPill({ row }: { row: LogRow }) {
  const { permission: p } = row;
  if (p.kind === "approval") {
    return (
      <Sequence
        className="lp-ont-stack lp-ont-stack--end"
        steps={
          [
            ["waiting", row.at],
            ["approved", p.approvedAt],
          ] as const
        }
        render={(state) => (
          <span className="lp-ctl-log-pill" data-tone={state}>
            {LOG_COPY.permission[state]}
          </span>
        )}
      />
    );
  }
  return (
    <span className="lp-ctl-log-pill" data-tone={p.kind}>
      {p.kind === "paused" ? <Pause size={10} strokeWidth={2.6} aria-hidden /> : null}
      {LOG_COPY.permission[p.kind]}
    </span>
  );
}

function IdentityFace({ who }: { who: LogIdentity }) {
  switch (who) {
    case "admin":
      return <PairedAvatar d={FACE} photo={AGENT.photo} agentLogo={AGENT.runtimeLogo} color={AGENT.color} thinFrame />;
    case "robot":
      return <RobotFace />;
    default:
      return <AgentFace id={who} d={FACE} thinFrame />;
  }
}

/** PairedAvatar's recipe with the robot glyph for the photo, as the Robots
 *  card draws G1 (robot-chat.tsx › RobotAvatar): ringed circle, runtime mark
 *  inset bottom-right at half the diameter, overlapping by 0.3 of itself. */
function RobotFace() {
  const ring = agentColor(ROBOT_AGENT.color);
  const b = FACE * 0.5;
  return (
    <span className="lp-ctl-log-robot" style={{ width: FACE, height: FACE, borderColor: ring }}>
      <Bot size={FACE * 0.55} strokeWidth={1.8} />
      <Face d={b} round ring={ring} style={{ position: "absolute", width: b, height: b, right: -b * 0.3, bottom: -b * 0.3 }}>
        <Img src={ROBOT_AGENT.runtimeLogo} px={b * 0.58} />
      </Face>
    </span>
  );
}
