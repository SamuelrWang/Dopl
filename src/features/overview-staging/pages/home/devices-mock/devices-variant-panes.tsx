// STAGING ONLY (item 4e, variant C). Deleted once Samuel picks a winner.
"use client";

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  VARIANT C — OWNERSHIP BY SELECTION
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **The mechanism: only ONE host's children are on screen, and the page says whose.** A narrow
 * left list of computers, one of them selected; the right side shows that computer's agents and
 * reaches and nothing else. Ownership is not drawn at all — it is enforced, which is the strongest
 * of the three answers to *"no clear indication of what each thing belongs under"*: there is only
 * one thing they could belong under.
 *
 * It is also the only one of the three that attacks *"there's just so much text. It's so busy"* at
 * the root rather than by styling, because it puts a third of the rows on screen at a time.
 *
 * The cost, stated plainly so Samuel can weigh it: you cannot compare two computers at a glance,
 * and a two-host workspace gains less from it than a six-host one.
 *
 * ⚠ **AND IT SOLVES THE COLUMN-BLANK DEFECT STRUCTURALLY** (*"right column half empty below Studio
 * Mac, left crowded"*): the left column is a fixed 15rem of dense rows and the right column always
 * holds exactly one host's detail, so neither side can run out of content while the other crowds.
 *
 * **5-second test** (item 4e §3) is in `src/features/overview-staging/PORTING.md`.
 */

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { ChevronRight, X } from "lucide-react";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { DeviceNameTitle } from "@/features/devices/components/device-name-title";
import { RowAction } from "@/shared/layout/settings-modal/sections/settings-panel";
import { Dot } from "./devices-bits";
import {
  AgentLine,
  HOST_NAME,
  QUIET,
  ReachLine,
  hostCounts,
  hostSpec,
  hostTrouble,
  statusWord,
} from "./devices-variant-parts";
import type { VariantProps } from "./devices-variant-types";

export function DevicesPanes({ hosts, handlers }: VariantProps) {
  const [pickedId, setPicked] = useState<string | null>(null);
  const picked = hosts.find((h) => h.id === pickedId) ?? hosts[0] ?? null;

  if (!picked) return <p className={QUIET}>No devices.</p>;

  return (
    <div className="flex min-w-0 items-start gap-6">
      {/* ── The list: every computer, dense, no detail ── */}
      <ul className="flex w-60 flex-none flex-col gap-0.5" aria-label="Computers">
        {hosts.map((host) => {
          const selected = host.id === picked.id;
          const trouble = hostTrouble(host);
          return (
            <li key={host.id}>
              <button
                type="button"
                onClick={() => setPicked(host.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                  // The selected row is the only filled surface in the variant, and it is the
                  // near-white elevated one with a hairline — not the banned grey, not a black pill.
                  selected
                    ? "border border-border-default bg-bg-elevated"
                    : "border border-transparent hover:border-border-default"
                )}
              >
                <Dot status={host.status} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("min-w-0 truncate", HOST_NAME)}>{host.name}</span>
                  {/* The one fact a list row needs: how much it holds. Never the spec string. */}
                  <span className={cn("min-w-0 truncate", QUIET)}>
                    {trouble ?? hostCounts(host)}
                  </span>
                </span>
                <ChevronRight
                  size={13}
                  strokeWidth={2}
                  aria-hidden="true"
                  className={cn("flex-none", selected ? "text-text-secondary" : "text-text-muted")}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {/* ── The detail: one host, named loudly, then only its own rows ── */}
      <section className="min-w-0 flex-1" aria-label={picked.name}>
        <header className="flex min-w-0 items-center gap-2.5 border-b border-border-strong pb-2">
          <DeviceGlyph kind="computer" />
          <h3 className={cn("min-w-0 truncate", HOST_NAME)}>
            <DeviceNameTitle
              name={picked.name}
              ariaLabel="Computer name"
              maxLength={64}
              onRename={async (next) => handlers.onRename(picked.id, next)}
            />
          </h3>
          {picked.thisComputer && <span className={cn("flex-none", QUIET)}>This one</span>}
          <span className={cn("min-w-0 flex-1 truncate text-right", QUIET)}>
            {hostSpec(picked)}
          </span>
          <span className={cn("flex-none font-medium", QUIET)}>{statusWord(picked)}</span>
          <RowAction
            danger
            onClick={() => handlers.onRemove(picked.id)}
            aria-label={`Remove ${picked.name}`}
          >
            <X size={13} aria-hidden />
          </RowAction>
        </header>

        <div className="mt-1 flex flex-col">
          {picked.agents.map((agent) => (
            <AgentLine key={agent.id} agent={agent} />
          ))}
          {picked.endpoints.map((ep) => (
            <ReachLine key={ep.id} endpoint={ep} />
          ))}
          {picked.agents.length === 0 && picked.endpoints.length === 0 && (
            <p className={cn("py-1.5", QUIET)}>Nothing running or connected on this computer.</p>
          )}
        </div>
      </section>
    </div>
  );
}
