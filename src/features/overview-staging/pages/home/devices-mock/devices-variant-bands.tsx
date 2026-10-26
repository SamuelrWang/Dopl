// STAGING ONLY (item 4e, variant A). Deleted once Samuel picks a winner.
"use client";

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  VARIANT A — OWNERSHIP BY WEIGHT AND RHYTHM
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **The mechanism: a host OWNS what is tight to it.** No box, no indent, no rail. Each computer
 * opens with a BAND — its name at 15/600 with its status and spec on the same line, closed by a
 * rule that runs the width of that host's own column — and its agents and reaches sit directly
 * under the band with 6px between them. The next host is 28px away. Inside a host the rhythm is
 * tight; between hosts it is loose, and that ratio is the whole ownership signal.
 *
 * This is the cheapest mechanism of the three and the most typographic: it adds no element to the
 * page at all. It is also the most fragile — if the gap ratio is ever flattened the ownership goes
 * with it, which is exactly how 4d failed (caps-labels floating over rows at one uniform gap).
 *
 * ⚠ **Agents and reaches are told apart by their LEAD, not by a label**: a 22px identity photo
 * versus a line glyph (`devices-variant-parts.tsx › Line`). No `AGENTS` / `REACHES` caps-label
 * exists in this variant.
 *
 * **5-second test** (item 4e §3) is in `src/features/overview-staging/PORTING.md`.
 */

import { cn } from "@/shared/lib/utils";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { DeviceNameTitle } from "@/features/devices/components/device-name-title";
import { RowAction } from "@/shared/layout/settings-modal/sections/settings-panel";
import { X } from "lucide-react";
import type { MockHost } from "@/features/overview-staging/overview-mock-data";
import {
  AgentLine,
  HOST_NAME,
  HostStatus,
  QUIET,
  ReachLine,
  hostSpec,
  hostTrouble,
} from "./devices-variant-parts";
import type { HostHandlers } from "./devices-variant-types";

export function DevicesBands({
  hosts,
  handlers,
}: {
  hosts: ReadonlyArray<MockHost>;
  handlers: HostHandlers;
}) {
  if (hosts.length === 0) return <p className={QUIET}>No devices.</p>;
  return (
    // Two columns, so a host band is ~480px and its rows fill (Rule 1); `gap-y-7` is the LOOSE
    // half of the rhythm and the 6px inside a band is the tight half.
    <div className="grid grid-cols-2 items-start gap-x-8 gap-y-7">
      {hosts.map((host) => (
        <Band key={host.id} host={host} handlers={handlers} />
      ))}
    </div>
  );
}

function Band({ host, handlers }: { host: MockHost; handlers: HostHandlers }) {
  const trouble = hostTrouble(host);
  return (
    <section aria-label={host.name} className="min-w-0">
      {/* THE BAND. The rule under it is the only line in the variant, and it belongs to the host
          whose name sits on it — which is what makes the rows below read as that host's. */}
      <header className="flex min-w-0 items-center gap-2.5 border-b border-border-strong pb-1.5">
        <DeviceGlyph kind="computer" />
        <h3 className={cn("min-w-0 truncate", HOST_NAME)}>
          <DeviceNameTitle
            name={host.name}
            ariaLabel="Computer name"
            maxLength={64}
            onRename={async (next) => handlers.onRename(host.id, next)}
          />
        </h3>
        {host.thisComputer && <span className={cn("flex-none", QUIET)}>This one</span>}
        {/* The spec takes the slack rather than a line of its own, and truncates first. */}
        <span className={cn("min-w-0 flex-1 truncate text-right", QUIET)}>{hostSpec(host)}</span>
        <HostStatus host={host} />
        <RowAction danger onClick={() => handlers.onRemove(host.id)} aria-label={`Remove ${host.name}`}>
          <X size={13} aria-hidden />
        </RowAction>
      </header>

      {/* THE TIGHT HALF: everything this host owns, 6px under its own rule. */}
      <div className="mt-1.5 flex flex-col">
        {host.agents.map((agent) => (
          <AgentLine key={agent.id} agent={agent} />
        ))}
        {host.endpoints.map((ep) => (
          <ReachLine key={ep.id} endpoint={ep} />
        ))}
        {host.agents.length === 0 && host.endpoints.length === 0 && (
          <p className={cn("py-1.5", QUIET)}>Nothing running or connected.</p>
        )}
      </div>

      {trouble && (
        // The one thing wrong, said once, at the bottom of the host it belongs to.
        <p className={cn("mt-1 font-medium text-caution", QUIET)}>{trouble}</p>
      )}
    </section>
  );
}
