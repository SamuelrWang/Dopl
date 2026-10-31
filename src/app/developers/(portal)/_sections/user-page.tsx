"use client";

/** One user: their physical devices, deliveries and grants. */
import { CAPABILITY_RISK_TIER, type CapabilityId, type CapabilityScope } from "@dopl/device-contracts";
import { Cpu } from "lucide-react";
import { useState } from "react";
import { scopesCover } from "@/features/device-sdk/delivery/resolve-profile";
import { modelById, trail } from "@/features/device-sdk/portal/catalog";
import { STATE_LABEL, categoryIdOf, userDeliveries, userRate, type Call, type OwnedDevice, type PortalUser } from "@/features/device-sdk/portal/view";
import { Badge, Card, ICON, Initials, Segmented, StatCard, TwoLine, initialsOf } from "../_design/ui";
import { Between, Breadcrumbs, CardFoot, CardHead, CardSection, ChipRow, EmptyState, Figure, FigureWell, Grow, ListRow, Mark, Page, Row, Stack, StatRow, Text } from "../_design/ui-page";
import { BASE, fmt, since } from "../_components/format";
import { CategoryGlyph } from "../_components/category-glyph";
import { CallsBrowser } from "./activity";
import { STATE_BADGE } from "./users-sheet";

const TABS = [
  { key: "devices", label: "Devices" },
  { key: "deliveries", label: "Deliveries" },
  { key: "grants", label: "Grants" },
];

function DeviceCard({ device }: { device: OwnedDevice }) {
  const rate = device.deliveries7d ? Math.round((device.delivered7d / device.deliveries7d) * 100) : null;
  return (
    <Card label={device.name}>
      <CardHead
        mark={
          <Mark tone="ink">
            <CategoryGlyph id={categoryIdOf(device.modelId)} size={ICON} />
          </Mark>
        }
        title={device.name}
        sub={<Text kind="smallMuted">{trail(device.modelId).join(", ")}</Text>}
        badges={<Badge tone={STATE_BADGE[device.state]} dot>{STATE_LABEL[device.state]}</Badge>}
      />
      <ChipRow>
        {device.grants.map((g) => (
          <Badge key={g} tone="ring">
            {g}
          </Badge>
        ))}
      </ChipRow>
      <FigureWell>
        <Figure label="Last seen" value={since(device.lastSeenAt)} />
        <Figure label="Linked" value={since(device.pairedAt)} />
        <Figure label="Deliveries, 7d" value={rate === null ? "None" : `${fmt(device.deliveries7d)}, ${rate}%`} />
      </FigureWell>
      <CardFoot main={<Text kind="token">{device.id}</Text>} />
    </Card>
  );
}

function Grants({ device }: { device: OwnedDevice }) {
  const capabilities = modelById(device.modelId).capabilities;
  return (
    <Card label={device.name}>
      <Between>
        <TwoLine title={<Text kind="h3">{device.name}</Text>} sub={trail(device.modelId).join(", ")} />
      </Between>
      <div>
        {capabilities.map((c, i) => (
          <ListRow key={c} line={i < capabilities.length - 1}>
            <Badge tone="ring">{CAPABILITY_RISK_TIER[c as CapabilityId]}</Badge>
            <Text kind="mono" clip>
              {c}
            </Text>
            <Grow />
            {scopesCover(device.grants as CapabilityScope[], c as CapabilityId) ? <Badge tone="ok">Granted</Badge> : <Text kind="faint">Not granted</Text>}
          </ListRow>
        ))}
      </div>
    </Card>
  );
}

export function UserPageSection({ user, calls, initialTab }: { user: PortalUser; calls: Call[]; initialTab?: string }) {
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab! : "devices");
  const mine = calls.filter((c) => c.userId === user.id && c.kind !== "webhook");
  const online = user.devices.filter((d) => d.state === "online").length;
  const head = (
    <Stack>
      <Breadcrumbs items={[{ label: "Users", href: `${BASE}/users` }, { label: user.name }]} />
      <Row>
        <Initials text={initialsOf(user.name)} />
        <TwoLine title={<Text kind="title" as="h1">{user.name}</Text>} sub={user.named ? user.id : undefined} />
      </Row>
    </Stack>
  );
  const tabs = <Segmented label="User sections" options={TABS.map((t) => t.label)} value={TABS.findIndex((t) => t.key === tab)} onChange={(i) => setTab(TABS[i].key)} />;

  if (tab === "deliveries") {
    return (
      <Page fit>
        {head}
        {tabs}
        <CallsBrowser calls={mine} users={[user]} />
      </Page>
    );
  }
  return (
    <Page>
      {head}
      {tabs}
      {tab === "devices" && (
        <>
          <StatRow>
            <StatCard label="Devices" value={fmt(user.devices.length)} hint={`${online} online`} />
            <StatCard label="Deliveries, 7d" value={fmt(userDeliveries(user))} />
            <StatCard label="Delivered" value={userDeliveries(user) ? `${userRate(user)}%` : "None"} />
            <StatCard label="Last delivery" value={since(user.lastDeliveryAt)} />
          </StatRow>
          {user.devices.length === 0 ? (
            <EmptyState icon={Cpu} title="No devices connected" />
          ) : (
            <CardSection icon={<Cpu {...ICON} aria-hidden="true" />} title="Devices" meta={`${fmt(user.devices.length)} connected`}>
              {user.devices.map((d) => (
                <DeviceCard key={d.id} device={d} />
              ))}
            </CardSection>
          )}
        </>
      )}
      {tab === "grants" && user.devices.map((d) => <Grants key={d.id} device={d} />)}
    </Page>
  );
}
