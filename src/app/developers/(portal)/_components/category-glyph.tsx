/** A category's one glyph, on every page that names a device. */
import { Bot, Car, Glasses, Home, Monitor, Smartphone, Watch, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import type { CategoryId } from "@/features/device-sdk/portal/catalog";

const GLYPH: Record<CategoryId, LucideIcon> = { glasses: Glasses, desktop: Monitor, phone: Smartphone, vehicle: Car, home: Home, robots: Bot, watch: Watch };

export function CategoryGlyph({ id, size, className }: { id: CategoryId; size: { size: number; strokeWidth: number }; className?: string }) {
  return createElement(GLYPH[id], { ...size, className, "aria-hidden": true });
}
