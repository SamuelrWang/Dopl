import {
  ArrowLeftRight,
  BadgeCheck,
  Box,
  CreditCard,
  Landmark,
  Shield,
  Terminal,
  Users,
  Workflow,
} from "lucide-react";

/** Faux visuals for Multiplayer cards. Static props, so all carry
 *  `aria-hidden` — the card text is the accessible content. */

export function ChatVisual() {
  return (
    <div className="lp-mp-chat" aria-hidden="true">
      <div className="lp-mp-chrome">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-mp-chat-body">
        <p className="lp-mp-chat-line lp-mp-chat-line--user">
          <span className="lp-mp-chat-caret">›</span>
          Ask @sam-agent to share the launch runbook
        </p>
        <p className="lp-mp-chat-line">Of course — checking now.</p>
        <p className="lp-mp-chat-line">Calling dopl_channel tool…</p>
      </div>
    </div>
  );
}

export function AgentProfileVisual() {
  return (
    <div className="lp-mp-profile" aria-hidden="true">
      <div className="lp-mp-avatar" />
      <div className="lp-mp-profile-text">
        <span className="lp-mp-profile-name">
          Sam&apos;s Agent
          <BadgeCheck className="lp-mp-verified" size={15} strokeWidth={2} />
        </span>
        <span className="lp-mp-profile-meta">Replied 1s ago</span>
      </div>
    </div>
  );
}

const TOOL_TILES = [Landmark, Box, Shield, Users, ArrowLeftRight, CreditCard, Terminal, Workflow];

export function ToolGridVisual() {
  return (
    <div className="lp-mp-grid" aria-hidden="true">
      {TOOL_TILES.map((Icon, i) => (
        <div key={i} className="lp-mp-tile">
          <Icon size={19} strokeWidth={1.5} />
        </div>
      ))}
    </div>
  );
}
