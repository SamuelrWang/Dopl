"use client";

/**
 * Page-level parts on top of ui.tsx: the frame, section headers, item cards, sheets and popups. Pages
 * compose these and add only their own grid widths. None takes a className. See README.md.
 */
import { Check, ChevronLeft, ChevronRight, X, type LucideIcon } from "lucide-react";
import { createElement, useEffect, useRef, type ReactNode, type Ref } from "react";
import b from "./base.module.css";
import c from "./catalog.module.css";
import { cx, ICON, ICON_SM } from "./components";
import d from "./data.module.css";
import flow from "./flow.module.css";
import f from "./forms.module.css";
import k from "./keys.module.css";
import p from "./page.module.css";
import o from "./surfaces.module.css";
import tokens from "./tokens.module.css";
import { Badge, Button } from "./ui";

/* Type */
const TEXT = { title: b.title, h3: b.h3, strong: b.strong, text: b.text, muted: b.muted, small: b.small, smallMuted: b.smallMuted, faint: b.faint, onInk: b.onInk, token: k.token, mono: flow.mono, code: flow.code };

export function Text({ kind = "text", as = "span", clip, num, nowrap, title, children }: { kind?: keyof typeof TEXT; as?: "span" | "h1" | "h2" | "h3" | "p" | "dt" | "dd"; clip?: boolean; num?: boolean; nowrap?: boolean; title?: string; children: ReactNode }) {
  return createElement(as, { className: cx(TEXT[kind], clip && c.footText, num && b.num, nowrap && b.nowrap), title }, children);
}

/* Layout */
export const Row = ({ wrap, children }: { wrap?: boolean; children: ReactNode }) => <div className={cx(b.row, wrap && b.wrap)}>{children}</div>;
export const Between = ({ children }: { children: ReactNode }) => <div className={b.between}>{children}</div>;
export const Stack = ({ end, children }: { /** Right-aligned, hugging: the end of a row. */ end?: boolean; children: ReactNode }) => <div className={cx(b.stack, end && p.stackEnd)}>{children}</div>;
export const Grow = () => <span className={b.grow} />;

/** Icon-only and unboxed: close buttons and row actions. */
export function PlainButton({ label, haspopup, buttonRef, onClick, children }: { label?: string; haspopup?: "dialog"; buttonRef?: Ref<HTMLButtonElement>; onClick?: () => void; children: ReactNode }) {
  return (
    <button ref={buttonRef} type="button" className={b.reset} aria-label={label} aria-haspopup={haspopup} onClick={onClick}>
      {children}
    </button>
  );
}

/* Page frame */
export function Page({ overlays, children }: { overlays?: ReactNode; children: ReactNode }) {
  return (
    <div className={cx(p.root, tokens.scope)}>
      <div className={p.scroller}>
        <div className={p.inner}>{children}</div>
      </div>
      {overlays}
    </div>
  );
}

export function PageHeader({ title, test, action }: { title: string; test?: boolean; action?: ReactNode }) {
  return (
    <header className={b.between}>
      <div className={b.row}>
        <Text kind="title" as="h1">
          {title}
        </Text>
        {test && <Badge tone="warn">Test data</Badge>}
      </div>
      {action}
    </header>
  );
}

export const StatRow = ({ children }: { children: ReactNode }) => <div className={p.stats}>{children}</div>;
export const Toolbar = ({ children }: { children: ReactNode }) => <div className={b.card}>{children}</div>;
export const FilterRow = ({ children }: { children: ReactNode }) => <div className={p.filterRow}>{children}</div>;

export function EmptyState({ icon, title, action }: { icon: LucideIcon; title: string; action?: ReactNode }) {
  return (
    <div className={b.card}>
      <div className={o.empty}>
        <Mark icon={icon} />
        <Text kind="h3">{title}</Text>
        {action}
      </div>
    </div>
  );
}

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div role="status" className={cx(o.toast, o.toastBlack, p.notice)}>
      <span className={b.onInk}>{children}</span>
    </div>
  );
}

/* Marks */
export function Mark({ icon, tone = "ring", children }: { icon?: LucideIcon; tone?: "ring" | "ink" | "danger"; children?: ReactNode }) {
  return <span className={cx(tone === "ink" ? c.glyph : b.tile, tone === "danger" && b.tileDanger)}>{icon ? createElement(icon, { ...ICON, "aria-hidden": true }) : children}</span>;
}

/* Sections of cards */
export function CardSection({ icon, title, meta, children }: { icon: ReactNode; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className={c.section} aria-label={title}>
      <h2 className={c.sectionHead}>
        <span className={c.sectionMark}>{icon}</span>
        <Text kind="h3">{title}</Text>
        {meta && <span className={cx(b.smallMuted, b.num, c.sectionMeta)}>{meta}</span>}
      </h2>
      <div className={c.grid}>{children}</div>
    </section>
  );
}

/* An item card's anatomy: head, chips, figures, foot. */
export function CardHead({ mark, title, sub, badges }: { mark: ReactNode; title: ReactNode; sub: ReactNode; badges?: ReactNode }) {
  return (
    <div className={c.head}>
      {mark}
      <div className={cx(b.tight, b.grow)}>
        <span className={cx(b.h3, c.footText)}>{title}</span>
        {sub}
      </div>
      {badges && <div className={c.headBadges}>{badges}</div>}
    </div>
  );
}

export const ChipRow = ({ children }: { children: ReactNode }) => <div className={c.chips}>{children}</div>;
export const FigureWell = ({ children }: { children: ReactNode }) => <div className={c.well}>{children}</div>;

export function Figure({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <span className={c.figure}>
      <span className={b.smallMuted}>{label}</span>
      <span className={cx(b.h3, b.num, b.nowrap)}>{value}</span>
      {children}
    </span>
  );
}

export function CardFoot({ main, children }: { main: ReactNode; children?: ReactNode }) {
  return (
    <div className={c.foot}>
      <div className={c.footMain}>{main}</div>
      {children}
    </div>
  );
}

export function Spark({ bars }: { bars: number[] }) {
  return (
    <span className={c.spark} aria-hidden="true">
      {bars.map((h, i) => (
        <i key={i} className={cx(c.sparkBar, i === bars.length - 1 && c.sparkOn)} style={{ height: `${h}%` }} />
      ))}
    </span>
  );
}

export function AddCard({ title, sub, wide, onClick, children }: { title: string; sub: string; wide?: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className={cx(c.add, wide && c.addWide)} onClick={onClick}>
      <span className={c.addHead}>
        <span className={b.tile}>{ADD_ICON}</span>
        <span className={b.tight}>
          <span className={b.strong}>{title}</span>
          <span className={b.smallMuted}>{sub}</span>
        </span>
      </span>
      {children && <span className={c.chips}>{children}</span>}
    </button>
  );
}
const ADD_ICON = (
  <svg width={ICON.size} height={ICON.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON.strokeWidth} strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/* Rows */
export function BoxRow({ children }: { children: ReactNode }) {
  return <div className={cx(b.box, d.fileRow)}>{children}</div>;
}

export function ListRow({ line, children }: { line?: boolean; children: ReactNode }) {
  return <div className={cx(d.listRow, line && d.rowLine)}>{children}</div>;
}

/** Figures in a well, in equal columns. */
export function FigureGrid({ children }: { children: ReactNode }) {
  return <dl className={cx(b.well, p.figures)}>{children}</dl>;
}

export function GridFigure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={d.stat}>
      <Text kind="smallMuted" as="dt">
        {label}
      </Text>
      <dd className={cx(b.h3, b.num, p.figureValue)}>{value}</dd>
    </div>
  );
}

/** Under a table: the count, then its pager. */
export function TableFoot({ children }: { children: ReactNode }) {
  return <div className={cx(b.between, b.padRow, p.tableFoot)}>{children}</div>;
}

/* Menus and pages */
export function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" className={cx(o.item, o.itemBtn)} onClick={onClick}>
      {children}
    </button>
  );
}
export const MenuLine = () => <div className={o.menuLine} />;

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const near = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return (
    <nav className={o.pager} aria-label="Pages">
      <button type="button" className={cx(o.page, o.pageBtn, o.pageRing, page === 1 && o.pageOff)} disabled={page === 1} aria-label="Previous page" onClick={() => onPage(page - 1)}>
        <ChevronLeft {...ICON} />
      </button>
      {near.map((n, i) => (
        <span key={n} className={b.row}>
          {i > 0 && n - near[i - 1] > 1 && <span className={o.page}>…</span>}
          <button type="button" aria-current={n === page ? "page" : undefined} className={cx(o.page, o.pageBtn, n === page && o.pageOn)} onClick={() => onPage(n)}>
            {n}
          </button>
        </span>
      ))}
      <button type="button" className={cx(o.page, o.pageBtn, o.pageRing, page === pages && o.pageOff)} disabled={page === pages} aria-label="Next page" onClick={() => onPage(page + 1)}>
        <ChevronRight {...ICON} />
      </button>
    </nav>
  );
}

function useEscape(onEscape: (() => void) | null) {
  useEffect(() => {
    if (!onEscape) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onEscape]);
}

/* Over the page */
export function SideSheet({ label, onClose, head, foot, children }: { label: string; onClose: () => void; head: ReactNode; foot: ReactNode; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  useEscape(onClose);
  return (
    <div className={p.sheetLayer}>
      <button type="button" className={p.scrim} aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className={p.sheet} role="dialog" aria-modal="true" aria-label={label}>
        <div className={p.sheetBody}>
          <header className={b.between}>
            {head}
            <PlainButton buttonRef={close} label="Close" onClick={onClose}>
              <X {...ICON} className={b.iconSoft} />
            </PlainButton>
          </header>
          {children}
        </div>
        <footer className={p.sheetFoot}>{foot}</footer>
      </aside>
    </div>
  );
}

/** A popup flow's frame. Without onDismiss it closes only through its footer. */
export function FlowDialog({ label, eyebrow, title, progress, onDismiss, foot, children }: { label: string; eyebrow: string; title: string; progress?: { step: number; of: number }; onDismiss: (() => void) | null; foot: ReactNode; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, []);
  useEscape(onDismiss);
  return (
    <div className={cx(flow.layer, tokens.scope)}>
      <button type="button" className={flow.scrim} aria-label="Dismiss" tabIndex={-1} onClick={onDismiss ?? undefined} />
      <div ref={dialog} className={flow.dialog} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {onDismiss && (
          <button type="button" className={cx(b.reset, flow.close)} onClick={onDismiss} aria-label="Close">
            <X {...ICON} />
          </button>
        )}
        <header className={flow.head}>
          <span className={cx(b.smallMuted, b.num)}>{eyebrow}</span>
          <Text kind="title" as="h2">
            {title}
          </Text>
          {progress && (
            <span className={flow.progress} aria-hidden="true">
              {Array.from({ length: progress.of }, (_, i) => (
                <i key={i} className={cx(flow.progressStep, i <= progress.step && flow.progressOn)} />
              ))}
            </span>
          )}
        </header>
        <div className={flow.body}>{children}</div>
        <footer className={flow.foot}>{foot}</footer>
      </div>
    </div>
  );
}

export const Tiles = ({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) => <div className={cols === 3 ? flow.tiles3 : flow.tiles2}>{children}</div>;

export function Tile({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick} className={cx(flow.tile, selected && flow.tileOn, disabled && flow.tileOff)}>
      {selected && <Check {...ICON_SM} aria-hidden="true" className={flow.tileCheck} />}
      {children}
    </button>
  );
}

/** Label over value in a two-up well: a popup's review. */
export function ReviewWell({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className={cx(b.well, flow.tiles2, flow.reviewWell)}>
      {items.map(([label, value]) => (
        <span key={label} className={b.tight}>
          <span className={b.smallMuted}>{label}</span>
          <span className={cx(b.strong, b.num)}>{value}</span>
        </span>
      ))}
    </div>
  );
}

/** A short question over the page. Cancel holds focus. */
export function ConfirmDialog({ label, mark, title, sub, cancel = "Cancel", onCancel, action, children }: { label: string; mark: ReactNode; title: string; sub: string; cancel?: string; onCancel: () => void; action: ReactNode; children?: ReactNode }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEscape(onCancel);
  return (
    <div className={cx(flow.layer, tokens.scope)}>
      <button type="button" className={flow.scrim} aria-label="Dismiss" tabIndex={-1} onClick={onCancel} />
      <div className={cx(o.dialog, k.confirm)} role="alertdialog" aria-modal="true" aria-label={label}>
        {mark}
        <div className={b.tight}>
          <span className={b.title}>{title}</span>
          <span className={b.muted}>{sub}</span>
        </div>
        {children}
        <div className={b.row}>
          <Button full buttonRef={first} onClick={onCancel}>
            {cancel}
          </Button>
          {action}
        </div>
      </div>
    </div>
  );
}

export function Alert({ tone, icon, children }: { tone: "warn" | "error"; icon: LucideIcon; children: ReactNode }) {
  return (
    <div className={cx(o.alert, tone === "warn" ? o.alertWarn : o.alertError)}>
      {createElement(icon, { ...ICON, "aria-hidden": true })}
      {children}
    </div>
  );
}

export function TextField({ label, placeholder, value, autoFocus, onChange, onEnter }: { label: string; placeholder?: string; value: string; autoFocus?: boolean; onChange: (next: string) => void; onEnter?: () => void }) {
  return (
    <label className={f.field}>
      <input
        autoFocus={autoFocus}
        className={f.fieldInput}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
      />
    </label>
  );
}

export function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <label className={f.textarea}>
      <textarea className={f.areaInput} aria-label={label} rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** A value to copy, with its button. */
export function SecretWell({ value, action }: { value: string; action: ReactNode }) {
  return (
    <div className={cx(b.well, k.secret)}>
      <span className={cx(flow.mono, k.secretValue)}>{value}</span>
      {action}
    </div>
  );
}

export function CodeBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={d.code}>
      <div className={d.codeHead}>
        <span className={b.onInk}>{title}</span>
      </div>
      <div className={cx(d.codeBody, k.codeBody)}>{children}</div>
    </div>
  );
}
export const CodeDim = ({ children }: { children: ReactNode }) => <span className={d.codeDim}>{children}</span>;
export const CodeStrong = ({ children }: { children: ReactNode }) => <span className={d.codeStrong}>{children}</span>;

/* Pairing */
export const PairWell = ({ children }: { children: ReactNode }) => <div className={flow.pair}>{children}</div>;

export function QrPattern({ seed }: { seed: string }) {
  // A deterministic, decorative pattern: the real page draws the pairing QR.
  const cells = Array.from({ length: 121 }, (_, i) => (seed.charCodeAt(i % seed.length) * (i + 7) * 2654435761) % 7 < 3);
  return (
    <span className={flow.qr} aria-label="Pairing code" role="img">
      {cells.map((on, i) => (
        <i key={i} className={on ? flow.qrOn : undefined} />
      ))}
    </span>
  );
}

export const BoxList = ({ children }: { children: ReactNode }) => <ul className={b.box}>{children}</ul>;
export const BoxListRow = ({ children }: { children: ReactNode }) => <li className={flow.testRow}>{children}</li>;
export const WarnNote = ({ children }: { children: ReactNode }) => <p className={cx(b.small, flow.warning)}>{children}</p>;
