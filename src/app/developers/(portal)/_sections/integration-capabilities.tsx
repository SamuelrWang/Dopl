"use client";

/** What one model may do, by risk tier: what its adapter publishes, and what the rules in force allow. Read only for now. */
import { CAPABILITY_IDS, CAPABILITY_RISK_TIER, RISK_TIERS, type CapabilityId, type RiskTier } from "@dopl/device-contracts";
import { TIER_LABEL, TIER_POLICY } from "@/features/device-sdk/portal/catalog";
import { Badge, Card, TwoLine } from "../_design/ui";
import { Between, ChipRow, Grow, ListRow, Text } from "../_design/ui-page";

/** The rules in force for a model, read from its adapter and Dopl's default profile on the server. */
export interface RulesOfModel {
  profileId: string;
  profileVersion: number;
  guidance: string;
  format: string | null;
  maxLines: number | null;
  maxChars: number | null;
  overflow: string;
  published: { id: CapabilityId; allowed: boolean; limits: [string, string][] }[];
}

export function CapabilitiesTab({ rules }: { rules: RulesOfModel }) {
  const published = rules.published.map((c) => c.id);
  const others = CAPABILITY_IDS.filter((c) => !published.includes(c));
  const tiers = RISK_TIERS.filter((t) => published.some((c) => CAPABILITY_RISK_TIER[c] === t));
  return (
    <>
      {tiers.map((tier: RiskTier) => {
        const rows = rules.published.filter((c) => CAPABILITY_RISK_TIER[c.id] === tier);
        return (
          <Card key={tier} label={TIER_LABEL[tier]}>
            <Between>
              <TwoLine title={<Text kind="h3">{TIER_LABEL[tier]}</Text>} sub={TIER_POLICY[tier]} />
              <Badge tone={tier === "T4" ? "warn" : "ring"}>{tier}</Badge>
            </Between>
            <div>
              {rows.map((c, i) => (
                <ListRow key={c.id} line={i < rows.length - 1}>
                  <Text kind="mono" clip>
                    {c.id}
                  </Text>
                  <Grow />
                  {c.allowed ? <Badge tone="ok">Allowed</Badge> : <Text kind="faint">Off</Text>}
                </ListRow>
              ))}
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
