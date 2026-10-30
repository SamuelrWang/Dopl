"use client";

/**
 * The design system's components. Pages and the Design Playground both render these, so a page cannot
 * drift from what the Playground shows. Variants are props; none takes a className. See README.md.
 */
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2, Search, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { createElement, type ReactNode, type Ref } from "react";
import b from "./base.module.css";
import { cx, ICON, ICON_SM } from "./components";
import d from "./data.module.css";
import f from "./forms.module.css";
import side from "./sidebar.module.css";
import o from "./surfaces.module.css";

export { PillMenu, PopMenu, Segmented, Switch, type PillOption } from "./interactive";
export { Initials, cx, initialsOf, ICON, ICON_SM } from "./components";

/* Buttons */
/** `ink` and `dangerFlat` are the flat page actions; `primary` and `danger` carry the raised ring. */
export type ButtonVariant = "primary" | "ink" | "secondary" | "ghost" | "danger" | "dangerFlat" | "dangerOutline";
const BUTTON: Record<ButtonVariant, string | undefined> = { primary: b.primary, ink: b.ink, secondary: undefined, ghost: b.ghost, danger: b.danger, dangerFlat: b.dangerFlat, dangerOutline: b.dangerOutline };

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** Icon-only and square; pass the icon as children and name it with `label`. */
  square?: boolean;
  /** Shares a row's width. `block` takes the whole line instead. Footers and tiles only. */
  full?: boolean;
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** Draws as a button inside something already clickable, such as a card link. */
  inert?: boolean;
  href?: string;
  label?: string;
  title?: string;
  pressed?: boolean;
  expanded?: boolean;
  haspopup?: "menu" | "dialog";
  buttonRef?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  children: ReactNode;
}

export function Button({ variant = "secondary", size = "md", square, full, block, loading, disabled, inert, href, label, title, pressed, expanded, haspopup, buttonRef, onClick, children }: ButtonProps) {
  const className = cx(b.btn, !disabled && BUTTON[variant], disabled && b.off, size === "sm" && b.sm, size === "lg" && b.lg, square && b.square, (full || block) && b.full, block && b.noGrow);
  const body = (
    <>
      {loading && <Loader2 {...ICON} className={b.spinner} />}
      {children}
    </>
  );
  if (inert) return <span className={className}>{body}</span>;
  if (href) {
    return (
      <Link href={href} className={className} aria-label={label} title={title}>
        {body}
      </Link>
    );
  }
  return (
    <button ref={buttonRef} type="button" className={className} aria-label={label} aria-pressed={pressed} aria-expanded={expanded} aria-haspopup={haspopup} title={title} disabled={disabled} onClick={onClick}>
      {body}
    </button>
  );
}

/** One black button with a menu half, as in the reference. */
export function SplitButton({ onClick, onMore, moreLabel, children, more }: { onClick?: () => void; onMore?: () => void; moreLabel: string; children: ReactNode; more: ReactNode }) {
  return (
    <span className={b.split}>
      <button type="button" className={cx(b.reset, b.splitMain)} onClick={onClick}>
        {children}
      </button>
      <span className={b.splitDivider} />
      <button type="button" aria-label={moreLabel} className={cx(b.reset, b.splitMore)} onClick={onMore}>
        {more}
      </button>
    </span>
  );
}

/* Badges and chips */
export type Tone = "neutral" | "ink" | "ring" | "ok" | "warn" | "error";
const BADGE: Record<Tone, string | undefined> = { neutral: undefined, ink: b.badgeInk, ring: b.badgeRing, ok: b.badgeOk, warn: b.badgeWarn, error: b.badgeError };

export function Badge({ tone = "neutral", dot, title, children }: { tone?: Tone; dot?: boolean; title?: string; children: ReactNode }) {
  return (
    <span className={cx(b.badge, BADGE[tone])} title={title}>
      {dot && <span className={b.dot} />}
      {children}
    </span>
  );
}

/** A dot in a state colour, for use inside a Badge or row. */
export function StateDot({ tone }: { tone: "ok" | "warn" | "error" | "off" }) {
  return <span className={cx(b.dot, { ok: b.dotOk, warn: b.dotWarn, error: b.dotError, off: b.dotOff }[tone])} />;
}

/** `pill` hugs and may toggle; `tag` is a removable value in a field or filter row. */
export function Chip({ kind = "pill", on, ring, count, pressed, expanded, haspopup, label, onClick, onRemove, removeLabel, children }: { kind?: "pill" | "tag"; on?: boolean; ring?: boolean; count?: number; pressed?: boolean; expanded?: boolean; haspopup?: "menu"; label?: string; onClick?: () => void; onRemove?: () => void; removeLabel?: string; children: ReactNode }) {
  const className = kind === "tag" ? f.tag : cx(b.pill, on && b.pillOn, ring && b.pillRing, onClick && b.pillBtn);
  const body = (
    <>
      {children}
      {count !== undefined && count > 0 && <span className={cx(b.pillCount, on && b.pillCountOn)}>{count}</span>}
      {onRemove && (
        <button type="button" className={b.reset} aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
          <X {...ICON_SM} className={b.iconSoft} />
        </button>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className={className} aria-pressed={pressed} aria-expanded={expanded} aria-haspopup={haspopup} aria-label={label} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={className}>{body}</span>
  );
}

/* Cards */
export function Card({ flush, spread, tight, href, onClick, pressed, label, children }: { flush?: boolean; spread?: boolean; tight?: boolean; href?: string; onClick?: () => void; pressed?: boolean; /** Makes it an article with this name. */ label?: string; children: ReactNode }) {
  const className = cx(b.card, flush && b.flush, spread && b.spread, tight && b.stageCard, (href || onClick) && b.cardLink, pressed && b.cardOn);
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={className} aria-pressed={pressed} onClick={onClick}>
        {children}
      </button>
    );
  }
  if (label) {
    return (
      <article className={className} aria-label={label}>
        {children}
      </article>
    );
  }
  return <div className={className}>{children}</div>;
}

export function Stat({ label, value, hint, delta, down }: { label: string; value: ReactNode; hint?: ReactNode; delta?: ReactNode; down?: boolean }) {
  return (
    <span className={d.stat}>
      <span className={b.muted}>{label}</span>
      <span className={b.big}>{value}</span>
      {delta && <span className={cx(d.delta, down && d.deltaDown)}>{delta}</span>}
      {hint && <span className={b.smallMuted}>{hint}</span>}
    </span>
  );
}

/** A card holding one Stat. With `onClick` it toggles a filter. */
export function StatCard({ onClick, pressed, ...stat }: { label: string; value: ReactNode; hint?: ReactNode; delta?: ReactNode; down?: boolean; onClick?: () => void; pressed?: boolean }) {
  return (
    <Card onClick={onClick} pressed={pressed}>
      <Stat {...stat} />
    </Card>
  );
}

export function Meter({ value, tone = "ink" }: { value: number; tone?: "ink" | "error" }) {
  return (
    <span className={o.bar}>
      <span className={cx(o.barFill, tone === "error" && o.barFillError)} style={{ width: `${value}%` }} />
    </span>
  );
}

/** A percentage over its meter. */
export function MeterFigure({ value, low }: { value: number; low?: boolean }) {
  return (
    <div className={d.meter}>
      <span className={cx(b.strong, b.num)}>{value}%</span>
      <Meter value={value} tone={low ? "error" : "ink"} />
    </div>
  );
}

/* Search */
export function SearchField({ value, onChange, placeholder, label, hint, hug, inputRef }: { value?: string; onChange?: (next: string) => void; placeholder: string; label?: string; /** A key hint shown while empty. */ hint?: string; /** Fixed width instead of filling its row. */ hug?: boolean; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <label className={cx(f.field, hug ? b.searchSlim : f.fieldGrow)}>
      <Search {...ICON} className={value ? b.iconInk : b.iconSoft} />
      <input ref={inputRef} className={f.fieldInput} type="text" autoComplete="off" spellCheck={false} placeholder={placeholder} aria-label={label ?? placeholder} value={value ?? ""} readOnly={!onChange} onChange={(e) => onChange?.(e.target.value)} />
      {value && onChange ? (
        <button type="button" className={b.reset} aria-label="Clear search" onClick={() => onChange("")}>
          <X {...ICON} className={b.iconSoft} />
        </button>
      ) : (
        hint && <span className={b.kbd}>{hint}</span>
      )}
    </label>
  );
}

/* Navigation */
export function NavRow({ href, onClick, icon, leading, label, active, soft, count, alert, alertLabel, role, checked }: { href?: string; onClick?: () => void; icon?: LucideIcon; /** Replaces the icon, such as a project mark. */ leading?: ReactNode; label: string; /** The ink row. `soft` is the quiet selected row, for a choice rather than a place. */ active?: boolean; soft?: boolean; count?: ReactNode; alert?: number; alertLabel?: string; role?: "radio"; checked?: boolean }) {
  const className = cx(o.navItem, side.navRow, active && o.navOn, onClick && side.project, soft && side.projectOn);
  const body = (
    <>
      {leading ?? (icon && createElement(icon, { ...ICON, "aria-hidden": true, className: side.navIcon }))}
      <span className={side.navLabel}>{label}</span>
      {count !== undefined && <span className={o.navCount}>{count}</span>}
      {alert ? (
        <span className={cx(o.navCount, side.alert)} title={alertLabel}>
          <span className={b.dot} />
          {alert}
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={className}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" role={role} aria-checked={checked} className={className} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

/* Tables */
export interface Column {
  key: string;
  /** Empty for a control column; name it with `srLabel`. */
  label?: string;
  srLabel?: string;
  width: string;
  align?: "center" | "end";
  sortable?: boolean;
  /** Replaces the label, such as a select-all box. */
  head?: ReactNode;
}
const ALIGN = { center: d.dtCenter, end: d.dtEnd };

export function DataTable({ columns, sort, onSort, children }: { columns: Column[]; sort?: { key: string; dir: 1 | -1 }; onSort?: (key: string) => void; children: ReactNode }) {
  return (
    <table className={d.dt}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => {
            const on = sort?.key === c.key;
            const Icon = !on ? ChevronsUpDown : sort?.dir === 1 ? ArrowUp : ArrowDown;
            return (
              <th key={c.key} scope="col" aria-label={c.srLabel} aria-sort={c.sortable ? (on ? (sort?.dir === 1 ? "ascending" : "descending") : "none") : undefined} className={cx(d.dtHead, c.align && ALIGN[c.align])}>
                {c.head ??
                  (c.sortable ? (
                    <button type="button" className={cx(d.dtSort, on && d.dtSortOn)} onClick={() => onSort?.(c.key)}>
                      {c.label}
                      {createElement(Icon, { ...ICON_SM, className: on ? b.iconInk : b.iconSoft })}
                    </button>
                  ) : (
                    c.label
                  ))}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function DataRow({ selected, onClick, children }: { selected?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <tr className={cx(d.dtRow, selected && d.dtRowOn, onClick && d.dtRowClick)} onClick={onClick}>
      {children}
    </tr>
  );
}

export function DataCell({ align, open, children }: { align?: "center" | "end"; /** Holds a menu, so nothing clips it. */ open?: boolean; children?: ReactNode }) {
  return (
    <td className={cx(d.dtCell, align && ALIGN[align], open && d.dtCellOpen)}>
      <div className={d.dtInner}>{children}</div>
    </td>
  );
}

/** Name over a quieter line: a row's lead, a list row, a card's identity. */
export function TwoLine({ title, sub, strong = true }: { title: ReactNode; sub?: ReactNode; strong?: boolean }) {
  return (
    <span className={b.tight}>
      <span className={cx(strong ? b.strong : b.text, b.clip)}>{title}</span>
      {sub && <span className={cx(b.smallMuted, b.clip)}>{sub}</span>}
    </span>
  );
}
