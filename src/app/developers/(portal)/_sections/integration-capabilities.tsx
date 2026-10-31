"use client";

/** What one model may do, by risk tier, from `@dopl/device-contracts`. */
import { Lock } from "lucide-react";
import { CAPABILITY_IDS, CAPABILITY_RISK_TIER, RISK_TIER_DEFAULT_POLICY, RISK_TIERS, type CapabilityId, type RiskTier } from "@dopl/device-contracts";
import { Badge, Card, ICON_SM, PillMenu, Switch, TwoLine } from "../_design/ui";
import { Between, ChipRow, Grow, ListRow, Text } from "../_design/ui-page";
import { CONFIRM_LABEL, POLICY_LABEL, TIER_LABEL, modelById, type ConfirmMode, type ModelId } from "../_data/catalog";
import { usePortal } from "../_components/portal-store";

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
      {tiers.map((tier: RiskTier) => {
        const rows = published.filter((c) => CAPABILITY_RISK_TIER[c] === tier);
        return (
          <Card key={tier} label={TIER_LABEL[tier]}>
            <Between>
              <TwoLine title={<Text kind="h3">{TIER_LABEL[tier]}</Text>} sub={POLICY_LABEL[RISK_TIER_DEFAULT_POLICY[tier]]} />
              <Badge tone={tier === "T4" ? "warn" : "ring"}>{tier}</Badge>
            </Between>
            <div>
              {rows.map((c, i) => {
                const row = settings[c] ?? { on: false, confirm: "none" as ConfirmMode };
                const modes = tier === "T4" ? MODES.filter((m) => m !== "none") : MODES;
                return (
                  <ListRow key={c} line={i < rows.length - 1}>
                    <Text kind="mono" clip>
                      {c}
                    </Text>
                    <Grow />
                    {tier === "T4" && <Lock {...ICON_SM} aria-label="Confirmed on every call" />}
                    {row.on ? <PillMenu stable label={CONFIRM_LABEL[row.confirm]} value={row.confirm} options={modes.map((m) => ({ value: m, label: CONFIRM_LABEL[m] }))} onChange={(confirm) => set(c, { confirm: confirm as ConfirmMode })} /> : <Text kind="faint">Off</Text>}
                    <Switch checked={row.on} label={`Allow ${c}`} onChange={(on) => set(c, { on })} />
                  </ListRow>
                );
              })}
            </div>
          </Card>
        );
      })}
      <Card label="Not published by this model">
        <TwoLine title={<Text kind="h3">Not published by this model</Text>} sub={`${others.length} capabilities`} />
        <ChipRow>
          {others.map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
        </ChipRow>
      </Card>
    </>
  );
}
