// STAGING ONLY (variant D · Cards). Deleted once Samuel picks a winner, if D is not it.
"use client";

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  VARIANT D — OWNERSHIP BY ENCLOSURE, ON THE DESIGN LANGUAGE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **The mechanism: one white card per computer, and the card IS the owner.** A, B and C each drew
 * ownership without a box (rhythm, a rail, selection). D is the landing's answer instead
 * (`docs/DESIGN-LANGUAGE.md` §1, §4): a computer is a white card on a hairline with the one soft
 * shadow, and everything it runs or reaches is inside it. Two cards side by side, no other box.
 *
 * What it takes from the design language, item by item:
 *
 * | Rule | Here |
 * |---|---|
 * | white surfaces, hairlines, one soft shadow, 14px | `.dvd-card`; every literal is in `./devices-variant-cards.css` |
 * | status pill = dot + word | {@link StatusPill}: green dot "Connected" when live, grey "Away", hollow "Offline" |
 * | show function, not decoration | a device row is name + status on top, its monospace FUNCTION chips under it ({@link FUNCTIONS}) |
 * | every agent is an identity of a person | `PairedAvatar thinFrame`: the owner's photo + the runtime badge |
 * | one accent per scene | {@link ACCENT}: one agent colour slot for every ring, nothing else coloured but the live dot |
 * | 3px meters | battery, `.dvd-meter` |
 * | fewer things on screen | spec cut to the model, no app version, no counts, rows capped at {@link ROW_CAP} |
 *
 * ⚠ **The owner is the VIEWER**, as in A/B/C (PORTING.md §4d): these agents run on the viewer's
 * own computers and `MockAgent` carries no owner field.
 * ⚠ Amber ("needs you") has no caller here: nothing in the mock waits on the user, and away or
 * offline is not a request. It stays reserved rather than repainted onto a status.
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { DeviceNameTitle } from "@/features/devices/components/device-name-title";
import { PairedAvatar } from "@/features/onboarding/components/paired-avatar";
import { RowAction } from "@/shared/layout/settings-modal/sections/settings-panel";
import { STAGING_VIEWER } from "@/features/ui-staging/staging-stubs";
import type {
  EndpointKind,
  MockAgent,
  MockEndpoint,
  MockHost,
  MockStatus,
} from "@/features/overview-staging/overview-mock-data";
import { duration, runtimeLogo } from "./devices-ui";
import type { HostHandlers, VariantProps } from "./devices-variant-types";
import "./devices-variant-cards.css";

/** The scene's ONE accent: the agent colour slot every identity ring wears. */
const ACCENT = 11;

/** Rows per group before the rest fold into "N more". Drop rows, never shrink text. */
const ROW_CAP = 3;

/**
 * WHAT A DEVICE LETS AN AGENT DO, as tool namespaces (the landing's connect pill).
 * ⚠ STAGING LITERALS. Glasses are the G2's real set (display, mic, touch; no camera, no speaker:
 * `marketing/components/glasses-hud-content.ts › HUD_CONNECTION`). The product reads these off
 * the device's registered tools; the mock has no such field yet.
 */
const FUNCTIONS: Record<EndpointKind, readonly string[]> = {
  glasses: ["display", "mic", "touch"],
  phone: ["notify", "ask"],
  watch: ["notify", "tap"],
  web: ["notify", "ask"],
};

const STATUS: Record<MockStatus, { tone: "live" | "idle" | "off"; word: string }> = {
  active: { tone: "live", word: "Connected" },
  away: { tone: "idle", word: "Away" },
  offline: { tone: "off", word: "Offline" },
};

export function DevicesCards({ hosts, handlers }: VariantProps) {
  if (hosts.length === 0) return <p className="text-caption text-text-muted">No devices.</p>;
  return (
    <div className="dvd">
      {hosts.map((host) => (
        <HostCard key={host.id} host={host} handlers={handlers} />
      ))}
    </div>
  );
}

function HostCard({ host, handlers }: { host: MockHost; handlers: HostHandlers }) {
  const empty = host.agents.length === 0 && host.endpoints.length === 0;
  return (
    <section aria-label={host.name} className="dvd-card">
      <header className="dvd-head">
        <DeviceGlyph kind="computer" />
        <div className="dvd-title">
          <h3 className="dvd-name">
            <DeviceNameTitle
              name={host.name}
              ariaLabel="Computer name"
              maxLength={64}
              onRename={async (next) => handlers.onRename(host.id, next)}
            />
          </h3>
          <p className="dvd-sub">
            <span>{host.model.split(",")[0]}</span>
            {host.thisComputer && <span>This computer</span>}
          </p>
        </div>
        <StatusPill status={host.status} />
        <RowAction
          danger
          className="dvd-x"
          onClick={() => handlers.onRemove(host.id)}
          aria-label={`Remove ${host.name}`}
        >
          <X size={13} aria-hidden />
        </RowAction>
      </header>

      {empty && <p className="dvd-empty">Nothing running or connected.</p>}

      {host.agents.length > 0 && (
        <Group label="Agents" total={host.agents.length}>
          {host.agents.slice(0, ROW_CAP).map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </Group>
      )}

      {host.endpoints.length > 0 && (
        <Group label="Devices" total={host.endpoints.length}>
          {host.endpoints.slice(0, ROW_CAP).map((ep) => (
            <DeviceRow
              key={ep.id}
              endpoint={ep}
              onRemove={() => handlers.onRemoveEndpoint(host.id, ep.id)}
            />
          ))}
        </Group>
      )}
    </section>
  );
}

function Group({
  label,
  total,
  children,
}: {
  label: string;
  total: number;
  children: ReactNode;
}) {
  return (
    <div className="dvd-group">
      <span className="dvd-label">{label}</span>
      {children}
      {total > ROW_CAP && <span className="dvd-more">{total - ROW_CAP} more</span>}
    </div>
  );
}

function StatusPill({ status }: { status: MockStatus }) {
  const s = STATUS[status];
  return (
    <span className="dvd-pill" data-tone={s.tone}>
      <span className="dvd-dot" data-tone={s.tone} aria-hidden />
      {s.word}
    </span>
  );
}

/** An agent: the owner's face with the runtime badge, its name, its state, how long. */
function AgentRow({ agent }: { agent: MockAgent }) {
  const working = agent.state === "working";
  return (
    <div className="dvd-row">
      <PairedAvatar
        d={26}
        thinFrame
        photo={STAGING_VIEWER.avatarUrl ?? undefined}
        agentLogo={runtimeLogo(agent.runtime)}
        color={ACCENT}
      />
      <span className="dvd-row-name">{agent.name}</span>
      <span className="dvd-state">
        <span className="dvd-dot" data-tone={working ? "live" : "idle"} aria-hidden />
        {working ? "Working" : "Waiting"}
      </span>
      <span className="dvd-time">{duration(agent.runningFor)}</span>
    </div>
  );
}

/** A connected device: what it is and whether it answers, then what it lets an agent do. */
function DeviceRow({ endpoint, onRemove }: { endpoint: MockEndpoint; onRemove: () => void }) {
  return (
    <div className="dvd-dev">
      <span className="dvd-dev-glyph">
        <DeviceGlyph kind={endpoint.kind} />
      </span>
      <span className="dvd-dev-name">
        <span>{endpoint.name}</span>
        {endpoint.inUse && <span className="dvd-inuse">In use</span>}
      </span>
      <span className="dvd-dev-end">
        <StatusPill status={endpoint.status} />
        <RowAction danger className="dvd-x" onClick={onRemove} aria-label={`Remove ${endpoint.name}`}>
          <X size={13} aria-hidden />
        </RowAction>
      </span>
      <ul className="dvd-chips" aria-label={`${endpoint.name} functions`}>
        {FUNCTIONS[endpoint.kind].map((fn) => (
          <li key={fn} className="dvd-chip">
            {fn}
          </li>
        ))}
      </ul>
      <span className="dvd-dev-end">
        {endpoint.battery !== undefined && (
          <span className="dvd-battery" aria-label={`Battery ${endpoint.battery}%`}>
            <span className="dvd-meter" aria-hidden>
              <span style={{ width: `${endpoint.battery}%` }} />
            </span>
            <span className="dvd-pct">{endpoint.battery}%</span>
          </span>
        )}
      </span>
    </div>
  );
}
