// STAGING ONLY — Overview Version D. The few faces every card shares.
"use client";

import type { ReactNode } from "react";
import { PairedAvatar } from "@/features/onboarding/components/paired-avatar";
import { STAGING_VIEWER } from "@/features/ui-staging/staging-stubs";
import { runtimeLogo } from "../devices-mock/devices-ui";

/** The scene's ONE accent: the agent colour slot every identity ring wears. */
export const ACCENT = 11;

/** A supporting card: title row (title, trailing slot), then content. */
export function Card({
  title,
  end,
  className,
  children,
}: {
  title: string;
  end?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`ovd-card${className ? ` ${className}` : ""}`} aria-label={title}>
      <header className="ovd-card-head">
        <h3 className="ovd-card-title">{title}</h3>
        {end && <div className="ovd-card-end">{end}</div>}
      </header>
      {children}
    </section>
  );
}

/** A card-shaped loading block. */
export function Ghost({ height }: { height: number }) {
  return <div className="ovd-ghost" style={{ height }} aria-hidden />;
}

/** The 3px meter. `value` is 0–1. */
export function Meter({ value, needsYou }: { value: number; needsYou?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="ovd-meter" data-tone={needsYou ? "needs-you" : undefined} aria-hidden>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The Monitoring log's tinted pill: green for live work, amber for "needs you", plain else. */
export function Pill({
  tone,
  children,
}: {
  tone?: "live" | "needs-you";
  children: ReactNode;
}) {
  return (
    <span className="ovd-pill" data-tone={tone}>
      {children}
    </span>
  );
}

/** Dot + word, no box: a device's or a feed's state. */
export function Dot({ tone, children }: { tone: "live" | "idle" | "off"; children: ReactNode }) {
  return (
    <span className="ovd-dot-word">
      <i data-tone={tone} aria-hidden />
      {children}
    </span>
  );
}

/** An agent's identity face: the owner (the viewer, PORTING.md §4d) + its runtime badge. */
export function AgentFace({ runtime, d }: { runtime: string; d: number }) {
  return (
    <PairedAvatar
      d={d}
      thinFrame
      photo={STAGING_VIEWER.avatarUrl ?? undefined}
      agentLogo={runtimeLogo(runtime)}
      color={ACCENT}
    />
  );
}

/** Plain columns over one hairline baseline. A measured zero still draws a stub. */
export function Bars({ values }: { values: readonly number[] }) {
  const peak = Math.max(1, ...values);
  return (
    <div className="ovd-bars" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className="ovd-bar"
          data-zero={v === 0 || undefined}
          style={{ height: `${v === 0 ? 3 : Math.max(8, (v / peak) * 100)}%` }}
        />
      ))}
    </div>
  );
}
