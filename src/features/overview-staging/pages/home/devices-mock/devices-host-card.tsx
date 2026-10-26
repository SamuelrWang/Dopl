// STAGING COPY of apps/desktop-ui/src/pages/home/devices-mock/devices-host-card.tsx @ branch devices-dashboard-mock. Only import paths differ from the source
// (desktop `#/` modules → staging copies, data hooks → ./stubs). See src/features/overview-staging/PORTING.md.
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { DeviceNameTitle } from "@/features/devices/components/device-name-title";
import {
  RowAction,
  SettingsRow,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { AgentLiveness } from "@/features/channels/components/agent-bits";
import { IdentityAvatar } from "@/features/identities-staging/identity-avatar";
import type { MockEndpoint, MockHost } from "@/features/overview-staging/overview-mock-data";
import { STAGING_VIEWER } from "@/features/ui-staging/staging-stubs";
import { Chip, Dot, Meter, MiniGlyph } from "./devices-bits";
import { DEV_LABEL, DEV_MONO, DEV_PROSE, ago, duration, runtimeLogo } from "./devices-ui";

/**
 * ONE COMPUTER AND WHAT IT CARRIES.
 *
 * ── 4d: IT IS NOT A CARD ANY MORE, AND THE ROWS ARE NOT HAND-ROLLED ──────────────────────────
 * Samuel rejected 4c on two counts.
 *
 * **1. The boxes.** *"the bento is not the right route. I think having so many boxes just makes it
 * look really busy and weird… it should just be a section header or something like that, and then
 * something that clearly shows what element is in what."* So a host is a BLOCK on the open page:
 * a hairline above it, its name as the header, and its two labelled groups under that. The depth
 * that used to come from a white card on a near-white pane now comes from the rule and the label,
 * which is `DESIGN-LANGUAGE.md` §1 and §2 read properly. Nothing on this page is boxed except the
 * Add-device chooser, where the box IS the boundary (a transient panel over the page).
 *
 * **2. The hand-rolling.** *"for the orchestrator devices dashboard mock, that little view with
 * the agents, it should show the profile of the user and have the agent icon. We have that as a
 * set UI component. I don't understand why the agent is not using this stuff."* He is right, and
 * it went further than the agent rows. What this file used to hand-roll, and what it uses now:
 *
 * | Was hand-rolled here | Now |
 * |---|---|
 * | an agent `<li>`: a state dot, a name, a channel, a runtime mark, a duration | `SettingsRow` (leading / title / meta / trailing), led by the IDENTITY FACE — the owner's photo with the runtime badge, the §3 component |
 * | an endpoint `<li>` with the same five-element layout | `SettingsRow`, same four slots |
 * | `EditableName`: a 40-line click-to-rename with its own `concave-field` input | `DeviceNameTitle`, the product's own device rename control. ⚠ It also FIXES A GATE VIOLATION: `concave-field` is banned on /home and swept by `agent-identities/components/identity-editor-surface.test.tsx`, which reads every file under `pages/home/`. The hand-rolled field would have failed that sweep the day this branch merged. |
 * | `ago()` / `duration()` | still local and still pure — see `./devices-ui.ts` for why that one is deliberate, and what the product component is |
 */
export function HostBlock({
  host,
  onRename,
  onRemove,
  onRenameEndpoint,
  onRemoveEndpoint,
}: {
  host: MockHost;
  onRename: (name: string) => void;
  onRemove: () => void;
  onRenameEndpoint: (id: string, name: string) => void;
  onRemoveEndpoint: (id: string) => void;
}) {
  return (
    <section
      className="border-t border-border-subtle px-1 pt-3"
      aria-label={host.name}
    >
      {/* The host's own line. Not a `SettingsRow`: that is an `<li>`, and a host is the thing the
          lists hang off rather than a member of one. Same four slots, by eye. */}
      <header className="flex items-start gap-2.5">
        <DeviceGlyph kind="computer" />
        <div className="min-w-0 flex-1">
          <div className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>
            <DeviceNameTitle
              name={host.name}
              ariaLabel="Computer name"
              maxLength={64}
              onRename={async (next) => onRename(next)}
            />
          </div>
          {/* THREE RELATED FACTS, ONE SUBTITLE — 4c's ruling, kept: it was four crammed facts in
              four chips that failed, not a legible line. "This one" stays a qualifier, never a pill. */}
          <p className={cn("mt-0.5 truncate", DEV_PROSE)}>
            {[host.thisComputer ? "This computer" : null, host.model, `Dopl ${host.appVersion}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Dot
          status={host.status}
          label
          seen={host.status === "active" ? "now" : ago(host.lastSeen)}
          className="mt-1"
        />
        <RowAction danger onClick={onRemove} aria-label={`Remove ${host.name}`}>
          <X size={13} aria-hidden />
        </RowAction>
      </header>

      <Group label="Agents" count={host.agents.length} empty="None running.">
        {host.agents.map((agent) => (
          <SettingsRow
            key={agent.id}
            // ⚠ THE SET COMPONENT, which is the whole of ask 4d's second half: the OWNER's photo
            // ringed with the runtime's badge (`DESIGN-LANGUAGE.md` §3 — "every agent is an
            // identity of a person"). The owner is the viewer: these agents run on the viewer's
            // own computers.
            leading={
              <IdentityAvatar
                d={22}
                photo={STAGING_VIEWER.avatarUrl}
                runtimeLogo={runtimeLogo(agent.runtime)}
              />
            }
            title={agent.name}
            meta={[agent.channel, agent.runtime].join(" · ")}
          >
            {/* ⚠ THE PRODUCT'S OWN LIVENESS ELEMENT, not a hand-rolled dot: `AgentLiveness`
                carries the four tones and is "deliberately not a bordered pill", which is the
                same call `devices-bits.tsx › Dot` made independently for device status. An agent's
                state is an AGENT fact, so it wears the agent component. */}
            <AgentLiveness
              tone={agent.state === "working" ? "working" : "waiting"}
              label={agent.state === "working" ? "Working" : "Waiting"}
            />
            <span className={DEV_MONO}>{duration(agent.runningFor)}</span>
          </SettingsRow>
        ))}
      </Group>

      <Group
        label="Reaches"
        count={host.endpoints.length}
        empty="Nothing connected through this computer."
      >
        {host.endpoints.map((ep) => (
          <EndpointRow
            key={ep.id}
            endpoint={ep}
            onRename={(name) => onRenameEndpoint(ep.id, name)}
            onRemove={() => onRemoveEndpoint(ep.id)}
          />
        ))}
      </Group>
    </section>
  );
}

/**
 * A DEVICE REACHED THROUGH THIS COMPUTER — `SettingsRow`'s four slots, where it used to be a
 * two-level `<li>` built by hand. The battery stays a `Meter`: it is the clearest case in the
 * section of a fact that is seen rather than read.
 */
function EndpointRow({
  endpoint,
  onRename,
  onRemove,
}: {
  endpoint: MockEndpoint;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  return (
    <SettingsRow
      leading={<MiniGlyph kind={endpoint.kind} size={15} />}
      title={
        <DeviceNameTitle
          name={endpoint.name}
          ariaLabel="Device name"
          maxLength={64}
          onRename={async (next) => onRename(next)}
        />
      }
      meta={
        <span className="flex min-w-0 items-center gap-2">
          <Dot
            status={endpoint.status}
            label
            seen={endpoint.status === "active" ? undefined : ago(endpoint.lastSeen)}
          />
          {/* Losing a fact is not simplification: "Dopl web" alone says nothing, "Chrome on
              Studio Mac" says where it runs. */}
          <span className="min-w-0 truncate">{endpoint.model}</span>
        </span>
      }
    >
      {endpoint.battery !== undefined && (
        <Meter value={endpoint.battery} label={`${endpoint.battery}%`} />
      )}
      {/* THE ONLY CHIP IN THE SECTION, and it takes the dot every other state wears, so the state
          language is one language whether or not the fact needed a box. */}
      {endpoint.inUse && (
        <Chip
          tone="ink"
          mark={<span className="h-1.5 w-1.5 rounded-full bg-text-on-cta" aria-hidden />}
        >
          In use
        </Chip>
      )}
      <RowAction danger onClick={onRemove} aria-label={`Remove ${endpoint.name}`}>
        <X size={13} aria-hidden />
      </RowAction>
    </SettingsRow>
  );
}

/**
 * A labelled group inside a host block: the quiet uppercase label, then the rows.
 *
 * ⚠ **IT IS WHERE THE DEPTH COMES FROM NOW.** With the card gone, the label and the row list are
 * what *"clearly shows what element is in what"*. No count badge (4c): the rows are right there,
 * and a badge counting visible rows is a pill earning nothing.
 * ⚠ The `<ul>` carries the hairline dividers `SettingsRows` would have brought, WITHOUT its
 * `.bento` — that component's frame is the box this round is removing.
 */
function Group({
  label,
  count,
  empty,
  children,
}: {
  label: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-2">
      <h4 className={DEV_LABEL}>{label}</h4>
      {count === 0 ? (
        <p className={cn("mt-1.5", DEV_PROSE)}>{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">{children}</ul>
      )}
    </div>
  );
}
