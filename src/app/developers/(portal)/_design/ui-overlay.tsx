"use client";

/** What opens over a page: the side sheet, the popup flow and its tiles, the short question. See README.md. */
import { Check, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import b from "./base.module.css";
import { cx, ICON, ICON_SM } from "./components";
import d from "./data.module.css";
import flow from "./flow.module.css";
import k from "./keys.module.css";
import p from "./page.module.css";
import o from "./surfaces.module.css";
import tokens from "./tokens.module.css";
import { Button } from "./ui";
import { Grow, PlainButton, Text } from "./ui-page";

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

export function SideSheet({ label, onClose, face, head, foot, children }: { label: string; onClose: () => void; /** A person's sheet: a black band with their face over its edge. */ face?: ReactNode; head: ReactNode; foot: ReactNode; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  useEscape(onClose);
  return (
    <div className={p.sheetLayer}>
      <button type="button" className={p.scrim} aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className={p.sheet} role="dialog" aria-modal="true" aria-label={label}>
        {face && (
          <div className={d.profileHead}>
            <span className={d.profileFace}>{face}</span>
            <span className={p.sheetBandClose}>
              <PlainButton buttonRef={close} label="Close" onClick={onClose}>
                <X {...ICON} />
              </PlainButton>
            </span>
          </div>
        )}
        <div className={cx(p.sheetBody, Boolean(face) && p.sheetBodyFace)}>
          <header className={b.between}>
            {head}
            {!face && (
              <PlainButton buttonRef={close} label="Close" onClick={onClose}>
                <X {...ICON} className={b.iconSoft} />
              </PlainButton>
            )}
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

/** A flow's last footer: nothing left to do but close it. */
export function DoneFoot({ onDone }: { onDone: () => void }) {
  return (
    <>
      <Grow />
      <Button variant="ink" onClick={onDone}>
        Done
      </Button>
    </>
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
