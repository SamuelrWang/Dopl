// STAGING ONLY. Overview card, meter, bars, status dot and marks.
"use client";

import type { ReactNode } from "react";
import { SECTION_TITLE } from "@/shared/ui/section-title";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import type { MockStatus } from "@/features/overview-staging/overview-mock-data";
import { RUNTIME_LOGO } from "./overview-data";

/** One white card with a plain title row; `aside` sits at the title row's right end. */
export function ECard({
  title,
  count,
  aside,
  children,
  className,
}: {
  title: string;
  count?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`white-card ove-card ${className ?? ""}`} aria-label={title}>
      <header className="ove-card-head">
        <h3 className={SECTION_TITLE}>{title}</h3>
        {count !== undefined && <span className="ove-card-count">{count}</span>}
        {aside && <span className="ove-card-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/** A 3px meter; `tone="over"` when the period is spent. */
export function EMeter({ value, max, tone }: { value: number; max: number; tone?: "over" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="ove-meter" data-tone={tone} aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

/** A bar strip, tallest bar = full height. */
export function EBars({ values, label, dim }: { values: readonly number[]; label: string; dim?: boolean }) {
  const peak = Math.max(1, ...values);
  return (
    <span className="ove-bars" role="img" aria-label={label} data-dim={dim ? "true" : undefined}>
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(v > 0 ? 6 : 2, (v / peak) * 100)}%` }} data-zero={v === 0 ? "true" : undefined} />
      ))}
    </span>
  );
}

const STATUS_WORD: Record<MockStatus, string> = { active: "Online", away: "Away", offline: "Offline" };

/** Dot + word: green only for live. */
export function EStatus({ status, suffix }: { status: MockStatus; suffix?: string }) {
  return (
    <span className="ove-status" data-status={status}>
      <i aria-hidden="true" />
      {STATUS_WORD[status]}
      {suffix && <span className="ove-muted"> {suffix}</span>}
    </span>
  );
}

/** The runtime's own logo on a round white face; its name when there is no logo. */
export function ERuntime({ runtime }: { runtime: string }) {
  const logo = RUNTIME_LOGO[runtime];
  return (
    <span className="ove-runtime" title={runtime}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- staging, static /public logo
        <img src={logo} alt={runtime} />
      ) : (
        <span className="ove-runtime-word">{runtime}</span>
      )}
    </span>
  );
}

/** A device's mark: the shared device glyph on a small hairline tile. */
export function EDeviceMark({ kind }: { kind: string }) {
  return (
    <span className="ove-device-mark" aria-hidden="true">
      <DeviceKindIcon kind={kind} size={13} strokeWidth={1.8} />
    </span>
  );
}

/** Icon + one phrase, inside the card (an empty card is still a card). */
export function EEmpty({ children }: { children: ReactNode }) {
  return <p className="ove-empty">{children}</p>;
}
