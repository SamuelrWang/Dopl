// STAGING ONLY (item 4e). Not a copy of anything on the devices-dashboard-mock branch: the three
// variants are a decision aid for Samuel, and two of the three get deleted once he picks.
"use client";

/**
 * WHAT THE THREE VARIANTS SHARE — the CONTENT and the type ladder, so that what differs between
 * them is only the STRUCTURE (item 4e: *"Structurally different means different
 * containment/ownership mechanisms — not palette or spacing tweaks"*).
 *
 * ── THE THREE DEFECTS THESE PARTS FIX, FROM SAMUEL'S SCREENSHOT ───────────────────────────────
 *
 * **1. *"so much small text, with no differentiation"*, and the same meta on every row.** The old
 * rows carried `Dopl · Claude` under every agent name while the runtime BADGE on the face already
 * said Claude, and a host wore `This computer · MacBook Pro 14, macOS 26.1 · Dopl 1.42.0` — four
 * facts competing with the name above them. So:
 *
 * | Was | Now |
 * |---|---|
 * | agent meta `"Dopl · Claude"` | **the runtime is CUT from the text** (the badge says it) and the channel becomes the row's one middle fact |
 * | host spec string, four facts | {@link hostSpec}: ONE muted trailing string, model + version, truncated. "This computer" is a marker on the one host, not a sentence |
 * | `AGENTS` / `REACHES` caps-labels floating over rows | **gone in all three variants.** A caps-label is not structure, which is the lesson of 4d: ownership is drawn by enclosure (A), by an indent rail (B) or by selection (C) |
 * | every row at 11.5–12.5px | THREE sizes and nothing between: {@link HOST_NAME} 15/600, {@link CHILD_NAME} 12.5/500, {@link QUIET} 11px muted |
 *
 * **2. Ownership invisible.** Each variant answers it with a different mechanism; these parts only
 * promise that a host's name is always the loudest thing and a child's name is always one step
 * down, so the mechanism is the only variable.
 *
 * **3. Column-scale blank space.** Every row here is lead · name · a MIDDLE fact · trailing state
 * (Rule 1 §3), so a row never hugs one side whatever width its variant gives it.
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { AgentLiveness } from "@/features/channels/components/agent-bits";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { IdentityAvatar } from "@/features/identities-staging/identity-avatar";
import { STAGING_VIEWER } from "@/features/ui-staging/staging-stubs";
import type {
  MockAgent,
  MockEndpoint,
  MockHost,
} from "@/features/overview-staging/overview-mock-data";
import { Dot, Meter } from "./devices-bits";
import { STATUS_LABEL, ago, duration, runtimeLogo } from "./devices-ui";

/* ------------------------------ the type ladder ------------------------------ */

/** A COMPUTER'S NAME — the loudest thing in the section after the section's own heading. */
export const HOST_NAME = "text-[15px] font-semibold leading-tight text-text-primary";
/** An AGENT'S or a DEVICE'S NAME — one step down, and the only other thing in ink. */
export const CHILD_NAME = "text-body font-medium text-text-primary";
/** EVERYTHING ELSE. One quiet face, so "quiet" is a single decision and not a dozen. */
export const QUIET = "text-label text-text-muted";

/* --------------------------------- content --------------------------------- */

/**
 * A HOST'S SPEC, DEMOTED TO ONE STRING. Model and app version only: the status is a dot elsewhere
 * on the row and "This computer" is a marker, so neither belongs in here.
 */
export function hostSpec(host: MockHost): string {
  return `${host.model} · Dopl ${host.appVersion}`;
}

/** "3 agents · 2 reaches" — what a collapsed or unselected host says about itself. */
export function hostCounts(host: MockHost): string {
  const agents = `${host.agents.length} ${host.agents.length === 1 ? "agent" : "agents"}`;
  const reaches = `${host.endpoints.length} ${host.endpoints.length === 1 ? "reach" : "reaches"}`;
  return `${agents} · ${reaches}`;
}

/** Is anything on this host wrong right now? The fourth question of the 5-second test. */
export function hostTrouble(host: MockHost): string | null {
  if (host.status === "offline") return "Offline";
  const dark = host.endpoints.filter((e) => e.status === "offline").length;
  if (dark > 0) return `${dark} ${dark === 1 ? "reach" : "reaches"} offline`;
  const low = host.endpoints.find((e) => (e.battery ?? 100) < 20);
  if (low) return `${low.name} at ${low.battery}%`;
  return null;
}

/* ---------------------------------- rows ---------------------------------- */

/**
 * ONE ROW, THREE SLOTS, in every variant: the lead element says WHAT KIND of thing this is (an
 * identity face for an agent, a device glyph for a reach), the name is the one ink string, the
 * middle carries the row's second fact, the trail carries its state.
 *
 * ⚠ **THE LEAD IS THE TYPE SIGNAL, AND IT REPLACES THE CAPS-LABEL.** An agent row and a reach row
 * were *"the same row"* in the screenshot because both were text with a small glyph; a 22px
 * PHOTO beside one and a line glyph beside the other is a difference you see before you read.
 */
export function Line({
  lead,
  name,
  middle,
  trail,
  className,
}: {
  lead: ReactNode;
  name: string;
  middle?: ReactNode;
  trail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 py-1.5", className)}>
      {lead}
      <span className={cn("min-w-0 flex-1 truncate", CHILD_NAME)}>{name}</span>
      {middle && <span className={cn("min-w-0 flex-1 truncate", QUIET)}>{middle}</span>}
      {trail && <span className="flex flex-none items-center gap-2">{trail}</span>}
    </div>
  );
}

/** An agent on a host. The runtime is the badge on its face, never a word in the text. */
export function AgentLine({ agent }: { agent: MockAgent }) {
  return (
    <Line
      lead={
        <IdentityAvatar
          d={22}
          photo={STAGING_VIEWER.avatarUrl}
          runtimeLogo={runtimeLogo(agent.runtime)}
        />
      }
      name={agent.name}
      middle={agent.channel}
      trail={
        <>
          <AgentLiveness
            tone={agent.state === "working" ? "working" : "waiting"}
            label={agent.state === "working" ? "Working" : "Waiting"}
          />
          <span className={cn("tabular-nums", QUIET)}>{duration(agent.runningFor)}</span>
        </>
      }
    />
  );
}

/** A device reached through a host. */
export function ReachLine({ endpoint }: { endpoint: MockEndpoint }) {
  return (
    <Line
      lead={
        <span
          className="grid h-[22px] w-[22px] flex-none place-items-center text-text-muted"
          aria-hidden="true"
        >
          <DeviceKindIcon kind={endpoint.kind} size={15} strokeWidth={1.9} />
        </span>
      }
      name={endpoint.name}
      middle={endpoint.model}
      trail={
        <>
          {endpoint.battery !== undefined && (
            <Meter value={endpoint.battery} label={`${endpoint.battery}%`} />
          )}
          <Dot
            status={endpoint.status}
            label
            seen={endpoint.status === "active" ? undefined : ago(endpoint.lastSeen)}
          />
          {endpoint.inUse && <span className={cn("font-medium", QUIET)}>In use</span>}
        </>
      }
    />
  );
}

/** A host's own status, as the one element that says whether it is reachable at all. */
export function HostStatus({ host }: { host: MockHost }) {
  return (
    <Dot
      status={host.status}
      label
      seen={host.status === "active" ? "now" : ago(host.lastSeen)}
    />
  );
}

/** The word a status carries, for a variant that needs it inline rather than as a dot. */
export function statusWord(host: MockHost): string {
  return STATUS_LABEL[host.status];
}
