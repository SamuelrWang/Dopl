"use client";

/** What every page that lists calls shares: a call's status badge and the names behind its ids. */
import { STATUS_LABEL, type CallStatus, type PortalUser } from "@/features/device-sdk/portal/view";
import { Badge, type Tone } from "../_design/ui";

const STATUS_TONE: Partial<Record<CallStatus, Tone>> = { delivered: "ok", answered: "ok", ok: "ok", received: "ok", dismissed: "ok", failed: "error", refused: "error", retrying: "warn", expired: "warn" };

export function CallStatusBadge({ status, noDot }: { status: CallStatus; noDot?: boolean }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot={!noDot}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export const userNameOf = (users: readonly PortalUser[], id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : null);
export const deviceNameOf = (users: readonly PortalUser[], id: string | null) => {
  if (!id) return null;
  for (const u of users) {
    const d = u.devices.find((x) => x.id === id);
    if (d) return d.name;
  }
  return null;
};
