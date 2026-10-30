"use client";

/** A user over the list: identity, devices, the week, latest deliveries as metadata only. */
import { Send, Link2 } from "lucide-react";
import { Badge, Button, ICON, Initials, StateDot, TwoLine, initialsOf, type Tone } from "../_design/ui";
import { BoxRow, FigureGrid, GridFigure, Grow, ListRow, Row, SideSheet, Stack, Text } from "../_design/ui-page";
import { CAPABILITY_LABEL, modelById } from "../_data/catalog";
import { STATUS_LABEL as CALL_STATUS, type Call, type CallStatus } from "../_data/activity";
import { PLAN_LABEL, REGION_LABEL, STATE_LABEL, needsRelink, ownedDevice, userDeliveries, userRate, userSeen, type DeviceState, type PortalUser } from "../_data/users";
import { BASE, fmt, since } from "../_components/ui";
import { DeviceGlyph, StatusBadge } from "./users-table";
import { devicesInOrder, statusOf } from "./users-model";

const STATE_BADGE: Record<DeviceState, Tone> = { online: "ok", offline: "neutral", stale: "warn", needs_relink: "error" };
const CALL_BADGE: Partial<Record<CallStatus, Tone>> = { seen: "ok", answered: "ok", ok: "ok", failed: "error", expired: "warn", retrying: "warn" };
const LATEST = 5;

function capabilityOf(call: Call) {
  return call.capability ? (CAPABILITY_LABEL[call.capability] ?? call.capability) : "Delivery";
}

export function UserSheet({ user, calls, onClose, onSendTest, onRelink }: { user: PortalUser; calls: Call[]; onClose: () => void; onSendTest: () => void; onRelink: () => void }) {
  const relink = needsRelink(user);
  const deliveries = calls.filter((c) => c.userId === user.id && c.kind === "delivery").slice(0, LATEST);
  const sent = userDeliveries(user);
  return (
    <SideSheet
      label={user.name}
      onClose={onClose}
      head={
        <Row>
          <Initials text={initialsOf(user.name)} ink />
          <TwoLine title={<Text kind="title" as="h2">{user.name}</Text>} sub={`${user.id}, ${PLAN_LABEL[user.plan]}, ${REGION_LABEL[user.region]}`} />
        </Row>
      }
      foot={
        <>
          <Button variant={relink ? "secondary" : "ink"} onClick={onSendTest}>
            <Send {...ICON} />
            Send test
          </Button>
          <Button variant={relink ? "ink" : "secondary"} onClick={onRelink}>
            <Link2 {...ICON} />
            Relink link
          </Button>
          <Grow />
          <Button variant="ghost" href={`${BASE}/users/${user.id}`}>
            Open full page
          </Button>
        </>
      }
    >
      <Row>
        <StatusBadge status={statusOf(user)} />
        <Text kind="smallMuted">Last delivery {since(user.lastDeliveryAt)}</Text>
      </Row>

      <FigureGrid>
        <GridFigure label="Deliveries, 7d" value={fmt(sent)} />
        <GridFigure label="Seen, 7d" value={fmt(userSeen(user))} />
        <GridFigure label="Success" value={sent ? `${userRate(user)}%` : "None"} />
      </FigureGrid>

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
              sub={`${modelById(d.modelId).name}, firmware ${d.firmware}`}
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
              <TwoLine strong={false} title={capabilityOf(c)} sub={c.deviceId ? (ownedDevice(c.deviceId)?.name ?? c.deviceId) : "No device"} />
              <Grow />
              <Badge tone={CALL_BADGE[c.status]}>{CALL_STATUS[c.status]}</Badge>
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
