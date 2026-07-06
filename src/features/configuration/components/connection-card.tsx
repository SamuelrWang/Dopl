"use client";

import { useState } from "react";
import { Bot, ChevronDown, Terminal } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ConfigMode, ProfileConnection } from "../types";
import { BrandTile } from "./brand-tile";
import { ConnectionPill, CopyButton } from "./config-bits";

/**
 * Expandable connection card. Collapsed: logo, name, category, status.
 * Expanded: how the team uses it, the agent-readable context blurb, and
 * setup guidance. Manager mode makes the agent blurb editable; employee
 * mode leads with setup.
 */
export function ConnectionCard({
  connection: c,
  mode,
  defaultOpen = false,
}: {
  connection: ProfileConnection;
  mode: ConfigMode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.1] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-black/[0.015]"
        aria-expanded={open}
      >
        <BrandTile id={c.id} name={c.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-text-primary">
              {c.name}
            </span>
            <span className="text-[11px] text-text-muted">{c.category}</span>
            {c.required && (
              <span className="rounded-full border border-black/[0.12] px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-text-muted">
                Required
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-text-secondary">
            {c.tagline}
          </div>
        </div>
        <ConnectionPill status={c.status} />
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 text-text-muted transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-black/[0.06]">
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                How the team uses it
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-primary">
                {c.teamUsage}
              </p>
              {c.scopes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.scopes.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-bg-inset px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                <Bot size={12} /> Agent context — what the agent reads
              </div>
              {mode === "manager" ? (
                <textarea
                  defaultValue={c.agentContext}
                  rows={4}
                  aria-label={`Agent context for ${c.name}`}
                  className="flex-1 resize-none rounded-lg border border-black/[0.06] bg-bg-inset p-2.5 font-mono text-[12px] leading-relaxed text-text-primary shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] focus:outline-none"
                />
              ) : (
                <p className="flex-1 rounded-lg border border-black/[0.06] bg-bg-inset p-2.5 font-mono text-[12px] leading-relaxed text-text-secondary shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]">
                  {c.agentContext}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-black/[0.05] bg-[#fafbfc] px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                <Terminal size={12} /> Setup
              </div>
              <p className="text-xs leading-relaxed text-text-secondary">
                {c.setupNote}
              </p>
              {c.setupCommand && (
                <div className="mt-0.5 flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-2.5 py-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-primary">
                    {c.setupCommand}
                  </code>
                  <CopyButton text={c.setupCommand} label={`Copy ${c.name} setup command`} />
                </div>
              )}
            </div>
            {mode === "employee" && c.status === "action-needed" && (
              <button
                type="button"
                className="auth-btn-3d shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                Connect {c.name}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
