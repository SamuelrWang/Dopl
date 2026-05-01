"use client";

/**
 * Connectors stub for the workspace overview (Item 5.B).
 *
 * Read-only badge grid showing the integrations the knowledge feature
 * is designed to support — Slack, Gmail, Drive, Notion, GitHub. Each
 * shows a "Coming soon" pill. Real connector wiring is descoped from
 * the Items 1-5 overhaul.
 */

import { Plug } from "lucide-react";
import { SourceIcon } from "@/features/knowledge/components/source-icon";
import type { SourceProvider } from "@/features/knowledge/source-types";

const PROVIDERS: Array<{ provider: SourceProvider; name: string }> = [
  { provider: "slack", name: "Slack" },
  { provider: "gmail", name: "Gmail" },
  { provider: "google-drive", name: "Google Drive" },
  { provider: "notion", name: "Notion" },
  { provider: "github", name: "GitHub" },
];

export function ConnectorsSection() {
  return (
    <section className="rounded-xl border border-white/[0.06] p-5 bg-white/[0.02]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Plug size={13} />
            Connectors
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Pull content into your knowledge bases from external tools.
            Connections live at the workspace level.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {PROVIDERS.map(({ provider, name }) => (
          <div
            key={provider}
            className="flex items-center gap-2.5 rounded-md border border-white/[0.06] px-3 py-2"
          >
            <SourceIcon provider={provider} />
            <span className="flex-1 text-xs text-text-primary">{name}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-secondary/60 px-1.5 py-0.5 rounded bg-white/[0.04]">
              Coming soon
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
