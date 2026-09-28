"use client";

import { Bot, Glasses, Laptop } from "lucide-react";
import type { DeviceKind } from "../types";

const ICONS: Record<string, typeof Laptop> = { computer: Laptop, glasses: Glasses };

/** A device's mark: the kit's raised face (Overview's `IconTile`), one glyph per kind. */
export function DeviceGlyph({ kind }: { kind: DeviceKind }) {
  const Icon = ICONS[kind] ?? Bot;
  return (
    <span
      aria-hidden="true"
      className="raised-tab flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-text-secondary"
    >
      <Icon size={15} strokeWidth={1.8} />
    </span>
  );
}
