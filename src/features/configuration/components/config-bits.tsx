"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ConnectionStatus, MemberSetupStatus } from "../types";

/**
 * Shared presentational atoms for the configuration page. Section panels
 * follow the intro-panel language: strong hairline frame, uppercase label
 * strip, optional inset body.
 */

export function SectionPanel({
  label,
  meta,
  action,
  inset = false,
  flush = false,
  children,
}: {
  label: string;
  /** Muted counter/summary shown next to the label, e.g. "4 of 6 on". */
  meta?: string;
  action?: ReactNode;
  inset?: boolean;
  /** Skip the body border/background wrapper (caller owns spacing). */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-black/[0.12] bg-white">
      <div className="flex items-center gap-3 bg-[#f4f6f9] px-4 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        {meta && <span className="text-[11px] text-text-muted">{meta}</span>}
        <span className="flex-1" />
        {action}
      </div>
      <div
        className={cn(
          !flush && "border-t border-black/[0.06]",
          inset && "bg-bg-inset"
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function MockSwitch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        on
          ? "bg-[#1c2127] shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
          : "bg-[#e2e5e9] shadow-[inset_0_1px_2px_rgba(0,0,0,0.14)]"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform",
          on ? "translate-x-[18px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        "flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-text-primary",
        copied ? "btn-pressed" : "btn-light"
      )}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

const CONNECTION_PILLS: Record<ConnectionStatus, { text: string; cls: string }> = {
  auto: { text: "Automatic", cls: "bg-[#eef0ff] text-[#4f46e5]" },
  connected: { text: "Connected", cls: "bg-[#e5f4ec] text-[#25784a]" },
  "action-needed": { text: "Action needed", cls: "bg-[#fdf1df] text-[#a16a12]" },
};

export function ConnectionPill({ status }: { status: ConnectionStatus }) {
  const pill = CONNECTION_PILLS[status];
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        pill.cls
      )}
    >
      {pill.text}
    </span>
  );
}

const MEMBER_PILLS: Record<MemberSetupStatus, { text: string; cls: string }> = {
  complete: { text: "Set up", cls: "bg-[#e5f4ec] text-[#25784a]" },
  drifted: { text: "Out of date", cls: "bg-[#fdf1df] text-[#a16a12]" },
  "not-started": { text: "Not started", cls: "bg-[#fdecec] text-[#c04543]" },
};

export function MemberPill({ status }: { status: MemberSetupStatus }) {
  const pill = MEMBER_PILLS[status];
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        pill.cls
      )}
    >
      {pill.text}
    </span>
  );
}

export function RowList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-black/[0.05]">{children}</div>;
}
