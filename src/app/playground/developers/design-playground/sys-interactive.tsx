"use client";

import { Check as CheckIcon, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import b from "./sys-base.module.css";
import f from "./sys-forms.module.css";
import o from "./sys-surfaces.module.css";
import { cx, ICON } from "./sys";

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

export function Switch({ on = false, label }: { on?: boolean; label: string }) {
  const [enabled, set] = useState(on);
  return (
    <button type="button" role="switch" aria-checked={enabled} aria-label={label} className={cx(f.switch, enabled && f.switchOn)} onClick={() => set(!enabled)}>
      <span className={f.knob} />
    </button>
  );
}

export function Segmented({ options, start = 0 }: { options: string[]; start?: number }) {
  const [value, set] = useState(start);
  return (
    <div className={f.segmented} role="tablist">
      {options.map((label, i) => (
        <button key={label} type="button" role="tab" aria-selected={value === i} className={cx(f.segment, value === i && f.segmentOn)} onClick={() => set(i)}>
          {label}
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
