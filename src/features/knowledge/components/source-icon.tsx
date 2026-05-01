"use client";

import {
  Code2,
  HardDrive,
  Mail,
  MessageSquare,
  NotebookPen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SourceProvider } from "../source-types";

interface ProviderConfig {
  icon: LucideIcon;
  bg: string;
}

const CONFIG: Record<SourceProvider, ProviderConfig> = {
  slack: { icon: MessageSquare, bg: "#611f69" },
  "google-drive": { icon: HardDrive, bg: "#0066da" },
  gmail: { icon: Mail, bg: "#ea4335" },
  notion: { icon: NotebookPen, bg: "#000000" },
  github: { icon: Code2, bg: "#1f2328" },
};

interface Props {
  provider: SourceProvider;
  size?: "sm" | "md";
}

/**
 * Square-rounded badge with a brand-colored background and a generic
 * lucide icon that connotes the integration type. We deliberately
 * avoid trademarked brand-icon SVGs for now — the colored background
 * + suggestive icon reads as the brand at the size we render at.
 *
 * Renders as `<span>` with `inline-flex` so it's valid inside a `<p>`
 * (which a `<div>` is not). The fixed w/h means it still occupies its
 * box regardless of inline vs block flow.
 */
export function SourceIcon({ provider, size = "md" }: Props) {
  const config = CONFIG[provider];
  const Icon = config.icon;
  const dimension = size === "sm" ? "w-6 h-6" : "w-8 h-8";
  const iconSize = size === "sm" ? 12 : 14;
  return (
    <span
      className={`${dimension} rounded-md inline-flex items-center justify-center shrink-0 align-middle`}
      style={{ backgroundColor: config.bg }}
    >
      <Icon size={iconSize} className="text-white" />
    </span>
  );
}
