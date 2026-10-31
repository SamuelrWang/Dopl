"use client";

/** A user over the list: identity, devices, the week, latest deliveries. */
import { STATE_LABEL, STATUS_LABEL, userDelivered, userDeliveries, userRate, type Call, type DeviceState, type PortalUser } from "@/features/device-sdk/portal/view";
import { modelById } from "@/features/device-sdk/portal/catalog";
import { Badge, Button, ICON, Initials, StateDot, TwoLine, initialsOf, type Tone } from "../_design/ui";
import { StatTriple } from "../_design/ui-extras";
import { BoxRow, Grow, ListRow, Row, SideSheet, Stack, Text } from "../_design/ui-page";
import { BASE, fmt, since } from "../_components/format";
import { STATUS_TONE, deviceNameOf } from "./activity";
import { DeviceGlyph, StatusBadge } from "./users-table";
import { devicesInOrder, statusOf } from "./users-model";

export const STATE_BADGE: Record<DeviceState, Tone> = { online: "ok", offline: "neutral", stale: "warn", needs_relink: "error" };
const LATEST = 5;

export function UserSheet({ user, calls, onClose }: { user: PortalUser; calls: Call[]; onClose: () => void }) {
  const deliveries = calls.filter((c) => c.userId === user.id && c.kind === "delivery").slice(0, LATEST);
  const sent = userDeliveries(user);
  return (
    <SideSheet
      label={user.name}
      onClose={onClose}
      face={<Initials text={initialsOf(user.name)} />}
      head={<TwoLine title={<Text kind="title" as="h2">{user.name}</Text>} sub={user.named ? user.id : undefined} />}
      foot={
        <>
          <Grow />
          <Button variant="ink" href={`${BASE}/users/${encodeURIComponent(user.id)}`}>
            Open full page
          </Button>
        </>
      }
    >
      <Row>
        <StatusBadge status={statusOf(user)} />
        <Text kind="smallMuted">Last delivery {since(user.lastDeliveryAt)}</Text>
      </Row>

      <StatTriple
        items={[
          ["Deliveries, 7d", fmt(sent)],
          ["Delivered, 7d", fmt(userDelivered(user))],
          ["Rate", sent ? `${userRate(user)}%` : "None"],
        ]}
      />

      <Stack>
        <Text kind="strong" as="h3">
          Devices
        </Text>
        {user.devices.length === 0 && <Text kind="faint">None</Text>}
        {devicesInOrder(user).map((d) => (
          <BoxRow key={d.id}>
            <DeviceGlyph device={d} size={ICON} />
            <TwoLine
              title={
                <Row>
                  {d.name}
                  {d.id === user.activeDeviceId && <StateDot tone="ok" />}
                </Row>
              }
              sub={modelById(d.modelId).name}
            />
            <Grow />
            <Stack end>
              <Badge tone={STATE_BADGE[d.state]}>{STATE_LABEL[d.state]}</Badge>
              <Text kind="smallMuted" nowrap>
                {since(d.lastSeenAt)}
              </Text>
            </Stack>
          </BoxRow>
        ))}
      </Stack>

      <Stack>
        <Text kind="strong" as="h3">
          Latest deliveries
        </Text>
        {deliveries.length === 0 && <Text kind="faint">None</Text>}
        <div>
          {deliveries.map((c, i) => (
            <ListRow key={c.id} line={i < deliveries.length - 1}>
              <TwoLine strong={false} title={c.title} sub={deviceNameOf([user], c.deviceId) ?? "No device"} />
              <Grow />
              <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
              <Text kind="smallMuted" nowrap>
                {since(c.at)}
              </Text>
            </ListRow>
          ))}
        </div>
      </Stack>
    </SideSheet>
  );
}
