"use client";

import { Check as CheckIcon, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import b from "./base.module.css";
import f from "./forms.module.css";
import o from "./surfaces.module.css";
import { cx, ICON } from "./components";

export function Check({ label, on = false, children }: { label?: string; on?: boolean; children?: ReactNode }) {
  const [checked, set] = useState(on);
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={f.toggleRow} onClick={() => set(!checked)}>
      <span className={cx(f.check, checked && f.checkOn)}>{checked && <CheckIcon size={16} strokeWidth={2.2} />}</span>
      {label}
      {children}
    </button>
  );
}

export function Radios({ options, start = 0 }: { options: string[]; start?: number }) {
  const [value, set] = useState(start);
  return (
    <div className={b.stack} role="radiogroup">
      {options.map((label, i) => (
        <button key={label} type="button" role="radio" aria-checked={value === i} className={f.toggleRow} onClick={() => set(i)}>
          <span className={cx(f.radio, value === i && f.radioOn)} />
          {label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on = false, checked, label, onChange }: { on?: boolean; /** Set with onChange when the page holds the value. */ checked?: boolean; label: string; onChange?: (next: boolean) => void }) {
  const [own, set] = useState(on);
  const enabled = checked ?? own;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      className={cx(f.switch, enabled && f.switchOn)}
      onClick={() => {
        set(!enabled);
        onChange?.(!enabled);
      }}
    >
      <span className={f.knob} />
    </button>
  );
}

export function Segmented({ options, start = 0, value, onChange, label }: { options: string[]; start?: number; value?: number; onChange?: (index: number) => void; label?: string }) {
  const [own, set] = useState(start);
  const current = value ?? own;
  return (
    <div className={f.segmented} role="tablist" aria-label={label}>
      {options.map((name, i) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={current === i}
          className={cx(f.segment, current === i && f.segmentOn)}
          onClick={() => {
            set(i);
            onChange?.(i);
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ options, start = 0 }: { options: string[]; start?: number }) {
  const [value, set] = useState(start);
  return (
    <div className={o.tabs} role="tablist">
      {options.map((label, i) => (
        <button key={label} type="button" role="tab" aria-selected={value === i} className={cx(o.tab, value === i && o.tabOn)} onClick={() => set(i)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Accordion({ items, start = 0 }: { items: { q: string; a: string }[]; start?: number }) {
  const [open, set] = useState<number | null>(start);
  return (
    <div>
      {items.map((item, i) => (
        <div key={item.q} className={o.accordionItem}>
          <button type="button" aria-expanded={open === i} className={o.accordionHead} onClick={() => set(open === i ? null : i)}>
            {item.q}
            <ChevronDown {...ICON} className={cx(b.iconSoft, open === i && o.flip)} />
          </button>
          {open === i && <p className={o.accordionBody}>{item.a}</p>}
        </div>
      ))}
    </div>
  );
}

/** A hugging trigger with a menu under it. Closes on an outside press or Escape. */
export function PopMenu({ trigger, right, label, children }: { trigger: (open: boolean, toggle: () => void) => ReactNode; right?: boolean; label: string; children: (close: () => void) => ReactNode }) {
  const [open, set] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const press = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) set(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") set(false);
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={anchor} className={o.popAnchor}>
      {trigger(open, () => set(!open))}
      {open && (
        <div role="menu" aria-label={label} className={cx(o.menu, o.popMenu, right && o.popRight)}>
          {children(() => set(false))}
        </div>
      )}
    </div>
  );
}

export interface PillOption {
  value: string;
  label: string;
  count?: number;
}

/** The reference's "Filter by" pill: label and chevron, one menu, the choice ticked inside. */
export function PillMenu({ label, value, options, stable, onChange }: { label: string; value: string; options: PillOption[]; /** The label shows the choice, so the pill holds the width of its longest option. */ stable?: boolean; onChange: (value: string) => void }) {
  return (
    <PopMenu
      label={label}
      trigger={(open, toggle) => (
        <button type="button" aria-haspopup="menu" aria-expanded={open} className={cx(b.pill, b.pillBtn)} onClick={toggle}>
          {stable ? (
            <span className={b.pillSizer}>
              <span>{label}</span>
              {options.map((o) => (
                <span key={o.value} className={b.pillGhost} aria-hidden="true">
                  {o.label}
                </span>
              ))}
            </span>
          ) : (
            label
          )}
          <ChevronDown size={ICON.size} strokeWidth={ICON.strokeWidth} className={b.iconSoft} />
        </button>
      )}
    >
      {(close) =>
        options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={value === option.value}
            className={cx(o.item, o.itemBtn, value === option.value && o.itemOn)}
            onClick={() => {
              onChange(option.value);
              close();
            }}
          >
            {option.label}
            {value === option.value ? (
              <span className={o.itemEnd}>
                <CheckIcon {...ICON} className={b.iconInk} />
              </span>
            ) : (
              option.count !== undefined && <span className={o.itemEnd}>{option.count}</span>
            )}
          </button>
        ))
      }
    </PopMenu>
  );
}
