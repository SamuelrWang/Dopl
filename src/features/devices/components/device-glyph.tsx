"use client";

import { Bot, Glasses, Globe, Laptop, Smartphone } from "lucide-react";
import type { DeviceKind } from "../types";

const ICONS: Record<string, typeof Laptop> = {
  computer: Laptop,
  glasses: Glasses,
  phone: Smartphone,
  web: Globe,
};

/** One glyph per kind, `Bot` for a kind with none — every device surface draws it through here. */
export function DeviceKindIcon({
  kind,
  size,
  strokeWidth,
  className,
}: {
  kind: DeviceKind;
  size: number;
  strokeWidth: number;
  className?: string;
}) {
  const Icon = ICONS[kind] ?? Bot;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden className={className} />;
}

/** A device's mark: the kit's raised face (Overview's `IconTile`), one glyph per kind. */
export function DeviceGlyph({ kind }: { kind: DeviceKind }) {
  return (
    <span
      aria-hidden="true"
      className="raised-tab flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-text-secondary"
    >
      <DeviceKindIcon kind={kind} size={15} strokeWidth={1.8} />
    </span>
  );
}
