// STAGING ONLY (item 4e, variant B). Deleted once Samuel picks a winner.
"use client";

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  VARIANT B — OWNERSHIP BY CONNECTION
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **The mechanism: a host's children HANG OFF IT.** A vertical hairline drops from under the
 * computer's glyph, and every agent and reach is attached to it by a short horizontal stub. It is
 * the file-tree convention, which is the one ownership picture every user already reads without
 * being taught — and unlike a caps-label it is a drawn connection, so the answer to *"what does
 * this belong under"* is literally a line you can follow with a finger.
 *
 * No box and no fill: the rail is 1px. That is the point of choosing this over an enclosure — it
 * states ownership with less ink than a border around the whole group.
 *
 * ⚠ **ONE COLUMN, FULL WIDTH, AND THAT IS DELIBERATE.** A tree's rail only reads when the rows
 * below it are long enough to look like branches; two 480px trees side by side read as two lists.
 * Rule 1 is answered inside the row instead: lead · name · a middle fact · trailing state, so a
 * full-width row has content at both ends and in the middle (`devices-variant-parts.tsx › Line`).
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
import type { VariantProps } from "./devices-variant-types";

/** Where the rail sits: under the middle of the 28px host glyph. */
const RAIL_LEFT = 14;
/** How far a child is pushed past the rail. */
const CHILD_INDENT = 30;

export function DevicesTree({ hosts, handlers }: VariantProps) {
  if (hosts.length === 0) return <p className={QUIET}>No devices.</p>;
  return (
    <div className="flex flex-col gap-5">
      {hosts.map((host) => (
        <Tree key={host.id} host={host} handlers={handlers} />
      ))}
    </div>
  );
}

function Tree({ host, handlers }: { host: MockHost; handlers: VariantProps["handlers"] }) {
  const trouble = hostTrouble(host);
  const children = [
    ...host.agents.map((agent) => ({ key: agent.id, node: <AgentLine agent={agent} /> })),
    ...host.endpoints.map((ep) => ({ key: ep.id, node: <ReachLine endpoint={ep} /> })),
  ];
  return (
    <section aria-label={host.name} className="min-w-0">
      {/* The host, with nothing under it but its own children. */}
      <header className="flex min-w-0 items-center gap-2.5">
        <DeviceGlyph kind="computer" />
        <h3 className={cn("min-w-0 shrink truncate", HOST_NAME)}>
          <DeviceNameTitle
            name={host.name}
            ariaLabel="Computer name"
            maxLength={64}
            onRename={async (next) => handlers.onRename(host.id, next)}
          />
        </h3>
        {host.thisComputer && <span className={cn("flex-none", QUIET)}>This one</span>}
        <span className={cn("min-w-0 flex-1 truncate", QUIET)}>{hostSpec(host)}</span>
        {trouble && <span className={cn("flex-none font-medium text-caution", QUIET)}>{trouble}</span>}
        <HostStatus host={host} />
        <RowAction danger onClick={() => handlers.onRemove(host.id)} aria-label={`Remove ${host.name}`}>
          <X size={13} aria-hidden />
        </RowAction>
      </header>

      {children.length === 0 ? (
        <p className={cn("ml-[30px] pt-1", QUIET)}>Nothing running or connected.</p>
      ) : (
        <div className="relative">
          {/* THE RAIL. It stops at the last child's stub rather than running to the bottom of the
              block, so the tree visibly CLOSES — a rail that overshoots reads as an unfinished
              list. */}
          <span
            aria-hidden="true"
            className="absolute top-0 w-px bg-border-strong"
            style={{ left: RAIL_LEFT, bottom: 18 }}
          />
          {children.map(({ key, node }) => (
            <div key={key} className="relative" style={{ paddingLeft: CHILD_INDENT }}>
              {/* The stub: what makes this row ATTACHED rather than merely indented. */}
              <span
                aria-hidden="true"
                className="absolute top-1/2 h-px bg-border-strong"
                style={{ left: RAIL_LEFT, width: CHILD_INDENT - RAIL_LEFT - 6 }}
              />
              {node}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
