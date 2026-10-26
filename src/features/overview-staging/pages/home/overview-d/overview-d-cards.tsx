// STAGING ONLY — Overview Version D, the supporting row: Spend, Devices, Channels. Three small
// cards under the hero, each one figure or one short list.
"use client";

import { formatDate } from "@/shared/lib/format-time";
import { formatTokens } from "@/shared/lib/format-tokens";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import {
  EMPTY_CHANNEL_USAGE,
  type HomeOverview,
  type HomeSeriesPoint,
} from "@/features/home/overview-types";
import { Bars, Card, Dot, Ghost, Meter } from "./overview-d-bits";
import type { DeviceLine } from "./overview-d-data";

/* ─────────────────────────────── spend ─────────────────────────────── */

export function SpendCard({
  credits,
  isPaid,
  points,
  tokens,
  onGetCredits,
}: {
  credits: WorkspaceCreditsStatus | null;
  isPaid: boolean;
  /** This month's daily credit bins, or null while the read is pending. */
  points: readonly HomeSeriesPoint[] | null;
  /** Tokens over the last 31 days, or null when nothing was spent / still loading. */
  tokens: number | null;
  onGetCredits: () => void;
}) {
  if (!credits || !points) return <Ghost height={244} />;
  // Current's rules (`CreditCapacityBar`): the limit falls back to the free allowance, and "out"
  // is the payload's verdict, never `used >= limit`.
  const limit = credits.limit > 0 ? credits.limit : PERSONAL_MONTHLY_CREDITS.free;
  const out = credits.remaining === 0 && credits.limit > 0;
  const left = Math.max(0, limit - credits.used);
  return (
    <Card
      title="Spend"
      end={
        !isPaid && (
          <button type="button" className="ovd-btn" data-variant="outline" onClick={onGetCredits}>
            Get more credits
          </button>
        )
      }
    >
      <p className="ovd-figure">
        <span className="ovd-figure-value">{credits.used.toLocaleString()}</span>
        <span className="ovd-figure-of">of {limit.toLocaleString()} credits</span>
      </p>
      <Meter value={credits.used / limit} needsYou={out} />
      <p className="ovd-caption">
        <span>{out ? "None left" : `${left.toLocaleString()} left`}</span>
        {credits.periodEnd && <span>Resets {formatDate(credits.periodEnd)}</span>}
      </p>
      <Bars values={points.map((p) => p.count)} />
      {tokens !== null && (
        // "At least": the token figure is a floor (token-spend-strip.tsx's honesty line).
        <p className="ovd-caption">
          <span>Tokens, 31 days</span>
          <span className="ovd-caption-value">At least {formatTokens(tokens)}</span>
        </p>
      )}
    </Card>
  );
}

/* ─────────────────────────────── devices ─────────────────────────────── */

const STATUS = {
  active: { tone: "live", word: "Online" },
  away: { tone: "idle", word: "Away" },
  offline: { tone: "off", word: "Offline" },
} as const;

/** What a device lets an agent do. ⚠ Staging literals, see devices-variant-cards.tsx › FUNCTIONS. */
const FUNCTIONS: Record<string, readonly string[]> = {
  glasses: ["display", "mic", "touch"],
  phone: ["notify", "ask"],
  watch: ["notify", "tap"],
  web: ["notify", "ask"],
};

export function DevicesCard({ lines, onAdd }: { lines: readonly DeviceLine[]; onAdd: () => void }) {
  return (
    <Card
      title="Devices"
      end={
        <button type="button" className="ovd-btn" data-variant="outline" onClick={onAdd}>
          Add device
        </button>
      }
    >
      <ul className="ovd-list">
        {lines.map((d) => {
          const s = STATUS[d.status];
          return (
            <li key={d.id} className="ovd-dev">
              <DeviceGlyph kind={d.kind} />
              <div className="ovd-dev-body">
                <p className="ovd-dev-name">
                  {d.name}
                  {d.inUse && <span className="ovd-dev-inuse">Answering</span>}
                </p>
                {d.inUse && FUNCTIONS[d.kind] ? (
                  <ul className="ovd-chips" aria-label={`${d.name} functions`}>
                    {FUNCTIONS[d.kind].map((fn) => (
                      <li key={fn} className="ovd-chip">
                        {fn}
                      </li>
                    ))}
                  </ul>
                ) : (
                  d.via && <p className="ovd-dev-via">Through {d.via}</p>
                )}
              </div>
              <Dot tone={s.tone}>{s.word}</Dot>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ─────────────────────────────── channels ─────────────────────────────── */

const TOP = 5;

export function ChannelsCard({ data }: { data: HomeOverview | undefined }) {
  if (!data) return <Ghost height={244} />;
  const rows = [...(data.channels ?? EMPTY_CHANNEL_USAGE)]
    .sort((a, b) => b.credits - a.credits)
    .slice(0, TOP);
  const top = Math.max(1, ...rows.map((r) => r.credits));
  return (
    <Card title="Top channels" end={<span className="ovd-muted">Credits</span>}>
      {rows.length === 0 ? (
        <p className="ovd-empty">Nothing yet.</p>
      ) : (
        <ul className="ovd-list">
          {rows.map((r) => (
            <li key={r.workspaceId} className="ovd-rank">
              <span className="ovd-rank-name">{r.name || "Untitled channel"}</span>
              <span className="ovd-rank-value">{r.credits.toLocaleString()}</span>
              <Meter value={r.credits / top} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
