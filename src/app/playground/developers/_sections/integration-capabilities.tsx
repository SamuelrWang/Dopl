"use client";

/** Capabilities of one model, grouped by risk tier, from `@dopl/device-contracts`. */
import { Lock } from "lucide-react";
import { CAPABILITY_IDS, CAPABILITY_RISK_TIER, RISK_TIER_DEFAULT_POLICY, RISK_TIERS, type CapabilityId, type RiskTier } from "@dopl/device-contracts";
import { SelectMenu } from "@/shared/ui/select-menu";
import { Switch } from "@/shared/ui/switch";
import { CONFIRM_LABEL, POLICY_LABEL, TIER_LABEL, modelById, type ConfirmMode, type ModelId } from "../_data/catalog";
import { usePortal } from "../_components/portal-store";
import { Card, TierChip, ov } from "../_components/ui";

const MODES: ConfirmMode[] = ["none", "on_device", "trusted_surface", "deny"];

export function CapabilitiesTab({ model }: { model: ModelId }) {
  const { state, update } = usePortal();
  const def = modelById(model);
  const settings = state.capabilities[model] ?? {};
  const set = (id: CapabilityId, patch: Partial<{ on: boolean; confirm: ConfirmMode }>) =>
    update((s) => ({
      ...s,
      capabilities: { ...s.capabilities, [model]: { ...s.capabilities[model], [id]: { ...s.capabilities[model]![id]!, ...patch } } },
    }));
  const published = def.capabilities;
  const others = CAPABILITY_IDS.filter((c) => !published.includes(c));
  const tiers = RISK_TIERS.filter((t) => published.some((c) => CAPABILITY_RISK_TIER[c] === t));

  return (
    <>
      {tiers.map((tier: RiskTier) => (
        <Card key={tier} title={TIER_LABEL[tier]} count={POLICY_LABEL[RISK_TIER_DEFAULT_POLICY[tier]]} aside={<TierChip tier={tier} />}>
          <ul className={ov.rows}>
            {published
              .filter((c) => CAPABILITY_RISK_TIER[c] === tier)
              .map((c) => {
                const row = settings[c] ?? { on: false, confirm: "none" as ConfirmMode };
                const modes = tier === "T4" ? MODES.filter((m) => m !== "none") : MODES;
                return (
                  <li key={c} className={ov.row}>
                    <span className={ov.rowMain}>
                      <span className="font-mono text-small font-medium text-text-primary">{c}</span>
                    </span>
                    {tier === "T4" && <Lock size={12} aria-label="T4 is confirmed on every call" className="text-text-muted" />}
                    <SelectMenu
                      variant="outline"
                      ariaLabel={`Confirmation for ${c}`}
                      value={row.confirm}
                      options={modes.map((m) => ({ value: m, label: CONFIRM_LABEL[m] }))}
                      onChange={(confirm) => set(c, { confirm })}
                      disabled={!row.on}
                    />
                    <Switch aria-label={`Allow ${c}`} checked={row.on} onChange={(on) => set(c, { on })} />
                  </li>
                );
              })}
          </ul>
        </Card>
      ))}
      <Card title="Not published by this model" count={others.length}>
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
          {others.map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <TierChip tier={CAPABILITY_RISK_TIER[c]} />
              <span className="font-mono text-caption text-text-muted">{c}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
