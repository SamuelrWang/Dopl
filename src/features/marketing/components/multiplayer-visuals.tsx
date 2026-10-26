"use client";

import type { CSSProperties, ReactNode } from "react";
import { CalendarDays, Check, CornerUpLeft, Mic } from "lucide-react";
import { Face, Img, agentColor } from "@/features/onboarding/components/paired-avatar";
import { IDENTITY_RING_PX } from "@/shared/ui/identity-face";
import { AGENT, DOPL_MARK, MULTIPLAYER_COPY } from "./multiplayer-content";
import { GmailMark, NotionMark } from "./ontology-marks";
import { useVisualPlay } from "./use-visual-play";

/**
 * Animated mini UIs for the Multiplayer cards: create Alex's Admin Assistant →
 * set its rules → (./multiplayer-thread.tsx) it on iMessage. Decorative, so
 * every root is `aria-hidden` — the card text is the accessible content.
 *
 * Motion is CSS only (marketing.css › "Multiplayer visuals"). Each animated
 * element carries its start time as `--d`; ./use-visual-play.ts flips the root
 * to `data-play="in"` when the card is on screen and the sequence plays once,
 * then holds. The base rules are the FINAL frame (SSR / reduced motion).
 */

/** Start time (and optional window length) of one animated element. */
export const at = (ms: number, windowMs?: number) =>
  ({ "--d": `${ms}ms`, ...(windowMs ? { "--w": `${windowMs}ms` } : {}) }) as CSSProperties;

/** Card 1 timeline, ms from play. */
const T1 = {
  name: 300,
  nameStep: 120,
  avatar: 800,
  role: 950,
  badge: 1350,
  pill: 1650,
  voice: 2000,
  tools: 2500,
  toggles: [2850, 3200, 3550],
  knowledge: 3950,
  knowledgeStep: 220,
} as const;

/** Card 2 timeline, ms from play. */
const T2 = { head: 0, rule: 400, step: 420, check: 280, gap: 300 } as const;

/** One avatar size for cards 1 and 2. */
const AVATAR_D = 38;

const WAVE = [5, 9, 13, 8, 15, 11, 6, 12, 16, 10, 7, 13, 9, 5];

// ── The identity's avatar ───────────────────────────────────────────────

/**
 * Mirrors `onboarding/components/paired-avatar.tsx › PairedAvatar` — same ring,
 * proportions and inset runtime badge (half the diameter, hanging 0.3·b past the
 * bottom-right), built from its own `Face` / `Img` / `agentColor`. Not the
 * component itself only because the badge needs its own entrance hook.
 *
 * ⚠ The entrance is a FADE, never a scale: a scale animation promotes the avatar
 * to its own compositor layer and the photo came out soft (Samuel 2026-10-16).
 */
export function AlexAvatar({ d, popAt, badgeAt }: { d: number; popAt?: number; badgeAt?: number }) {
  const ring = agentColor(AGENT.color);
  const b = d * 0.5;
  return (
    <span
      className={popAt === undefined ? "lp-mp-avatar" : "lp-mp-avatar lp-mp-fade"}
      style={{ width: d, height: d, ...(popAt === undefined ? {} : at(popAt)) }}
    >
      {/* The identity avatar ratio (shared/ui/identity-face.tsx › IDENTITY_RING_PX):
          2px colour ring (CSS) → 2px white → photo, no hairline. */}
      <span className="lp-mp-avatar-ring" style={{ borderColor: ring }}>
        <span className="lp-mp-avatar-face" style={{ padding: IDENTITY_RING_PX, borderWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny decorative avatar */}
          <img src={AGENT.photo} alt="" draggable={false} className="lp-mp-avatar-img" />
        </span>
      </span>
      <span
        className={badgeAt === undefined ? "lp-mp-badge" : "lp-mp-badge lp-mp-fade"}
        style={{ width: b, height: b, right: -b * 0.3, bottom: -b * 0.3, ...(badgeAt === undefined ? {} : at(badgeAt)) }}
      >
        <Face d={b} round ring={ring} style={{ width: "100%", height: "100%" }}>
          <Img src={AGENT.runtimeLogo} px={b * 0.58} />
        </Face>
      </span>
    </span>
  );
}

function Typed({ text, start, step }: { text: string; start: number; step: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="lp-mp-type" style={at(start + i * step)}>
          {ch}
        </span>
      ))}
    </>
  );
}

function Window({ children }: { children: ReactNode }) {
  const ref = useVisualPlay<HTMLDivElement>();
  return (
    <div className="lp-mp-panel" aria-hidden="true" ref={ref}>
      <div className="lp-mp-chrome">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-mp-panel-body">{children}</div>
    </div>
  );
}

// ── Card 1: create the identity ─────────────────────────────────────────

const TOOL_MARKS = [
  <span key="cal" className="lp-mp-glyph">
    <CalendarDays size={11} strokeWidth={2} />
  </span>,
  // eslint-disable-next-line @next/next/no-img-element -- local onboarding asset
  <img key="sheets" src="/img/onboarding/sheets-logo.svg" alt="" />,
  <GmailMark key="gmail" />,
];

const KNOWLEDGE_MARK = {
  // eslint-disable-next-line @next/next/no-img-element -- local onboarding asset
  dopl: <img src={DOPL_MARK} alt="" className="lp-mp-mark-tile" />,
  notion: <NotionMark />,
} as const;

export function IdentityVisual() {
  const c = MULTIPLAYER_COPY.identity;
  const nameEnd = T1.name + (AGENT.name.length - 1) * T1.nameStep;
  return (
    <Window>
      <div className="lp-mp-id-head">
        <AlexAvatar d={AVATAR_D} popAt={T1.avatar} badgeAt={T1.badge} />
        <span className="lp-mp-id-text">
          <span className="lp-mp-id-name">
            <Typed text={AGENT.name} start={T1.name} step={T1.nameStep} />
            <span className="lp-mp-caret" style={at(0, nameEnd + 300)} />
          </span>
          <span className="lp-mp-id-role lp-mp-rise" style={at(T1.role)}>
            {AGENT.role}
          </span>
        </span>
        <span className="lp-mp-pill lp-mp-pop" style={at(T1.pill)}>
          {AGENT.audience}
        </span>
      </div>

      <div className="lp-mp-field lp-mp-rise" style={at(T1.voice)}>
        <span className="lp-mp-label">{c.voiceLabel}</span>
        <span className="lp-mp-chip">
          <Mic size={11} strokeWidth={2} />
          {c.voiceFile}
          <span className="lp-mp-wave">
            {WAVE.map((h, i) => (
              <i key={i} style={{ height: h, ...at(T1.voice + 150 + i * 35) }} />
            ))}
          </span>
        </span>
      </div>

      <div className="lp-mp-field lp-mp-rise" style={at(T1.tools)}>
        <span className="lp-mp-label">{c.toolsLabel}</span>
        <span className="lp-mp-rows">
          {c.tools.map((tool, i) => (
            <span key={tool} className="lp-mp-row">
              <span className="lp-mp-mark">{TOOL_MARKS[i]}</span>
              {tool}
              <span className="lp-mp-toggle" style={at(T1.toggles[i])}>
                <i />
              </span>
            </span>
          ))}
        </span>
      </div>

      <div className="lp-mp-field">
        <span className="lp-mp-label lp-mp-rise" style={at(T1.knowledge)}>
          {c.knowledgeLabel}
        </span>
        <span className="lp-mp-rows">
          {c.knowledge.map((kb, i) => (
            <span key={kb.name} className="lp-mp-row lp-mp-rise" style={at(T1.knowledge + i * T1.knowledgeStep)}>
              <span className="lp-mp-mark">{KNOWLEDGE_MARK[kb.source]}</span>
              {kb.name}
            </span>
          ))}
        </span>
      </div>
    </Window>
  );
}

// ── Card 2: set the rules ───────────────────────────────────────────────

function RuleGroup({ label, items, start, icon }: { label: string; items: readonly string[]; start: number; icon: ReactNode }) {
  return (
    <div className="lp-mp-field lp-mp-field--stack">
      <span className="lp-mp-label lp-mp-rise" style={at(start - 150)}>
        {label}
      </span>
      {items.map((item, i) => {
        const t = start + i * T2.step;
        return (
          <span key={item} className="lp-mp-row lp-mp-rule lp-mp-rise" style={at(t)}>
            <span className="lp-mp-check" style={at(t + T2.check)}>
              {icon}
            </span>
            {item}
          </span>
        );
      })}
    </div>
  );
}

export function RulesVisual() {
  const c = MULTIPLAYER_COPY.rules;
  const escalateAt = T2.rule + c.rules.length * T2.step + T2.gap;
  return (
    <Window>
      <div className="lp-mp-id-head lp-mp-rise" style={at(T2.head)}>
        <AlexAvatar d={AVATAR_D} />
        <span className="lp-mp-id-text">
          <span className="lp-mp-id-name">{AGENT.name}</span>
          <span className="lp-mp-id-role">{AGENT.role}</span>
        </span>
      </div>
      <RuleGroup label={c.rulesLabel} items={c.rules} start={T2.rule} icon={<Check size={10} strokeWidth={3} />} />
      <RuleGroup
        label={c.escalateLabel}
        items={c.escalate}
        start={escalateAt}
        icon={<CornerUpLeft size={10} strokeWidth={2.5} />}
      />
    </Window>
  );
}
