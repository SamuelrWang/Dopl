"use client";

/**
 * Connect page: what the screen Dopl hosts shows when an end user links a device, as it stands. Read only until
 * branding can be saved. Each session is created in code, so the snippet is the page's one action.
 */
import { CAPABILITY_RISK_TIER, RISK_TIERS } from "@dopl/device-contracts";
import { TIER_LABEL, categoryById, type Integration } from "@/features/device-sdk/portal/catalog";
import { Badge, Card, ICON, TwoLine } from "../_design/ui";
import { LabeledField, SplitLayout, Swatch, TierRow } from "../_design/ui-output";
import { Between, BoxRow, CodeBlock, CopyButton, Mark, Page, PageHeader, Row, Stack, Text } from "../_design/ui-page";
import { CategoryGlyph } from "../_components/category-glyph";
import { usePortal } from "../_components/portal-store";

const SNIPPET = `const session = await dopl.connectSessions.create({
  external_user_id: "user_123",
  requested_scopes: ["presence.read", "present.*", "ask.choice"],
});

// Send your user to session.url`;

export function ConnectSection({ branding, integrations }: { branding: { name: string; accent: string | null; logoUrl: string | null }; integrations: Integration[] }) {
  const { test } = usePortal();
  const capabilities = Object.keys(CAPABILITY_RISK_TIER) as (keyof typeof CAPABILITY_RISK_TIER)[];
  return (
    <Page>
      <PageHeader title="Connect page" test={test} />
      <SplitLayout
        left={
          <>
            <Card>
              <Text kind="h3">Branding</Text>
              <LabeledField label="Name">
                <Text>{branding.name}</Text>
              </LabeledField>
              <LabeledField label="Button color">
                {branding.accent ? (
                  <Row>
                    <Swatch color={branding.accent} />
                    <Text kind="mono">{branding.accent}</Text>
                  </Row>
                ) : (
                  <Text kind="faint">Default</Text>
                )}
              </LabeledField>
            </Card>
            <Card>
              <Between>
                <Text kind="h3">Start a session</Text>
                <CopyButton text={SNIPPET} />
              </Between>
              <CodeBlock title="JavaScript">{SNIPPET}</CodeBlock>
            </Card>
          </>
        }
        right={
          <>
            <Card>
              <Text kind="h3">Can pair here</Text>
              <Stack>
                {integrations.map((i) => (
                  <BoxRow key={i.id}>
                    <Mark>
                      <CategoryGlyph id={i.categoryId} size={ICON} />
                    </Mark>
                    <TwoLine title={i.name} sub={categoryById(i.categoryId).name} />
                  </BoxRow>
                ))}
              </Stack>
            </Card>
            <Card>
              <Text kind="h3">Permissions a session can ask for</Text>
              <Stack>
                {RISK_TIERS.map((tier) => (
                  <TierRow key={tier} label={TIER_LABEL[tier]}>
                    {capabilities
                      .filter((c) => CAPABILITY_RISK_TIER[c] === tier)
                      .map((c) => (
                        <Badge key={c} tone="ring">
                          {c}
                        </Badge>
                      ))}
                  </TierRow>
                ))}
              </Stack>
            </Card>
          </>
        }
      />
    </Page>
  );
}
