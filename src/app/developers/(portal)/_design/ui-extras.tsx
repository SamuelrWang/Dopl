"use client";

/** Single-purpose parts: a code to read, a date range, a plan, a notice. */
import { Calendar, Check, ChevronLeft, ChevronRight, X, type LucideIcon } from "lucide-react";
import { createElement, useState, type ReactNode } from "react";
import b from "./base.module.css";
import { cx, ICON, ICON_SM } from "./components";
import d from "./data.module.css";
import x from "./extras.module.css";
import o from "./surfaces.module.css";
import { Badge, Button, Chip, PopMenu } from "./ui";
import { Text } from "./ui-page";

/** A short code, one box per character, read off one screen and typed on another. */
export function CodeCells({ value }: { value: string }) {
  return (
    <div className={x.cells} role="img" aria-label={`Code ${value}`}>
      {[...value].map((ch, i) => (
        <span key={i} className={x.cell}>
          {ch}
        </span>
      ))}
    </div>
  );
}

interface DateSpan {
  from: string;
  to: string;
}
const DAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const iso = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
const spanLabel = (s: DateSpan) => {
  const fmt = (v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return s.from === s.to ? fmt(s.from) : `${fmt(s.from)} to ${fmt(s.to)}`;
};

/** A pill that opens a month: press a start, press an end, apply. `month` is where it opens. */
export function DateRange({ label, value, month, onChange }: { label: string; value: DateSpan | null; month: string; onChange: (span: DateSpan | null) => void }) {
  const [view, setView] = useState(() => {
    const [y, m] = month.split("-").map(Number);
    return { y, m: m - 1 };
  });
  const [draft, setDraft] = useState<{ from: string | null; to: string | null }>({ from: value?.from ?? null, to: value?.to ?? null });
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const shift = (by: number) => setView((v) => {
    const next = new Date(Date.UTC(v.y, v.m + by, 1));
    return { y: next.getUTCFullYear(), m: next.getUTCMonth() };
  });
  const press = (day: string) => setDraft((r) => (!r.from || r.to ? { from: day, to: null } : day < r.from ? { from: day, to: r.from } : { from: r.from, to: day }));
  const name = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const done = draft.from ? { from: draft.from, to: draft.to ?? draft.from } : null;
  return (
    <PopMenu
      right
      tall
      label={label}
      trigger={(open, toggle) => (
        <Chip on={Boolean(value)} expanded={open} haspopup="menu" onClick={toggle}>
          <Calendar {...ICON_SM} aria-hidden="true" />
          {value ? spanLabel(value) : label}
        </Chip>
      )}
    >
      {(close) => (
        <div className={x.calendar}>
          <div className={b.between}>
            <Button label="Previous month" size="sm" square onClick={() => shift(-1)}>
              <ChevronLeft {...ICON} />
            </Button>
            <Text kind="h3">{name}</Text>
            <Button label="Next month" size="sm" square onClick={() => shift(1)}>
              <ChevronRight {...ICON} />
            </Button>
          </div>
          <div className={o.calendar}>
            {DAY_NAMES.map((n) => (
              <span key={n} className={o.dayName}>
                {n}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`l${i}`} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const day = iso(view.y, view.m, i + 1);
              const end = day === draft.from || day === draft.to;
              const between = draft.from && draft.to && day > draft.from && day < draft.to;
              return (
                <button key={day} type="button" aria-pressed={end} className={cx(o.day, x.dayBtn, Boolean(between) && o.dayRange, end && o.dayEnd)} onClick={() => press(day)}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className={b.between}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft({ from: null, to: null });
                onChange(null);
                close();
              }}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="ink"
              disabled={!done}
              onClick={() => {
                onChange(done);
                close();
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </PopMenu>
  );
}

/** A plan to pick. */
export function PlanCard({ name, price, per, features, badge, selected, onClick }: { name: string; price: string; per: string; features: string[]; badge?: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} className={cx(x.plan, selected && x.planOn)} onClick={onClick}>
      <span className={b.between}>
        <Text kind="h3">{name}</Text>
        {badge && <Badge tone="ink">{badge}</Badge>}
      </span>
      <span className={d.price}>
        <span className={b.big}>{price}</span>
        <Text kind="muted">{per}</Text>
      </span>
      <span className={b.line} />
      <span className={b.stack}>
        {features.map((feature) => (
          <span key={feature} className={d.featureRow}>
            <Check {...ICON} className={b.iconInk} aria-hidden="true" />
            {feature}
          </span>
        ))}
      </span>
    </button>
  );
}

/** A black strip across the page: one notice, one action, dismissable. */
export function Banner({ icon, action, onAction, onClose, children }: { icon: LucideIcon; action?: string; onAction?: () => void; onClose?: () => void; children: ReactNode }) {
  return (
    <div className={o.banner}>
      {createElement(icon, { ...ICON, "aria-hidden": true })}
      <span className={b.grow}>{children}</span>
      {action && (
        <button type="button" className={cx(b.reset, o.bannerBtn)} onClick={onAction}>
          {action}
        </button>
      )}
      {onClose && (
        <button type="button" className={b.reset} aria-label="Dismiss" onClick={onClose}>
          <X {...ICON} />
        </button>
      )}
    </div>
  );
}

/** Three figures side by side under a hairline-split row. */
export function StatTriple({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className={d.statTriple}>
      {items.map(([label, value]) => (
        <div key={label} className={d.statCell}>
          <span className={cx(b.h3, b.num)}>{value}</span>
          <span className={b.smallMuted}>{label}</span>
        </div>
      ))}
    </div>
  );
}
