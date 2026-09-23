"use client";

/**
 * Profile popup "Agents" pane: the default launch settings a new channel starts with. It mounts the
 * channel tab's own `AgentLaunchPostureRows`, so the two scopes cannot drift.
 * No Tool access row: it is a cloud per-member column that does not exist before the channel does.
 * No folder, orchestrator or direct-agents row: a per-channel path, or already machine-wide.
 */

import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { SectionShell } from "@/shared/layout/settings-modal/sections/section-shell";
import { useLaunchSelection } from "../hooks/use-launch-selection";
import { AgentLaunchPostureRows } from "./settings-agent-launch-rows";
import { SettingRow } from "./settings-agent-rows";

const DEFAULT_CHAIN_OFF = "off";
const DEFAULT_CHAIN_ON = "on";

/** No "In every channel" option: on the channel tab that writes the machine-wide orchestrator
 *  consent, which is not a default for anything. */
type DefaultChainValue = typeof DEFAULT_CHAIN_OFF | typeof DEFAULT_CHAIN_ON;

const CHAIN_OPTIONS: ReadonlyArray<SelectMenuOption<DefaultChainValue>> = [
  { value: DEFAULT_CHAIN_OFF, label: "Cannot launch agents" },
  { value: DEFAULT_CHAIN_ON, label: "Can launch agents" },
];

/** No rows without the bridge: the record lives in the desktop's store (INVARIANTS §5). */
export function AgentDefaultsSettings() {
  // Same hook and record shape as the channel tab: `main/agent-defaults.js › seedChannel` copies
  // this record into a new channel's.
  const state = useLaunchSelection({ kind: "defaults" });

  if (!state.bridge) return <SectionShell title="Agents">{null}</SectionShell>;

  const chain: DefaultChainValue = state.agentChain
    ? DEFAULT_CHAIN_ON
    : DEFAULT_CHAIN_OFF;

  return (
    <SectionShell title="Agents" subtitle="What a new channel's agents start on.">
      <div className="flex flex-col gap-1">
        {/* No `onChangeMessages`: no roster, so no posture warning — Messaging writes straight to
            the record. */}
        <AgentLaunchPostureRows selection={state} />
        {/* Same row name as the channel tab; only the option list differs (see `DefaultChainValue`). */}
        <SettingRow name="Launch agents">
          <SelectMenu<DefaultChainValue>
            variant="text"
            value={chain}
            options={CHAIN_OPTIONS}
            onChange={(next) => {
              if (next === chain) return;
              void state.update({ agentChain: next === DEFAULT_CHAIN_ON });
            }}
            ariaLabel="Whether agents in a new channel may launch further agents"
            disabled={state.busy}
          />
        </SettingRow>
      </div>
    </SectionShell>
  );
}
