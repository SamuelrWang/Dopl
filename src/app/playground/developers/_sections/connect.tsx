"use client";

/**
 * Connect page: settings for the screen Dopl hosts when an end user links a device. Most developers
 * set this once; each session is created in code, inside the limits set here.
 */
import { Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Chip, ICON, ICON_SM, TwoLine, type Tone } from "../_design/ui";
import { Dropzone } from "../_design/ui-extras";
import { FieldGrid, LabeledField, SplitLayout, Swatch, TierRow } from "../_design/ui-output";
import { Between, BoxRow, CodeBlock, Grow, Mark, Page, PageHeader, PlainButton, Row, Stack, Text, TextField, Tile, Tiles } from "../_design/ui-page";
import { INTEGRATIONS, TIER_LABEL, categoryById } from "../_data/catalog";
import { scopesByTier } from "../_data/misc";
import { CategoryGlyph } from "../_components/category-glyph";
import { usePortal } from "../_components/portal-store";
import { ConnectTest } from "./connect-test";

const HEX = /^#[0-9a-fA-F]{6}$/;
const URL_OK = /^https:\/\/\S+\.\S+/;
const STATUS: Record<string, [string, Tone]> = { live: ["Live", "ok"], testing: ["Testing", "neutral"] };

export function ConnectSection() {
  const { state, update } = usePortal();
  const { draft, published } = state.connect;
  const dirty = JSON.stringify(draft) !== JSON.stringify(published);
  const edit = (patch: Partial<typeof draft>) => update((s) => ({ ...s, connect: { ...s.connect, draft: { ...s.connect.draft, ...patch } } }));
  const [next, setNext] = useState("");
  const [testing, setTesting] = useState(false);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const snippet = `const session = await dopl.connectSessions.create({
  external_user_id: "user_123",
  requested_scopes: ${JSON.stringify(draft.scopes.slice(0, 3))},
  redirect_uri: ${JSON.stringify(draft.redirects[0] ?? "https://")},
});

// Send your user to session.url`;
  return (
    <Page overlays={testing && <ConnectTest draft={draft} onClose={() => setTesting(false)} />}>
      <PageHeader
        title="Connect page"
        test={state.env === "test"}
        action={
          <Row>
            {dirty ? <Badge tone="warn">Draft</Badge> : <Badge tone="ok" dot>Published</Badge>}
            <Button onClick={() => setTesting(true)}>
              <ExternalLink {...ICON} aria-hidden="true" />
              Open test link
            </Button>
            <Button variant="ink" disabled={!dirty} onClick={() => update((s) => ({ ...s, connect: { ...s.connect, published: s.connect.draft } }))}>
              Publish
            </Button>
          </Row>
        }
      />
      <SplitLayout
        left={
          <>
            <Card>
              <Text kind="h3">Branding</Text>
              <FieldGrid>
                <LabeledField label="Name">
                  <TextField label="Name" value={draft.displayName} onChange={(displayName) => edit({ displayName })} />
                </LabeledField>
                <LabeledField label="Button color">
                  <Row>
                    <Swatch color={HEX.test(draft.accent) ? draft.accent : "#ffffff"} />
                    <TextField grow label="Button color" value={draft.accent} onChange={(accent) => edit({ accent })} />
                  </Row>
                </LabeledField>
              </FieldGrid>
              <LabeledField label="Logo">
                <Dropzone
                  title="Drop a logo or choose a file"
                  sub="PNG or SVG"
                  fileName={logoName ?? undefined}
                  onPick={(file) => {
                    setLogoName(file.name);
                    edit({ logoUrl: URL.createObjectURL(file) });
                  }}
                  onClear={() => {
                    setLogoName(null);
                    edit({ logoUrl: "" });
                  }}
                />
              </LabeledField>
            </Card>
            <Card>
              <Text kind="h3">Redirect URLs</Text>
              <Stack>
                {draft.redirects.map((u) => (
                  <BoxRow key={u}>
                    <Text kind="mono" clip>
                      {u}
                    </Text>
                    <Grow />
                    <PlainButton label={`Remove ${u}`} onClick={() => edit({ redirects: draft.redirects.filter((x) => x !== u) })}>
                      <Trash2 {...ICON} aria-hidden="true" />
                    </PlainButton>
                  </BoxRow>
                ))}
                <Row>
                  <TextField grow label="Add redirect URL" placeholder="https://" value={next} onChange={setNext} />
                  <Button
                    disabled={!URL_OK.test(next)}
                    onClick={() => {
                      edit({ redirects: [...draft.redirects, next] });
                      setNext("");
                    }}
                  >
                    Add
                  </Button>
                </Row>
              </Stack>
            </Card>
            <Card>
              <Between>
                <Text kind="h3">Start a session</Text>
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(snippet);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check {...ICON_SM} aria-hidden="true" /> : <Copy {...ICON_SM} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </Between>
              <CodeBlock title="JavaScript">{snippet}</CodeBlock>
            </Card>
          </>
        }
        right={
          <>
            <Card>
              <Text kind="h3">Allowed integrations</Text>
              <Tiles>
                {INTEGRATIONS.filter((i) => state.integrations[i.id]).map((i) => {
                  const on = draft.allowedIntegrations.includes(i.id);
                  const [label, tone] = STATUS[state.integrations[i.id]!.status];
                  return (
                    <Tile key={i.id} selected={on} onClick={() => edit({ allowedIntegrations: on ? draft.allowedIntegrations.filter((x) => x !== i.id) : [...draft.allowedIntegrations, i.id] })}>
                      <Mark>
                        <CategoryGlyph id={i.categoryId} size={ICON} />
                      </Mark>
                      <TwoLine title={i.name} sub={categoryById(i.categoryId).name} />
                      <Badge tone={tone}>{label}</Badge>
                    </Tile>
                  );
                })}
              </Tiles>
            </Card>
            <Card>
              <Text kind="h3">Maximum permissions</Text>
              <Stack>
                {scopesByTier().map(({ tier, scopes }) => (
                  <TierRow key={tier} label={TIER_LABEL[tier]}>
                    {scopes.map((s) => {
                      const on = draft.scopes.includes(s);
                      return (
                        <Chip key={s} on={on} pressed={on} onClick={() => edit({ scopes: on ? draft.scopes.filter((x) => x !== s) : [...draft.scopes, s] })}>
                          {s}
                        </Chip>
                      );
                    })}
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
